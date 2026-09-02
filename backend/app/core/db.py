"""SQLite access for the canonical archive.

One database file is the whole archive (PS req 17). Connections are opened
per-operation rather than shared, because FastAPI handlers and the ingest
CLI both use this module and SQLite connections are not safely shared
across threads.
"""

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from . import config


def _configure(conn: sqlite3.Connection) -> None:
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # WAL lets the read-only API keep serving while an ingest writes.
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")


@contextmanager
def connect(path: Path | None = None, *, readonly: bool = False) -> Iterator[sqlite3.Connection]:
    """Open the archive. `readonly=True` enforces the visitor role at the
    driver level (PS req 12) - a visitor request physically cannot write."""
    db_path = Path(path or config.DB_PATH)

    if readonly:
        # URI mode is the only way to get a genuinely read-only handle.
        uri = f"file:{db_path.as_posix()}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=10.0)
        conn.row_factory = sqlite3.Row
    else:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(db_path, timeout=30.0)
        _configure(conn)

    try:
        yield conn
    finally:
        conn.close()


# Columns added to tables that already existed in an earlier schema.
# CREATE TABLE IF NOT EXISTS cannot add these, and ALTER TABLE ADD COLUMN is
# not idempotent, so they are applied only when absent.
_ADDED_COLUMNS: dict[str, list[tuple[str, str]]] = {
    "timeline_events": [
        ("location", "TEXT"),
        ("category", "TEXT"),
        ("date_text", "TEXT"),
        ("summary", "TEXT"),
    ],
}


ENTITY_KINDS = "'person','work','event','place','theme','document','speech'"


def _widen_entity_kinds(conn: sqlite3.Connection) -> bool:
    """Widen entities.kind to the full entity vocabulary.

    SQLite cannot ALTER a CHECK constraint, so the table is rebuilt. An
    over-narrow CHECK is silently destructive here: INSERT OR IGNORE
    swallows the violation, so a 'place' row simply never appeared.
    """
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='entities'").fetchone()
    if not row or "'place'" in (row["sql"] or ""):
        return False

    conn.executescript(f"""
        PRAGMA foreign_keys = OFF;
        CREATE TABLE entities_new (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            kind        TEXT NOT NULL CHECK (kind IN ({ENTITY_KINDS})),
            name        TEXT NOT NULL,
            description TEXT,
            UNIQUE (kind, name)
        );
        INSERT INTO entities_new (id, kind, name, description)
            SELECT id, kind, name, description FROM entities;
        DROP TABLE entities;
        ALTER TABLE entities_new RENAME TO entities;
        PRAGMA foreign_keys = ON;
    """)
    return True


def _apply_column_migrations(conn: sqlite3.Connection) -> list[str]:
    applied = []
    for table, columns in _ADDED_COLUMNS.items():
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        if not row:
            continue
        existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        for name, decl in columns:
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
                applied.append(f"{table}.{name}")
    return applied


def init_db(path: Path | None = None) -> Path:
    """Create the schema if absent, and upgrade an existing archive in
    place. Safe to run repeatedly; never drops or rewrites data."""
    db_path = Path(path or config.DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    schema = config.SCHEMA_PATH.read_text(encoding="utf-8")

    with connect(db_path) as conn:
        conn.executescript(schema)
        _apply_column_migrations(conn)
        _widen_entity_kinds(conn)
        conn.commit()
    return db_path


def log(conn: sqlite3.Connection, action: str, document_id: str | None = None,
        detail: str | None = None, actor: str = "system") -> None:
    """Append to the immutable ingestion trail. Never updates, never deletes."""
    conn.execute(
        "INSERT INTO ingest_log (actor, action, document_id, detail) VALUES (?, ?, ?, ?)",
        (actor, action, document_id, detail),
    )


def archive_stats(conn: sqlite3.Connection) -> dict:
    """Canonical counts. Every surface - visitor, archivist, kiosk - reads
    these same numbers, which is what makes the archive centralized."""
    def scalar(sql: str, default=0):
        row = conn.execute(sql).fetchone()
        return (row[0] if row and row[0] is not None else default)

    return {
        "documents": scalar("SELECT COUNT(*) FROM documents"),
        "documents_approved": scalar(
            "SELECT COUNT(*) FROM documents WHERE verification_status = 'approved'"),
        "documents_pending": scalar(
            "SELECT COUNT(*) FROM documents WHERE verification_status IN ('pending','in_review')"),
        "chunks": scalar("SELECT COUNT(*) FROM chunks"),
        "chunks_indexed_vector": scalar(
            "SELECT COUNT(*) FROM chunks WHERE faiss_id IS NOT NULL"),
        "characters": scalar("SELECT COALESCE(SUM(char_count), 0) FROM chunks"),
        "pages": scalar("SELECT COALESCE(SUM(page_count), 0) FROM documents"),
        "entities": scalar("SELECT COUNT(*) FROM entities"),
        "timeline_events": scalar("SELECT COUNT(*) FROM timeline_events"),
        "ingest_log_entries": scalar("SELECT COUNT(*) FROM ingest_log"),
    }
