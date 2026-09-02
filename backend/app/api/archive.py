"""Archive browsing, source resolution and preservation.

    GET  /api/archive                        list documents
    GET  /api/archive/{document_id}          one document + its sections
    GET  /api/source/{chunk_id}              resolve a citation to its passage
    GET  /api/source/{document_id}/page/{p}  full text of a printed page
    GET  /api/preservation/{document_id}     checksum and integrity record
    POST /api/preservation/verify/{doc_id}   re-hash the file on disk
    GET  /api/audit-log                      append-only ingestion trail

The source endpoints are what make a citation more than decoration: every
id the retrieval pipeline returns resolves here to the exact passage, on
the exact page, with the character offsets a viewer highlights.
"""

from __future__ import annotations

import hashlib
import sqlite3

from fastapi import APIRouter, HTTPException, Query

from ...retrieval.evidence import to_evidence
from ..core import config, db

router = APIRouter()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _document_public(row: sqlite3.Row) -> dict:
    """Document metadata for the UI. `file_path` is deliberately reduced to
    a filename - the client never receives a filesystem path."""
    path = row["file_path"] or ""
    return {
        "id": row["id"],
        "title": row["title"],
        "author": row["author"],
        "source": row["source"],
        "publisher": row["publisher"],
        "volume": row["volume"],
        "date": row["date_text"],
        "language": row["language"],
        "docType": row["doc_type"],
        "pageCount": row["page_count"],
        "extractionMethod": row["extraction_method"],
        "licence": row["licence"],
        "verificationStatus": row["verification_status"],
        "approvedBy": row["approved_by"],
        "approvedAt": row["approved_at"],
        "createdAt": row["created_at"],
        "filename": path.rsplit("/", 1)[-1],
        "checksum": (row["sha256"] or "")[:16],
        "byteSize": row["byte_size"],
    }


def _require_document(conn: sqlite3.Connection, document_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"No document with id {document_id!r}.")
    return row


CHUNK_JOIN = """
    SELECT c.*,
           d.title AS doc_title, d.volume AS doc_volume, d.doc_type AS doc_type,
           d.date_text AS doc_date, d.author AS doc_author, d.source AS doc_source,
           d.file_path AS doc_path, d.extraction_method AS extraction_method
      FROM chunks c JOIN documents d ON d.id = c.document_id
"""


# ---------------------------------------------------------------------------
# archive
# ---------------------------------------------------------------------------

@router.get("/archive", summary="List archive documents")
def list_archive(
    doc_type: str | None = Query(None, description="Writing | Speech | Debate | Manuscript"),
    language: str | None = Query(None),
    status: str | None = Query(None, description="verification status"),
    q: str | None = Query(None, description="filter on title"),
) -> dict:
    where, params = [], []
    if doc_type:
        where.append("doc_type = ?"); params.append(doc_type)
    if language:
        where.append("language = ?"); params.append(language)
    if status:
        where.append("verification_status = ?"); params.append(status)
    if q:
        where.append("LOWER(title) LIKE ?"); params.append(f"%{q.lower()}%")

    sql = "SELECT * FROM documents"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id"

    with db.connect(readonly=True) as conn:
        rows = conn.execute(sql, params).fetchall()
        documents = []
        for row in rows:
            item = _document_public(row)
            item["chunks"] = conn.execute(
                "SELECT COUNT(*) FROM chunks WHERE document_id = ? AND chunk_kind = 'body'",
                (row["id"],)).fetchone()[0]
            documents.append(item)

        facets = {
            "docTypes": [r[0] for r in conn.execute(
                "SELECT DISTINCT doc_type FROM documents ORDER BY doc_type")],
            "languages": [r[0] for r in conn.execute(
                "SELECT DISTINCT language FROM documents ORDER BY language")],
            "statuses": [r[0] for r in conn.execute(
                "SELECT DISTINCT verification_status FROM documents")],
        }

    return {"count": len(documents), "documents": documents, "facets": facets}


@router.get("/archive/{document_id}", summary="One document with its sections")
def get_document(document_id: str) -> dict:
    with db.connect(readonly=True) as conn:
        row = _require_document(conn, document_id)
        sections = [
            {
                "section": s["section"],
                "chunks": s["n"],
                "pageStart": s["p0"],
                "pageEnd": s["p1"],
            }
            for s in conn.execute(
                """SELECT section, COUNT(*) n,
                          MIN(printed_page_start) p0, MAX(printed_page_start) p1
                     FROM chunks
                    WHERE document_id = ? AND chunk_kind = 'body'
                    GROUP BY section ORDER BY MIN(seq)""", (document_id,))
        ]
        totals = conn.execute(
            """SELECT COUNT(*) n, COALESCE(SUM(char_count), 0) chars,
                      MIN(printed_page_start) p0, MAX(printed_page_end) p1
                 FROM chunks WHERE document_id = ? AND chunk_kind = 'body'""",
            (document_id,)).fetchone()

    return {
        "document": _document_public(row),
        "sections": sections,
        "totals": {
            "chunks": totals["n"], "characters": totals["chars"],
            "printedPageStart": totals["p0"], "printedPageEnd": totals["p1"],
        },
    }


