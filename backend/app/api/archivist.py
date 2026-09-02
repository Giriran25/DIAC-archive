"""Institutional archival management (PS req 14).

    POST  /api/archivist/upload            register a document for review
    GET   /api/archivist/pending           the review queue
    GET   /api/archivist/item/{id}         one item with its extraction preview
    PATCH /api/archivist/item/{id}         edit metadata before approving
    POST  /api/archivist/item/{id}/approve extract, chunk, index
    POST  /api/archivist/item/{id}/reject

    UPLOAD -> EXTRACT -> METADATA -> PENDING REVIEW -> APPROVE -> INDEX

Approval is the only route into the canonical archive. An uploaded item is
extracted so the archivist can see what they are approving, but nothing it
contains is retrievable until they say so.

Volume 3 was deliberately held back from the Phase 2 corpus for exactly
this demonstration, so the "new document" path runs on real material the
system has genuinely never indexed.
"""

from __future__ import annotations

import hashlib
import re
import sqlite3
import uuid

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ...ingest import sources as registry
from ...ingest.build import ingest_source
from ...ingest.chunk import chunk_document
from ...ingest.extract import extract_pdf
from ...ingest.sources import Source
from ..core import config, db

router = APIRouter()

# Uploads are referenced by a repo-relative path that must stay inside
# Data/. A client cannot make the server read an arbitrary file.
ALLOWED_ROOTS = ("Data/",)


class UploadRequest(BaseModel):
    """Registers a file already present on the edge server.

    Round 2 ingests from the curated corpus on the laptop rather than
    accepting bytes over the network, so this takes a path under Data/
    rather than a multipart body.
    """
    file_path: str = Field(min_length=3, max_length=500)
    title: str | None = Field(default=None, max_length=400)
    doc_type: str = Field(default="Writing", max_length=40)
    volume: str | None = Field(default=None, max_length=60)
    date_text: str | None = Field(default=None, max_length=60)
    language: str = Field(default="en", max_length=5)
    licence: str | None = Field(default=None, max_length=300)
    submitted_by: str = Field(default="archivist", max_length=120)


class MetadataPatch(BaseModel):
    title: str | None = Field(default=None, max_length=400)
    doc_type: str | None = Field(default=None, max_length=40)
    volume: str | None = Field(default=None, max_length=60)
    date_text: str | None = Field(default=None, max_length=60)
    language: str | None = Field(default=None, max_length=5)
    licence: str | None = Field(default=None, max_length=300)
    note: str | None = Field(default=None, max_length=2000)


class Decision(BaseModel):
    reviewer: str = Field(default="archivist", max_length=120)
    note: str | None = Field(default=None, max_length=2000)


def _safe_relative(raw: str):
    rel = raw.replace("\\", "/").lstrip("/")
    if ".." in rel.split("/"):
        raise HTTPException(422, "Path traversal is not permitted.")
    if not rel.startswith(ALLOWED_ROOTS):
        raise HTTPException(422, f"Uploads must live under {' or '.join(ALLOWED_ROOTS)}.")
    path = (config.REPO_ROOT / rel).resolve()
    if not str(path).startswith(str(config.REPO_ROOT.resolve())):
        raise HTTPException(422, "Resolved path escapes the archive root.")
    if not path.exists():
        raise HTTPException(404, f"No file at {rel!r} on this server.")
    return rel, path


def _item_public(row: sqlite3.Row, *, preview: bool = False) -> dict:
    import json
    out = {
        "id": row["id"], "filename": row["filename"], "title": row["title"],
        "status": row["status"], "detectedType": row["detected_type"],
        "pageCount": row["page_count"], "charCount": row["char_count"],
        "chunkEstimate": row["chunk_estimate"],
        "checksum": (row["sha256"] or "")[:16], "byteSize": row["byte_size"],
        "submittedBy": row["submitted_by"], "submittedAt": row["submitted_at"],
        "reviewedBy": row["reviewed_by"], "reviewedAt": row["reviewed_at"],
        "note": row["note"], "documentId": row["document_id"],
        "indexed": row["status"] == "indexed",
    }
    try:
        out["metadata"] = json.loads(row["metadata_json"] or "{}")
    except Exception:
        out["metadata"] = {}
    if preview:
        out["preview"] = row["preview"]
    return out


