#!/usr/bin/env python3
"""One-way sync: QWERTY key columns -> Anki deck "keynumbers" (via AnkiConnect).

Two kinds of note, all one-directional (no reverse cards):

    1 top -> Q    one note per digit *and row*, answer is the single key
    Q -> 1        one note per letter, answer is its digit

Short columns still get all three rows, answered with "nothingness", so the
gaps are drilled too (0 middle, 8 bottom, ...).

Notes are keyed by the front field, so re-running upserts instead of
duplicating. An older reversible version of the `keynumbers` notetype is
migrated in place on first run (its notes are deleted and rebuilt).

Usage:
    python3 scripts/sync_keynumbers.py            # sync all 56 notes
    python3 scripts/sync_keynumbers.py Q          # sync only the Q note
    python3 scripts/sync_keynumbers.py 1 top      # sync only the "1 top" note
    python3 scripts/sync_keynumbers.py --dry-run  # print what would be sent
"""
import json
import os
import sys
import urllib.request

ANKI_URL = os.environ.get("ANKI_URL", "http://localhost:56666")
DECK = "keynumbers"
MODEL = "keynumbers"
TEMPLATE = "front->back"

# digit -> (top, middle, bottom) key of that QWERTY column; "" where the
# column runs out of letters (8 and 9 end at the home row, 0 at the top).
ROWS = ("top", "middle", "bottom")
EMPTY = "nothingness"
COLUMNS = {
    "1": ("Q", "A", "Z"),
    "2": ("W", "S", "X"),
    "3": ("E", "D", "C"),
    "4": ("R", "F", "V"),
    "5": ("T", "G", "B"),
    "6": ("Y", "H", "N"),
    "7": ("U", "J", "M"),
    "8": ("I", "K", ""),
    "9": ("O", "L", ""),
    "0": ("P", "", ""),
}

CSS = """
.card {
  font-family: -apple-system, Segoe UI, sans-serif;
  text-align: center;
  background: #14161a;
  color: #e8e8e8;
}
.big { font-size: 72px; font-weight: 700; }
"""

TEMPLATE_BODY = {
    "Front": '<div class="big">{{front}}</div>',
    "Back": '<div class="big">{{front}}</div><hr id="answer">'
            '<div class="big">{{back}}</div>',
}


def anki(action, **params):
    payload = json.dumps({"action": action, "version": 6, "params": params}).encode()
    req = urllib.request.Request(ANKI_URL, data=payload,
                                 headers={"Content-Type": "application/json"})
    resp = json.loads(urllib.request.urlopen(req, timeout=30).read())
    if resp.get("error"):
        raise RuntimeError(f"{action}: {resp['error']}")
    return resp["result"]


def pairs():
    """Return [(front, back)]: digit+row -> key, then each letter -> digit."""
    rows = [(f"{num} {row}", keys[i] or EMPTY)
            for num, keys in COLUMNS.items()
            for i, row in enumerate(ROWS)]
    rows += [(letter, num)
             for num, keys in COLUMNS.items() for letter in keys if letter]
    return rows


def migrate_model():
    """Turn the old reversible letter/number notetype into a one-way front/back.

    AnkiConnect cannot delete a notetype, so the existing one is reshaped:
    its notes are dropped (they are regenerated below), the fields renamed and
    the reverse card template removed.
    """
    fields = anki("modelFieldNames", modelName=MODEL)
    names = list(anki("modelTemplates", modelName=MODEL))
    if fields == ["front", "back"] and names == [TEMPLATE]:
        return
    old_notes = anki("findNotes", query=f'note:"{MODEL}"')
    if old_notes:
        anki("deleteNotes", notes=old_notes)
        print(f"deleted {len(old_notes)} old reversible note(s)")
    renames = {"letter": "front", "number": "back"}
    for old, new in renames.items():
        if old in fields:
            anki("modelFieldRename", modelName=MODEL, oldFieldName=old,
                 newFieldName=new)
    for name in ("front", "back"):
        if name not in fields and name not in renames.values():
            anki("modelFieldAdd", modelName=MODEL, fieldName=name)
    if names[0] != TEMPLATE:
        anki("modelTemplateRename", modelName=MODEL, oldTemplateName=names[0],
             newTemplateName=TEMPLATE)
    for name in names[1:]:
        anki("modelTemplateRemove", modelName=MODEL, templateName=name)
    print(f"migrated notetype '{MODEL}' to one-way cards")


def ensure_model():
    if MODEL in anki("modelNames"):
        migrate_model()
    else:
        anki("createModel", modelName=MODEL,
             inOrderFields=["front", "back"],
             css=CSS,
             cardTemplates=[dict(Name=TEMPLATE, **TEMPLATE_BODY)])
        print(f"created model '{MODEL}'")
    anki("updateModelTemplates",
         model={"name": MODEL, "templates": {TEMPLATE: TEMPLATE_BODY}})
    anki("updateModelStyling", model={"name": MODEL, "css": CSS})


def ensure_deck():
    if DECK not in anki("deckNames"):
        anki("createDeck", deck=DECK)
        print(f"created deck '{DECK}'")


def find_note(front):
    ids = anki("findNotes", query=f'note:"{MODEL}" "front:{front}"')
    return ids[0] if ids else None


def prune(wanted):
    """Delete notes of this model whose front is no longer in the deck spec."""
    ids = anki("findNotes", query=f'note:"{MODEL}"')
    if not ids:
        return
    stale = [n["noteId"] for n in anki("notesInfo", notes=ids)
             if n["fields"]["front"]["value"] not in wanted]
    if stale:
        anki("deleteNotes", notes=stale)
        print(f"deleted {len(stale)} stale note(s)")


def place_in_deck(note_id):
    """addNote's deckName is not always honoured, so place the cards explicitly."""
    cards = anki("findCards", query=f"nid:{note_id}")
    if cards:
        anki("changeDeck", cards=cards, deck=DECK)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    dry = "--dry-run" in sys.argv
    only = " ".join(args) if args else None

    rows = pairs()
    if only:
        rows = [r for r in rows if r[0].lower() == only.lower()]
        if not rows:
            sys.exit(f"nothing to sync for {only}")

    if dry:
        for front, back in rows:
            print(f"{front:>9}  {back}")
        print(f"\n{len(rows)} note(s) / {len(rows)} card(s), "
              f"nothing sent (--dry-run)")
        return

    ensure_model()
    ensure_deck()
    if not only:
        prune({front for front, _ in rows})

    added = updated = 0
    for front, back in rows:
        fields = {"front": front, "back": back}
        note_id = find_note(front)
        if note_id:
            anki("updateNoteFields", note={"id": note_id, "fields": fields})
            updated += 1
            print(f"  ~ {front:>9} {back}")
        else:
            note_id = anki("addNote", note={"deckName": DECK, "modelName": MODEL,
                                            "fields": fields,
                                            "options": {"allowDuplicate": False}})
            added += 1
            print(f"  + {front:>9} {back}")
        place_in_deck(note_id)

    print(f"done: {added} added, {updated} updated")


if __name__ == "__main__":
    main()
