#!/usr/bin/env python3
"""One-way sync: QWERTY key columns -> Anki deck "keynumbers" (via AnkiConnect).

Two kinds of note, all one-directional (no reverse cards):

    1 top -> Q    one note per digit *and row*, answer is the single key
    Q -> 1        one note per letter, answer is its digit

Short columns still get all three rows, answered with "nothingness", so the
gaps are drilled too (0 middle, 8 bottom, ...).

Everything rides on Anki's stock "Basic" notetype and only ever adds, edits or
deletes notes. Notetypes are never created or reshaped, because a notetype
change marks the collection schema-modified and forces a full AnkiWeb sync.
For the same reason the deck's cards get no custom styling - style "Basic" by
hand in Anki if you want it, and this script will leave that alone.

Note lookups are scoped to the deck, so other decks built on "Basic" are never
touched.

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
MODEL = os.environ.get("ANKI_MODEL", "Basic")
FRONT, BACK = "Front", "Back"

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


def check_model():
    """Fail early rather than half-sync onto a notetype we cannot fill."""
    if MODEL not in anki("modelNames"):
        sys.exit(f"notetype '{MODEL}' not found - set ANKI_MODEL to your "
                 f"local name for Anki's Basic notetype")
    fields = anki("modelFieldNames", modelName=MODEL)
    if FRONT not in fields or BACK not in fields:
        sys.exit(f"notetype '{MODEL}' has fields {fields}, "
                 f"expected '{FRONT}' and '{BACK}'")


def ensure_deck():
    if DECK not in anki("deckNames"):
        anki("createDeck", deck=DECK)
        print(f"created deck '{DECK}'")


def deck_notes():
    """Map front field -> note id for the notes this script owns."""
    ids = anki("findNotes", query=f'deck:"{DECK}" note:"{MODEL}"')
    if not ids:
        return {}
    return {n["fields"][FRONT]["value"]: n["noteId"]
            for n in anki("notesInfo", notes=ids)}


def prune(existing, wanted):
    """Delete deck notes whose front is no longer in the spec."""
    stale = [nid for front, nid in existing.items() if front not in wanted]
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

    check_model()
    ensure_deck()
    existing = deck_notes()
    if not only:
        prune(existing, {front for front, _ in rows})

    added = updated = 0
    for front, back in rows:
        fields = {FRONT: front, BACK: back}
        note_id = existing.get(front)
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
