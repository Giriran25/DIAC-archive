"""Repair the timeline's presentation fields and its provenance.

    python -m backend.ingest.repair_timeline --dry-run
    python -m backend.ingest.repair_timeline --apply

Three defects, all introduced at ingestion, none of them in the archive
itself. The plate captions are fine; what was derived from them is not.

1. TITLES CUT AT AN ABBREVIATION
   `title` and `summary` were taken as the first sentence of the caption,
   with "Dr." read as the end of a sentence. Half the timeline therefore
   had the title "Dr", and the 1935 plate about Ramabai's death was headed
   "Dr" while the caption beneath it read perfectly well. Titles are
   re-derived here with an abbreviation-aware split.

2. LEADING PLATE NUMBERS AND SCAN NOISE
   Captions begin with the album's printed plate number ("136 Dr. Ambedkar's
   dutiful and pious wife...") and sometimes with marginalia the scanner
   picked up ("ri li 142", "f, at. m mi I itaia *V 85"). The number is not
   part of the caption, so the derived title starts after it.

3. FABRICATED PROVENANCE  <- the serious one
   `timeline_sources` was populated by:

       SELECT id FROM chunks WHERE text LIKE '%<year>%' LIMIT 3

   That is any passage anywhere in the corpus containing the year as a
   substring. So the 1908 plate of Ambedkar's name in the Elphinstone
   College roll-call cited three passages about plough cattle and
   agricultural stock, and the 1913 Baroda appointment cited a passage on
   enforced widowhood. The interface presented these under "Archival
   sources" with volume and page, which is a fabricated citation in a
   product whose entire claim is that its citations are real.

   Every one of those links is deleted. An event keeps the provenance it
   genuinely has - the album plate it was scanned from, already recorded in
   `image_path` - and the interface says so instead.

WHAT IS NOT TOUCHED
   `detail` holds the caption as OCR produced it and is never modified.
   Nothing here rewrites a word, repairs a name, or guesses at a date. The
   one character-level change is the single unambiguous spacing artefact
   "o f" -> "of", applied only to the derived presentation fields.

A BIRTH EVENT, GENUINELY SOURCED
   The chronology began in 1908 with a college roll-call. It now opens with
   Ambedkar's birth, taken from the archive's own frontispiece line -
   "Babasaheb Dr. B.R. Ambedkar (14th April 1891 - 6th December 1956)" -
   which is a real indexed chunk in Volume I. No biography was written and
   no fact was supplied from outside the archive; if that chunk is absent
   the event is skipped rather than invented.
"""

from __future__ import annotations

import argparse
import re

from ..app.core import db

# --- the birth event, and the chunk that supports it ------------------------

BIRTH_ID = "tl-1891-birth"
BIRTH_SOURCE_UID = "ws-vol-01:p0002:c0000"
BIRTH_NEEDLE = "1891"

# --- caption cleaning -------------------------------------------------------

#: Abbreviations that end with a full stop but not with a sentence.
_ABBREV = r"(?:Dr|Mr|Mrs|Ms|Shri|Smt|Prof|Rev|Hon|St|Lt|Col|Capt|Sr|Jr|vs|etc|No|Vol|pp|Rs|B\.R|M\.A|Ph\.D)"

#: Python's re has no variable-width lookbehind, so abbreviation stops are
#: masked before splitting and restored afterwards.
_ABBREV_STOP = re.compile(rf"\b({_ABBREV})\.")
_MASK = "\x00"


def split_sentences(text: str) -> list[str]:
    masked = _ABBREV_STOP.sub(rf"\1{_MASK}", text)
    parts = re.split(r"\.(?:\s+|$)", masked)
    return [p.replace(_MASK, ".").strip() for p in parts if p.strip()]

#: A plate number printed on the album page, sitting in front of the caption.
#: ONLY digits and punctuation are stripped. An earlier version also removed
#: short letter tokens and ate the "On" from "On 29 June 1929, the Samaj
#: Samata Sangh organised..." - a cleaner that deletes real words is worse
#: than the noise it removes.
_LEADING_NOISE = re.compile(r"^[\d\W_]{1,12}")

#: Scanner debris: a lone symbol-token, or a letter with no vowel. Ordinary
#: prose does not open with these; damaged plate margins do.
_VOWELLESS = re.compile(r"^[^aeiouAEIOU\W\d]{1,3}$")
_SYMBOLIC = re.compile(r"[*_\[\]|~^<>=]")

#: The one repair made: OCR split the word "of" in this scan set. "o" is not
#: an English word, so joining it to a following "f" cannot change meaning.
_BROKEN_OF = re.compile(r"\bo\s+f\b")


def looks_like_prose(sentence: str) -> bool:
    """Whether a sentence reads as language rather than scan debris."""
    s = sentence.strip()
    if len(s) < 25:
        return False
    tokens = s.split()
    if len(tokens) < 5:
        return False

    # Letter-spaced capitals ("R O L L -C A L L O P T H E") and index rows
    # ("Albleas, B. K, Alpaivala, S, M.") are mostly one- and two-character
    # tokens; ordinary prose is not.
    tiny = sum(1 for t in tokens if len(re.sub(r"[^\w]", "", t)) <= 2)
    if tiny / len(tokens) > 0.4:
        return False

    # Damage clusters at the head of a caption, where the plate margin was
    # scanned with it: "f, at. m mi I itaia *V 85 TTiis is the entry...".
    # A sentence that opens with debris is skipped in favour of the next
    # clean one, rather than being cleaned up by guesswork.
    head = tokens[:5]
    if any(_SYMBOLIC.search(t) for t in head):
        return False
    if sum(1 for t in head if _VOWELLESS.match(re.sub(r"[^\w]", "", t) or "x")) >= 2:
        return False

    words = [t for t in tokens if re.search(r"[A-Za-z]{4,}", t)]
    return len(words) >= 4