def _require_item(conn: sqlite3.Connection, item_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM intake_items WHERE id = ?", (item_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"No intake item with id {item_id!r}.")
    return row


@router.post("/archivist/upload", summary="Register a document for review")
def upload(body: UploadRequest) -> dict:
    """Registers and extracts, but does NOT index. The item lands in the
    review queue with a preview so the archivist can judge it."""
    import json

    rel, path = _safe_relative(body.file_path)

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    sha = digest.hexdigest()

    with db.connect(readonly=True) as conn:
        clash = conn.execute("SELECT id FROM documents WHERE sha256 = ?", (sha,)).fetchone()
        if clash:
            raise HTTPException(
                409, f"This exact file is already in the archive as {clash['id']!r}.")
        pending = conn.execute(
            "SELECT id FROM intake_items WHERE sha256 = ? AND status NOT IN ('rejected','failed')",
            (sha,)).fetchone()
        if pending:
            raise HTTPException(409, f"Already awaiting review as intake item {pending['id']!r}.")

    item_id = f"in-{uuid.uuid4().hex[:10]}"
    title = body.title or path.stem.replace("_", " ")

    pages = chars = chunks = 0
    preview = None
    status = "pending_review"
    if path.suffix.lower() == ".pdf":
        try:
            extracted = extract_pdf(path)
            pages = len(extracted.pages)
            chars = len(extracted.full_text)
            chunks = len(chunk_document(extracted))
            preview = extracted.full_text[:1500]
        except Exception as exc:
            status = "failed"
            preview = f"Extraction failed: {type(exc).__name__}: {exc}"

    metadata = {"doc_type": body.doc_type, "volume": body.volume,
                "date_text": body.date_text, "language": body.language,
                "licence": body.licence}

    with db.connect() as conn:
        conn.execute(
            """INSERT INTO intake_items
                 (id, filename, file_path, sha256, byte_size, detected_type, title,
                  metadata_json, page_count, char_count, chunk_estimate, preview,
                  status, submitted_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (item_id, path.name, rel, sha, path.stat().st_size,
             path.suffix.lower().lstrip("."), title, json.dumps(metadata),
             pages, chars, chunks, preview, status, body.submitted_by))
        db.log(conn, "upload", None,
               f"intake={item_id} file={path.name} pages={pages} chunks={chunks} "
               f"status={status} sha256={sha[:16]}", actor=body.submitted_by)
        conn.commit()
        row = _require_item(conn, item_id)

    return {"ok": status != "failed", "item": _item_public(row, preview=True),
            "indexed": False,
            "note": "Registered for review. Nothing is searchable until approved."}


@router.get("/archivist/pending", summary="Review queue")
def pending(status: str | None = Query(None)) -> dict:
    sql = "SELECT * FROM intake_items"
    params: list = []
    if status:
        sql += " WHERE status = ?"
        params.append(status)
    else:
        sql += " WHERE status IN ('uploaded','extracting','pending_review')"
    sql += " ORDER BY submitted_at DESC"

    with db.connect(readonly=True) as conn:
        items = [_item_public(r) for r in conn.execute(sql, params)]
        counts = {r["status"]: r["n"] for r in conn.execute(
            "SELECT status, COUNT(*) n FROM intake_items GROUP BY status")}
        manuscripts = conn.execute(
            "SELECT COUNT(*) FROM manuscript_pages WHERE review_status IN ('pending','in_review')"
        ).fetchone()[0]
    return {"count": len(items), "byStatus": counts,
            "manuscriptPagesAwaitingReview": manuscripts, "items": items}


@router.get("/archivist/item/{item_id}", summary="One intake item")
def get_item(item_id: str) -> dict:
    with db.connect(readonly=True) as conn:
        row = _require_item(conn, item_id)
    return {"item": _item_public(row, preview=True)}


@router.patch("/archivist/item/{item_id}", summary="Edit metadata before approval")
def patch_item(item_id: str, body: MetadataPatch) -> dict:
    import json

    with db.connect(readonly=True) as conn:
        row = _require_item(conn, item_id)
    if row["status"] in ("indexed", "approved"):
        raise HTTPException(409, "This item is already approved; metadata is frozen.")

    try:
        metadata = json.loads(row["metadata_json"] or "{}")
    except Exception:
        metadata = {}
    for field in ("doc_type", "volume", "date_text", "language", "licence"):
        value = getattr(body, field)
        if value is not None:
            metadata[field] = value

    with db.connect() as conn:
        conn.execute(
            """UPDATE intake_items
                  SET title = COALESCE(?, title), metadata_json = ?,
                      note = COALESCE(?, note)
                WHERE id = ?""",
            (body.title, json.dumps(metadata), body.note, item_id))
        db.log(conn, "edit", None, f"intake={item_id} metadata updated", actor="archivist")
        conn.commit()
        row = _require_item(conn, item_id)
    return {"ok": True, "item": _item_public(row, preview=True)}


@router.post("/archivist/item/{item_id}/approve", summary="Approve and index")
def approve(item_id: str, body: Decision) -> dict:
    """Runs the SAME ingestion path as the bulk build - page-aware
    extraction, the section and page-anchor reconciliation, the chunk
    classifier - so an approved document is indistinguishable from one
    ingested at build time."""
    import json

    with db.connect(readonly=True) as conn:
        row = _require_item(conn, item_id)
    if row["status"] == "indexed":
        return {"ok": True, "alreadyIndexed": True, "documentId": row["document_id"]}
    if row["status"] == "failed":
        raise HTTPException(409, "Extraction failed for this item; it cannot be approved.")

    try:
        metadata = json.loads(row["metadata_json"] or "{}")
    except Exception:
        metadata = {}

    document_id = re.sub(r"[^a-z0-9]+", "-", (row["title"] or row["filename"]).lower()).strip("-")
    document_id = f"up-{document_id[:40]}" or f"up-{item_id}"

    existing = registry.by_id(document_id)
    source = Source(
        id=document_id,
        title=row["title"] or row["filename"],
        file_path=row["file_path"],
        doc_type=metadata.get("doc_type") or "Writing",
        volume=metadata.get("volume"),
        date_text=metadata.get("date_text"),
        language=metadata.get("language") or "en",
        licence=metadata.get("licence"),
        running_head=existing.running_head if existing else None,
    )

    try:
        with db.connect() as conn:
            stats = ingest_source(conn, source, verbose=False)
            conn.execute(
                """UPDATE intake_items
                      SET status = 'indexed', document_id = ?, reviewed_by = ?,
                          reviewed_at = datetime('now'), note = COALESCE(?, note)
                    WHERE id = ?""",
                (document_id, body.reviewer, body.note, item_id))
            db.log(conn, "approve", document_id,
                   f"intake={item_id} chunks={stats['chunks']} chars={stats['chars']}",
                   actor=body.reviewer)
            conn.commit()
            updated = _require_item(conn, item_id)
    except HTTPException:
        raise
    except Exception as exc:
        with db.connect() as conn:
            conn.execute("UPDATE intake_items SET status='failed', note=? WHERE id=?",
                         (f"{type(exc).__name__}: {exc}", item_id))
            conn.commit()
        raise HTTPException(500, f"Ingestion failed: {type(exc).__name__}: {exc}")

    return {
        "ok": True, "indexed": True, "documentId": document_id,
        "chunks": stats["chunks"], "characters": stats["chars"],
        "pages": stats["pages"], "seconds": round(stats["seconds"], 2),
        "item": _item_public(updated),
        "note": "Lexical search covers this document immediately. It joins vector "
                "search at the next index build (python -m backend.ingest.build_index).",
    }


@router.post("/archivist/item/{item_id}/reject", summary="Reject an item")
def reject(item_id: str, body: Decision) -> dict:
    with db.connect(readonly=True) as conn:
        row = _require_item(conn, item_id)
    if row["status"] == "indexed":
        raise HTTPException(
            409, "This item is already indexed. Withdraw the document instead of rejecting it.")

    with db.connect() as conn:
        conn.execute(
            """UPDATE intake_items
                  SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now'),
                      note = COALESCE(?, note)
                WHERE id = ?""", (body.reviewer, body.note, item_id))
        db.log(conn, "reject", None, f"intake={item_id}", actor=body.reviewer)
        conn.commit()
        row = _require_item(conn, item_id)
    return {"ok": True, "item": _item_public(row), "indexed": False}
