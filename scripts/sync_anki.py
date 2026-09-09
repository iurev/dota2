#!/usr/bin/env python3
"""One-way sync: data.csv -> Anki deck "numbers" (via AnkiConnect).

data.csv is the single source of truth. Column 0 is the number, column 2 is the
hero name. Every row that carries a name *and* a screenshot is upserted as a
note keyed by the number, so re-running never duplicates and edits made in Anki
are overwritten. Rows with no anki/<number>.png are skipped.

Front: the number.
Back:  the hero name plus anki/<number>.png.

Images are pushed into the Anki media folder under a `dota_` prefix so they
cannot clash with other decks.

Usage:
    python3 scripts/sync_anki.py            # sync every row with a name
    python3 scripts/sync_anki.py 10         # sync only number 10
    python3 scripts/sync_anki.py --dry-run  # print what would be sent
"""
import csv
import json
import os
import sys
import urllib.request

ANKI_URL = "http://localhost:8765"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CSV_PATH = os.path.join(ROOT, "data.csv")
IMG_DIR = os.path.join(ROOT, "anki")
MEDIA_PREFIX = "dota_"
DECK = "numbers"
MODEL = "numbers"

CSS = """
.card {
  font-family: -apple-system, Segoe UI, sans-serif;
  text-align: center;
  background: #14161a;
  color: #e8e8e8;
}
.num { font-size: 96px; font-weight: 700; }
.name { font-size: 32px; margin: 12px 0 18px; }
.card img { max-width: 100%; border-radius: 8px; }
"""

FRONT_TMPL = '<div class="num">{{number}}</div>'
BACK_TMPL = (
    '<div class="num">{{number}}</div><hr id="answer">'
    '<div class="name">{{name}}</div>{{image}}'
)


def anki(action, **params):
    payload = json.dumps({"action": action, "version": 6, "params": params}).encode()
    req = urllib.request.Request(ANKI_URL, data=payload,
                                 headers={"Content-Type": "application/json"})
    resp = json.loads(urllib.request.urlopen(req, timeout=30).read())
    if resp.get("error"):
        raise RuntimeError(f"{action}: {resp['error']}")
    return resp["result"]


def read_rows():
    """Return [(number, name)] for every csv row with a name and a screenshot.

    Rows without anki/<number>.png are skipped: an image-less card teaches
    nothing here, since the mnemonic lives in the picture.
    """
    rows = []
    with open(CSV_PATH, encoding="utf-8") as f:
        for cols in csv.reader(f):
            if len(cols) < 3:
                continue
            num, name = cols[0].strip(), cols[2].strip()
            if not num.isdigit() or not name:
                continue
            if not os.path.isfile(os.path.join(IMG_DIR, f"{num}.png")):
                continue
            rows.append((num, name))
    return rows


def ensure_model():
    if MODEL in anki("modelNames"):
        return
    anki("createModel", modelName=MODEL,
         inOrderFields=["number", "name", "image"],
         css=CSS,
         cardTemplates=[{"Name": "number->hero",
                         "Front": FRONT_TMPL, "Back": BACK_TMPL}])
    print(f"created model '{MODEL}'")


def ensure_deck():
    if DECK not in anki("deckNames"):
        anki("createDeck", deck=DECK)
        print(f"created deck '{DECK}'")


def upload_image(number):
    """Push anki/<number>.png into the Anki media folder, return an <img> tag."""
    path = os.path.join(IMG_DIR, f"{number}.png")
    if not os.path.isfile(path):
        return ""
    media = f"{MEDIA_PREFIX}{number}.png"
    anki("storeMediaFile", filename=media, path=path, deleteExisting=True)
    return f'<img src="{media}">'


def find_note(number):
    ids = anki("findNotes", query=f'note:"{MODEL}" "number:{number}"')
    return ids[0] if ids else None


def place_in_deck(note_id):
    """addNote's deckName is not always honoured, so place the cards explicitly."""
    cards = anki("findCards", query=f"nid:{note_id}")
    if cards:
        anki("changeDeck", cards=cards, deck=DECK)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    dry = "--dry-run" in sys.argv
    only = args[0] if args else None

    rows = read_rows()
    if only:
        rows = [r for r in rows if r[0] == only]
        if not rows:
            sys.exit(f"no csv row for number {only}")

    if dry:
        for num, name in rows:
            print(f"{num:>3}  {name}")
        print(f"\n{len(rows)} card(s), nothing sent (--dry-run)")
        return

    ensure_model()
    ensure_deck()

    added = updated = 0
    for num, name in rows:
        fields = {"number": num, "name": name, "image": upload_image(num)}
        note_id = find_note(num)
        if note_id:
            anki("updateNoteFields", note={"id": note_id, "fields": fields})
            updated += 1
            print(f"  ~ {num:>3} {name}")
        else:
            note_id = anki("addNote", note={"deckName": DECK, "modelName": MODEL,
                                            "fields": fields,
                                            "options": {"allowDuplicate": False}})
            added += 1
            print(f"  + {num:>3} {name}")
        place_in_deck(note_id)

    print(f"done: {added} added, {updated} updated")


if __name__ == "__main__":
    main()