# ---------------------------------------------------------------------------
# source resolution - what a citation opens
# ---------------------------------------------------------------------------

@router.get("/source/{chunk_id}", summary="Resolve a citation to its passage")
def get_source(chunk_id: str, context: int = Query(1, ge=0, le=5)) -> dict:
    """Accepts either the numeric chunk id or the stable uid used in
    citations, so a client can pass back whatever the answer gave it."""
    with db.connect(readonly=True) as conn:
        if chunk_id.isdigit():
            row = conn.execute(CHUNK_JOIN + " WHERE c.id = ?", (int(chunk_id),)).fetchone()
        else:
            row = conn.execute(CHUNK_JOIN + " WHERE c.uid = ?", (chunk_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"No source with id {chunk_id!r}.")

        neighbours = []
        if context:
            for other in conn.execute(
                CHUNK_JOIN + """ WHERE c.document_id = ? AND c.seq BETWEEN ? AND ?
                                   AND c.id != ? ORDER BY c.seq""",
                (row["document_id"], row["seq"] - context, row["seq"] + context, row["id"]),
            ):
                neighbours.append({
                    "uid": other["uid"], "seq": other["seq"],
                    "page": other["printed_page_start"], "text": other["text"],
                })

    return {
        "source": to_evidence(row),
        "context": neighbours,
        "document": row["document_id"],
    }


@router.get("/source/{document_id}/page/{page}", summary="Full text of a page")
def get_page(document_id: str, page: int,
             pdf: bool = Query(False, description="treat `page` as the PDF page")) -> dict:
    """Full-text access (PS req 3). Returns every passage on the page, in
    reading order, including navigation chunks withheld from retrieval -
    reading a page is not the same as searching it."""
    column = "page_start" if pdf else "printed_page_start"
    with db.connect(readonly=True) as conn:
        _require_document(conn, document_id)
        rows = conn.execute(
            CHUNK_JOIN + f" WHERE c.document_id = ? AND c.{column} = ? ORDER BY c.seq",
            (document_id, page)).fetchall()
        if not rows:
            raise HTTPException(
                status_code=404,
                detail=f"No text on {'PDF' if pdf else 'printed'} page {page} of {document_id!r}.")

    return {
        "documentId": document_id,
        "page": page,
        "pageType": "pdf" if pdf else "printed",
        "section": rows[0]["section"],
        "text": "\n\n".join(r["text"] for r in rows),
        "passages": [to_evidence(r) for r in rows],
    }


# ---------------------------------------------------------------------------
# preservation (PS req 12)
# ---------------------------------------------------------------------------

@router.get("/preservation/{document_id}", summary="Integrity record")
def preservation(document_id: str) -> dict:
    with db.connect(readonly=True) as conn:
        row = _require_document(conn, document_id)
        events = [dict(e) for e in conn.execute(
            "SELECT ts, actor, action, detail FROM ingest_log WHERE document_id = ? ORDER BY id",
            (document_id,))]
    present = (config.REPO_ROOT / row["file_path"]).exists()
    return {
        "documentId": row["id"],
        "filename": (row["file_path"] or "").rsplit("/", 1)[-1],
        "sha256": row["sha256"],
        "byteSize": row["byte_size"],
        "ingestedAt": row["created_at"],
        "extractionMethod": row["extraction_method"],
        "verificationStatus": row["verification_status"],
        "sourcePresent": present,
        "events": events,
    }


@router.post("/preservation/verify/{document_id}", summary="Re-hash the source file")
def verify(document_id: str) -> dict:
    """Recomputes the checksum from disk and compares it with the value
    recorded at ingestion. The result is written to the append-only trail,
    so a tamper check is itself auditable."""
    with db.connect(readonly=True) as conn:
        row = _require_document(conn, document_id)

    path = config.REPO_ROOT / row["file_path"]
    if not path.exists():
        outcome = {"documentId": document_id, "verified": False,
                   "reason": "source file is missing from disk",
                   "expected": row["sha256"], "actual": None}
    else:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1 << 20), b""):
                digest.update(block)
        actual = digest.hexdigest()
        match = actual == row["sha256"]
        outcome = {
            "documentId": document_id,
            "verified": match,
            "reason": "checksum matches the ingestion record" if match
                      else "CHECKSUM MISMATCH - the file has changed since ingestion",
            "expected": row["sha256"],
            "actual": actual,
            "byteSize": path.stat().st_size,
        }

    with db.connect() as conn:
        db.log(conn, "verify", document_id,
               f"verified={outcome['verified']} {outcome['reason']}", actor="preservation")
        conn.commit()
    return outcome


@router.get("/audit-log", summary="Append-only ingestion trail")
def audit_log(document_id: str | None = Query(None), limit: int = Query(100, ge=1, le=1000)) -> dict:
    sql = "SELECT id, ts, actor, action, document_id, detail FROM ingest_log"
    params: list = []
    if document_id:
        sql += " WHERE document_id = ?"
        params.append(document_id)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with db.connect(readonly=True) as conn:
        entries = [dict(r) for r in conn.execute(sql, params)]
        total = conn.execute("SELECT COUNT(*) FROM ingest_log").fetchone()[0]
    return {"total": total, "returned": len(entries), "appendOnly": True, "entries": entries}
