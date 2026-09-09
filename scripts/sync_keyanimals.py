#!/usr/bin/env python3
"""One-way sync: letter animals -> Anki deck "keyanimals" (via AnkiConnect).

The mnemonic animal for each key, from Keyboard Mnemonics.pdf.

Notes use Anki's stock "Basic (and reversed card)" notetype, so each one
yields two cards and drills both ways:

    Q      -> quokka
    quokka -> Q

Cards are text only, by design: the word is the mnemonic.

Nothing here creates or reshapes a notetype: that would mark the collection
schema-modified and force a full AnkiWeb sync. Only notes are touched, and
every lookup is scoped to the deck, so other decks sharing the notetype are
safe.

Usage:
    python3 scripts/sync_keyanimals.py            # sync every letter
    python3 scripts/sync_keyanimals.py Q          # sync only Q
    python3 scripts/sync_keyanimals.py --dry-run  # print what would be sent
"""
import json
import os
import sys
import urllib.request

ANKI_URL = os.environ.get("ANKI_URL", "http://localhost:56666")
DECK = "keyanimals"
MODEL = os.environ.get("ANKI_MODEL", "Basic (and reversed card)")
FRONT, BACK = "Front", "Back"

# letter -> mnemonic animal, keyboard columns left to right.
# Still unassigned: U, I, K, P.
ANIMALS = {
    "Q": "quokka",
    "A": "axolotl",
    "Z": "zouwu",
    "W": "whale",
    "S": "swan",
    "X": "xolo-dog",
    "E": "emu",
    "D": "duck",
    "C": "chameleon",
    "R": "raccoon",
    "F": "flamingo",
    "V": "viper",
    "T": "toucan",
    "G": "giraffe",
    "B": "bat",
    "Y": "yak",
    "H": "husky",
    "N": "narwhal",
    "M": "manta",
    "O": "owl",
    "L": "lion",
}


def anki(action, **params):
    payload = json.dumps({"action": action, "version": 6, "params": params}).encode()
    req = urllib.request.Request(ANKI_URL, data=payload,
                                 headers={"Content-Type": "application/json"})
    resp = json.loads(urllib.request.urlopen(req, timeout=30).read())
    if resp.get("error"):
        raise RuntimeError(f"{action}: {resp['error']}")
    return resp["result"]


def check_model():
    """Fail early rather than half-sync onto a notetype we cannot fill."""
    if MODEL not in anki("modelNames"):
        sys.exit(f"notetype '{MODEL}' not found - set ANKI_MODEL to your "
                 f"local name for Anki's reversed Basic notetype")
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
    only = args[0].upper() if args else None

    rows = list(ANIMALS.items())
    if only:
        rows = [r for r in rows if r[0] == only]
        if not rows:
            sys.exit(f"no animal for {only}")

    if dry:
        for letter, animal in rows:
            print(f"{letter}  {animal}")
        print(f"\n{len(rows)} note(s) / {len(rows) * 2} cards, "
              f"nothing sent (--dry-run)")
        return

    check_model()
    ensure_deck()
    existing = deck_notes()
    if not only:
        prune(existing, {letter for letter, _ in rows})

    added = updated = 0
    for letter, animal in rows:
        fields = {FRONT: letter, BACK: animal}
        note_id = existing.get(letter)
        if note_id:
            anki("updateNoteFields", note={"id": note_id, "fields": fields})
            updated += 1
            print(f"  ~ {letter} {animal}")
        else:
            note_id = anki("addNote", note={"deckName": DECK, "modelName": MODEL,
                                            "fields": fields,
                                            "options": {"allowDuplicate": False}})
            added += 1
            print(f"  + {letter} {animal}")
        place_in_deck(note_id)

    print(f"done: {added} added, {updated} updated")


if __name__ == "__main__":
    main()