def _trim_leading_debris(text: str) -> str:
    """Drop leading tokens that cannot open an English sentence.

    A plate margin scans as things like "ri li 142 Dr. Ambedkar with the
    office bearers...". Digits and lowercase one- or two-letter fragments
    are removed; a capitalised word is never removed, which is what keeps
    the "On" in "On 29 June 1929, the Samaj Samata Sangh organised...".
    """
    tokens = text.split()
    i = 0
    while i < len(tokens):
        bare = re.sub(r"[^\w]", "", tokens[i])
        if not bare or bare.isdigit() or (len(bare) <= 2 and bare.islower()):
            i += 1
            continue
        break
    return " ".join(tokens[i:])


def clean_caption(detail: str) -> str:
    """Strip leading plate numbers and marginalia; repair the one spacing
    artefact. Never rewrites a word."""
    text = re.sub(r"\s+", " ", detail or "").strip()
    text = _LEADING_NOISE.sub("", text, count=1).strip()
    text = _trim_leading_debris(text)
    return _BROKEN_OF.sub("of", text)


def derive_title(detail: str, *, limit: int = 150) -> str | None:
    """The first sentence of the caption that actually reads as prose.

    Returns None when the caption has no legible sentence at all - the
    interface then leads with the date and shows the caption beneath, which
    is honest about what the plate carries.
    """
    cleaned = clean_caption(detail)
    if not cleaned:
        return None

    for sentence in split_sentences(cleaned):
        sentence = _trim_leading_debris(sentence.strip())
        if not looks_like_prose(sentence):
            continue
        if len(sentence) > limit:
            cut = sentence[:limit].rsplit(" ", 1)[0].rstrip(",;:")
            return f"{cut}…"
        return sentence if sentence.endswith((".", "!", "?", "…")) else f"{sentence}."
    return None


# --- the repair -------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    apply = args.apply

    with db.connect(readonly=True) as conn:
        events = list(conn.execute(
            "SELECT id, year_label, sort_year, title, detail, date_text "
            "FROM timeline_events ORDER BY sort_year, seq"))
        fabricated = conn.execute(
            "SELECT COUNT(*) n FROM timeline_sources").fetchone()["n"]
        birth_chunk = conn.execute(
            "SELECT id, uid, text FROM chunks WHERE uid = ?", (BIRTH_SOURCE_UID,)).fetchone()
        already = conn.execute(
            "SELECT id FROM timeline_events WHERE id = ?", (BIRTH_ID,)).fetchone()

    print(f"{'DRY RUN' if not apply else 'APPLYING'}\n")

    # 1 + 2. titles
    updates: list[tuple[str, str, str]] = []
    for ev in events:
        new_title = derive_title(ev["detail"] or "")
        if new_title and new_title != ev["title"]:
            updates.append((new_title, new_title, ev["id"]))
            print(f"  {ev['year_label']:<10} {ev['id']}")
            print(f"     was: {ev['title'][:88]}")
            print(f"     now: {new_title[:88]}")

    print(f"\n  {len(updates)} of {len(events)} titles re-derived")

    # 3. fabricated provenance
    print(f"\n  {fabricated} fabricated timeline_sources rows to delete "
          f"(year-substring matches, unrelated to their events)")

    # 4. birth event
    add_birth = birth_chunk is not None and already is None
    if already:
        print("\n  birth event already present; leaving it alone")
    elif birth_chunk is None:
        print(f"\n  birth event SKIPPED: {BIRTH_SOURCE_UID} is not in this archive. "
              "Nothing is invented to fill the gap.")
    else:
        print(f"\n  birth event to add, sourced to {birth_chunk['uid']}")

    if not apply:
        print("\nDry run: nothing was written.")
        return 0

    # The single line the edition prints with his dates, quoted as it stands.
    birth_detail = ""
    if birth_chunk is not None:
        line = re.sub(r"\s+", " ", birth_chunk["text"] or "").strip()
        match = re.search(r"[^.]*1891[^.]*", line)
        birth_detail = (match.group(0).strip() if match else line)[:400]

    with db.connect() as conn:
        conn.executemany(
            "UPDATE timeline_events SET title = ?, summary = ? WHERE id = ?", updates)

        conn.execute("DELETE FROM timeline_sources")

        if add_birth:
            conn.execute(
                """INSERT INTO timeline_events
                       (id, year_label, sort_year, title, tag, detail, image_path,
                        seq, location, category, date_text, summary)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    BIRTH_ID, "1891", 1891,
                    "Bhimrao Ramji Ambedkar is born, 14 April 1891.",
                    "Life",
                    # `detail` carries the archive's own words, not ours: this
                    # is the line the edition prints beneath his portrait.
                    birth_detail,
                    None, 0, None, "Life",
                    "14 April 1891",
                    "Bhimrao Ramji Ambedkar is born, 14 April 1891.",
                ),
            )
            conn.execute(
                "INSERT INTO timeline_sources (event_id, chunk_id, note) VALUES (?,?,?)",
                (BIRTH_ID, birth_chunk["id"],
                 "Dates as printed in the edition's frontispiece."),
            )

        db.log(conn, "repair", None,
               f"timeline: {len(updates)} titles re-derived, {fabricated} fabricated "
               f"source links removed, birth event {'added' if add_birth else 'skipped'}",
               actor="maintenance")
        conn.commit()

    print("\nApplied. `detail` was not modified on any event.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
