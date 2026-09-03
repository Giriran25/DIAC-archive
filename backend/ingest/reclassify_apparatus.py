"""Reclassify publisher back-matter that was ingested as body text.

    python -m backend.ingest.reclassify_apparatus --dry-run
    python -m backend.ingest.reclassify_apparatus --apply

The problem
-----------
Each scanned volume ends with a publisher's catalogue headed "WRITINGS AND
SPEECHES / PUBLISHED VOLUMES", listing every title in the series. The ingest
classifier reads it as body text, because it is set as continuous lines and
sits inside the book.

It then behaves like a magnet. It contains the exact title of almost every
work Ambedkar wrote, so it scores at or near the top for any question that
names one, in every volume at once:

    Q: What did Ambedkar say about the annihilation of caste?
    A: 1  z Castes in India  z Annihilation of Caste, Maharashtra as a
       Linguistic Province, Need for Checks and Balances  ...

What this does
--------------
Sets `chunk_kind` from 'body' to 'listing' on those chunks, and nothing else.
No text is altered, deleted or rewritten - the pages remain in the archive,
remain readable at their printed page, and remain reachable through the
document reader. Only their eligibility as retrieval EVIDENCE changes, which
is exactly what `chunk_kind` exists to express: the project already excludes
'toc' and 'listing' from search and from the vector index.

The change is written to the append-only ingest log, so it is auditable
alongside every other operation on the archive.

Deliberately narrow: it matches the one unambiguous marker, and reports
exactly what it will touch before touching it. A broader heuristic would
catch legitimate content - verse, dialogue, tabulated evidence - and
silently remove it from retrieval, which is a far worse failure than one
awkward answer.
"""

from __future__ import annotations

import argparse

from ..app.core import db
from ..retrieval import vector

#: The catalogue's own heading. Both lines must be present, near the top of
#: the chunk, for it to be considered.
MARKER_A = "WRITINGS AND SPEECHES"
MARKER_B = "PUBLISHED VOLUMES"
HEAD_CHARS = 200


def find_candidates(conn) -> list:
    rows = conn.execute(
        "SELECT id, uid, document_id, printed_page_start, text "
        "FROM chunks WHERE chunk_kind = 'body' ORDER BY document_id, seq"
    ).fetchall()
    out = []
    for row in rows:
        head = (row["text"] or "")[:HEAD_CHARS]
        if MARKER_A in head and MARKER_B in head:
            out.append(row)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true",
                       help="list what would change and exit")
    group.add_argument("--apply", action="store_true",
                       help="write the reclassification")
    args = parser.parse_args()

    with db.connect(readonly=True) as conn:
        candidates = find_candidates(conn)

    if not candidates:
        print("No misclassified publisher catalogue found. Nothing to do.")
        return 0

    print(f"{len(candidates)} chunk(s) would be reclassified body -> listing:\n")
    for row in candidates:
        page = row["printed_page_start"]
        page_label = f"p. {page}" if page is not None else "no printed page"
        preview = " ".join((row["text"] or "")[:70].split())
        print(f"  {row['uid']:28} {row['document_id']:16} {page_label:16} {preview}")

    if args.dry_run:
        print("\nDry run: nothing was written.")
        return 0

    ids = [row["id"] for row in candidates]
    with db.connect() as conn:
        conn.executemany(
            "UPDATE chunks SET chunk_kind = 'listing', faiss_id = NULL WHERE id = ?",
            [(i,) for i in ids])
        for row in candidates:
            db.log(conn, "reclassify", row["document_id"],
                   f"{row['uid']} body -> listing (publisher catalogue)",
                   actor="maintenance")
        conn.commit()

    # The vector index must agree with the metadata. IndexIDMap2 stores
    # chunks.id as the vector id, so these can be dropped precisely without
    # re-embedding the corpus. Leaving them would break the archive's own
    # invariant that every vector has a body chunk row behind it.
    removed, remaining = 0, 0
    index = vector.load(force=True)
    if index is not None:
        import numpy as np

        before = index.size
        index.index.remove_ids(np.array(ids, dtype="int64"))
        removed = before - index.size
        remaining = index.size
        vector.save(index)

    print(f"\nReclassified {len(ids)} chunk(s). Text was not modified.")
    print(f"Removed {removed} vector(s); the index now holds {remaining}.")
    print("The passages remain readable in the archive; they are no longer "
          "returned as retrieval evidence.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
