"""Build the canonical archive: source PDFs -> SQLite + FTS5.

Usage
    python -m backend.ingest.build                 # everything due this phase
    python -m backend.ingest.build --only ws-vol-01
    python -m backend.ingest.build --phase 2
    python -m backend.ingest.build --rebuild       # drop and re-ingest

Re-running is safe: a document is replaced atomically, so a failed run
never leaves the archive half-populated.
"""

from __future__ import annotations

import argparse
import hashlib
from collections import Counter
import sys
import time
from pathlib import Path

from ..app.core import config, db
from . import sources as registry
from .chunk import Chunk, chunk_document
from .extract import extract_pdf, page_offset, reconcile_pages
from .sources import Source


def sha256(path: Path) -> str:
    """Checksum for the preservation manifest (PS req 12)."""
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def build_citation(src: Source, chunk: Chunk) -> str:
    """A citation a reader could actually follow to the page.

    Prefers the printed page number, because that is what a scholar cites;
    the PDF page is carried separately for the source viewer.
    """
    parts = [src.title.split(",")[0] if "," in src.title else src.title]
    if src.volume:
        parts.append(src.volume)
    if chunk.section:
        parts.append(chunk.section)

    page = chunk.printed_page_start
    if page is not None:
        if chunk.printed_page_end and chunk.printed_page_end != page:
            parts.append(f"pp. {page}-{chunk.printed_page_end}")
        else:
            parts.append(f"p. {page}")
    else:
        parts.append(f"PDF p. {chunk.page_start}")

    return ", ".join(parts)


def ingest_source(conn, src: Source, *, verbose: bool = True) -> dict:
    path = (config.REPO_ROOT / src.file_path).resolve()
    if not path.exists():
        raise FileNotFoundError(f"{src.id}: missing source file {path}")

    started = time.perf_counter()
    if verbose:
        print(f"  [{src.id}] {path.name}")

    digest = sha256(path)
    size = path.stat().st_size

    doc = extract_pdf(path, book_title_header=src.running_head)
    page_stats = reconcile_pages(doc)
    offset = page_offset(doc)
    chunks = chunk_document(doc)

    if not chunks:
        raise RuntimeError(f"{src.id}: extraction produced no chunks")

    # Replace atomically. ON DELETE CASCADE clears the old chunks, and the
    # FTS triggers keep the index in step.
    conn.execute("DELETE FROM documents WHERE id = ?", (src.id,))
    conn.execute(
        """INSERT INTO documents
             (id, title, author, source, publisher, volume, date_text, language,
              doc_type, file_path, sha256, byte_size, page_count,
              extraction_method, licence, verification_status, approved_by, approved_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))""",
        (src.id, src.title, src.author, src.source, src.publisher, src.volume,
         src.date_text, src.language, src.doc_type, src.file_path, digest, size,
         doc.page_count, "text_layer", src.licence, "approved", "ingest"),
    )

    rows = []
    for chunk in chunks:
        rows.append((
            f"{src.id}:p{chunk.page_start:04d}:c{chunk.seq:04d}",
            src.id,
            chunk.seq,
            chunk.text,
            chunk.char_count,
            chunk.page_start,
            chunk.page_end,
            chunk.printed_page_start,
            chunk.printed_page_end,
            chunk.char_start,
            chunk.char_end,
            chunk.section,
            src.language,
            chunk.kind,
            # NULL confidence: a clean embedded text layer has no engine
            # score, and inventing one is exactly what this build refuses
            # to do. OCR sources (Phase 4) carry a real Tesseract value.
            None,
            "approved",
        ))

    conn.executemany(
        """INSERT INTO chunks
             (uid, document_id, seq, text, char_count,
              page_start, page_end, printed_page_start, printed_page_end,
              char_start, char_end, section, language, chunk_kind,
              confidence, verification_status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        rows,
    )

    elapsed = time.perf_counter() - started
    kinds = Counter(c.kind for c in chunks)
    detail = (
        f"pages={len(doc.pages)}/{doc.page_count} chunks={len(chunks)} "
        f"body={kinds['body']} toc={kinds['toc']} listing={kinds['listing']} "
        f"chars={sum(c.char_count for c in chunks)} page_offset={offset} "
        f"pages_detected={page_stats['detected']} inferred={page_stats['inferred']} "
        f"corrected={page_stats['corrected']} unknown={page_stats['unknown']} "
        f"sha256={digest[:16]}"
    )
    db.log(conn, "extract", src.id, detail, actor="ingest")
    db.log(conn, "index", src.id, f"fts5 rows={len(chunks)}", actor="ingest")

    if verbose:
        print(f"      pages {len(doc.pages)}/{doc.page_count}  chunks {len(chunks)}  "
              f"chars {sum(c.char_count for c in chunks):,}  {elapsed:.1f}s")
        print(f"      page offset {offset}  detected {page_stats['detected']}  "
              f"corrected {page_stats['corrected']}  unknown {page_stats['unknown']}")
        print(f"      retrievable body {kinds['body']}  withheld: toc {kinds['toc']}, listing {kinds['listing']}")

    return {
        "id": src.id,
        "pages": len(doc.pages),
        "page_count": doc.page_count,
        "chunks": len(chunks),
        "chars": sum(c.char_count for c in chunks),
        "sha256": digest,
        "seconds": elapsed,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build the DAIC ARCHIVE canonical store")
    ap.add_argument("--phase", type=int, default=1, help="ingest sources due up to this phase")
    ap.add_argument("--only", action="append", help="ingest just this source id (repeatable)")
    ap.add_argument("--rebuild", action="store_true", help="delete the database first")
    args = ap.parse_args(argv)

    if args.rebuild and config.DB_PATH.exists():
        for suffix in ("", "-wal", "-shm"):
            p = Path(str(config.DB_PATH) + suffix)
            if p.exists():
                p.unlink()
        print(f"removed {config.DB_PATH}")

    db.init_db()
    print(f"archive: {config.DB_PATH}")

    if args.only:
        chosen = [s for s in (registry.by_id(i) for i in args.only) if s]
        missing = set(args.only) - {s.id for s in chosen}
        if missing:
            print(f"unknown source id(s): {', '.join(sorted(missing))}", file=sys.stderr)
            return 2
    else:
        chosen = registry.for_phase(args.phase)

    if not chosen:
        print("nothing to ingest")
        return 0

    print(f"ingesting {len(chosen)} source(s)\n")
    results, failures = [], []
    with db.connect() as conn:
        for src in chosen:
            try:
                results.append(ingest_source(conn, src))
                conn.commit()
            except Exception as exc:  # keep going; report at the end
                conn.rollback()
                failures.append((src.id, str(exc)))
                print(f"      FAILED: {exc}", file=sys.stderr)

        with db.connect() as read_conn:
            stats = db.archive_stats(read_conn)

    print("\ncanonical archive now holds:")
    for key in ("documents", "chunks", "characters", "pages", "ingest_log_entries"):
        print(f"   {key:20s} {stats[key]:,}")

    if failures:
        print(f"\n{len(failures)} source(s) failed:", file=sys.stderr)
        for sid, err in failures:
            print(f"   {sid}: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
