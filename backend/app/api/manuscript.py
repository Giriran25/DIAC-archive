"""Manuscript viewer and the OCR review workflow (PS req 5, 15).

    GET  /api/manuscripts                       list
    GET  /api/manuscript/{id}                   pages + review counts
    GET  /api/manuscript/{id}/page/{page}       image + text + metadata
    GET  /api/manuscript/{id}/page/{page}/image the page scan itself
    POST /api/ocr                               run OCR on one page
    POST /api/manuscript/{id}/review            record a correction
    POST /api/manuscript/{id}/approve           make a page authoritative
    POST /api/manuscript/{id}/reject            keep it out of the archive

The rule this module exists to enforce:

    SCAN -> OCR -> confidence -> HUMAN REVIEW -> APPROVE -> indexable

**Unapproved text is never retrievable.** Approval is the only path that
writes a chunk, and every chunk it writes is marked so the retrieval layer
treats it exactly like any other approved passage. Rejection and
un-approval delete the chunk again, so withdrawal is as real as approval.
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ...ocr import get_ocr_provider
from ..core import config, db

router = APIRouter()

IMAGE_DPI = int(__import__("os").getenv("DAIC_MANUSCRIPT_DPI", "110"))


class ReviewRequest(BaseModel):
    page: int = Field(ge=1)
    corrected_text: str | None = Field(default=None, max_length=200_000)
    note: str | None = Field(default=None, max_length=2000)
    reviewer: str = Field(default="archivist", max_length=120)


class DecisionRequest(BaseModel):
    page: int = Field(ge=1)
    reviewer: str = Field(default="archivist", max_length=120)
    note: str | None = Field(default=None, max_length=2000)


class OCRRequest(BaseModel):
    manuscript_id: str
    page: int = Field(ge=1)
    language: str = Field(default="eng", max_length=12)
    overwrite: bool = False


def _require_manuscript(conn: sqlite3.Connection, manuscript_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM manuscripts WHERE id = ?", (manuscript_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"No manuscript with id {manuscript_id!r}.")
    return row


def _require_page(conn: sqlite3.Connection, manuscript_id: str, page: int) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM manuscript_pages WHERE manuscript_id = ? AND page = ?",
        (manuscript_id, page)).fetchone()
    if row is None:
        raise HTTPException(404, f"Manuscript {manuscript_id!r} has no page {page}.")
    return row


def _page_public(row: sqlite3.Row, *, include_text: bool = True) -> dict:
    out = {
        "manuscriptId": row["manuscript_id"],
        "page": row["page"],
        "width": row["width"],
        "height": row["height"],
        "hasImage": bool(row["image_path"] or row["source_image"]),
        "imageUrl": f"/api/manuscript/{row['manuscript_id']}/page/{row['page']}/image",
        "caption": row["caption"],
        "ocrEngine": row["ocr_engine"],
        # Real engine score or null. Never estimated.
        "ocrConfidence": row["ocr_confidence"],
        "reviewStatus": row["review_status"],
        "reviewer": row["reviewer"],
        "reviewedAt": row["reviewed_at"],
        "reviewNote": row["review_note"],
        "indexed": row["chunk_id"] is not None,
        "searchable": row["review_status"] == "approved" and row["chunk_id"] is not None,
    }
    if include_text:
        out["ocrText"] = row["ocr_text"]
        out["correctedText"] = row["corrected_text"]
        out["authoritativeText"] = row["corrected_text"] or row["ocr_text"]
    return out


@router.get("/manuscripts", summary="List manuscripts")
def list_manuscripts() -> dict:
    with db.connect(readonly=True) as conn:
        items = []
        for row in conn.execute("SELECT * FROM manuscripts ORDER BY id"):
            counts = {
                r["review_status"]: r["n"] for r in conn.execute(
                    """SELECT review_status, COUNT(*) n FROM manuscript_pages
                        WHERE manuscript_id = ? GROUP BY review_status""", (row["id"],))
            }
            items.append({
                "id": row["id"], "title": row["title"],
                "description": row["description"], "collection": row["collection"],
                "source": row["source"], "licence": row["licence"],
                "pageCount": row["page_count"], "review": counts,
            })
    return {"count": len(items), "manuscripts": items}


@router.get("/manuscript/{manuscript_id}", summary="Manuscript with its pages")
def get_manuscript(manuscript_id: str,
                   status: str | None = Query(None, description="filter by review status")) -> dict:
    with db.connect(readonly=True) as conn:
        row = _require_manuscript(conn, manuscript_id)
        sql = "SELECT * FROM manuscript_pages WHERE manuscript_id = ?"
        params: list = [manuscript_id]
        if status:
            sql += " AND review_status = ?"
            params.append(status)
        sql += " ORDER BY page"
        pages = [_page_public(p, include_text=False) for p in conn.execute(sql, params)]
        counts = {
            r["review_status"]: r["n"] for r in conn.execute(
                """SELECT review_status, COUNT(*) n FROM manuscript_pages
                    WHERE manuscript_id = ? GROUP BY review_status""", (manuscript_id,))
        }
    return {
        "manuscript": {
            "id": row["id"], "title": row["title"], "description": row["description"],
            "collection": row["collection"], "source": row["source"],
            "licence": row["licence"], "pageCount": row["page_count"],
        },
        "review": counts,
        "pages": pages,
    }


@router.get("/manuscript/{manuscript_id}/page/{page}", summary="One manuscript page")
def get_page(manuscript_id: str, page: int) -> dict:
    with db.connect(readonly=True) as conn:
        _require_manuscript(conn, manuscript_id)
        row = _require_page(conn, manuscript_id, page)
    return {"page": _page_public(row)}


@router.get("/manuscript/{manuscript_id}/page/{page}/image", summary="Page scan")
def get_page_image(manuscript_id: str, page: int,
                   width: int = Query(1200, ge=200, le=4000,
                                      description="longest edge, in pixels")) -> Response:
    """Renders the original scan on demand, scaled to a requested width.

    The JP2 masters are 2000-5100 px and carry no DPI metadata, so a `dpi`
    argument does not scale them - a request measured 4.1 MB. Scaling by
    an explicit longest edge is predictable, and lets the viewer ask for a
    thumbnail or a zoom level without storing a second copy of every plate.

    JPEG is used above the thumbnail sizes: these are photographic scans,
    where PNG costs several times the bytes for no visible gain over a LAN.
    """
    with db.connect(readonly=True) as conn:
        _require_manuscript(conn, manuscript_id)
        row = _require_page(conn, manuscript_id, page)

    source = config.REPO_ROOT / (row["image_path"] or row["source_image"])
    if not source.exists():
        raise HTTPException(404, f"Scan for page {page} is not present on this server.")

    try:
        import fitz
        doc = fitz.open(source)
        native = doc[0].rect
        longest = max(native.width, native.height) or 1
        scale = min(1.0, width / longest)
        pixmap = doc[0].get_pixmap(matrix=fitz.Matrix(scale, scale))

        if width <= 400:
            payload, media_type = pixmap.tobytes("png"), "image/png"
        else:
            payload, media_type = pixmap.tobytes("jpeg", jpg_quality=82), "image/jpeg"
        doc.close()
    except Exception as exc:
        raise HTTPException(500, f"Could not render page {page}: {type(exc).__name__}")

    return Response(content=payload, media_type=media_type,
                    headers={"Cache-Control": "public, max-age=86400"})


@router.post("/ocr", summary="Run OCR on a manuscript page")
def run_ocr(body: OCRRequest) -> dict:
    """Produces a CANDIDATE transcription and leaves the page pending.

    Nothing here makes text authoritative - that requires approval. The
    engine that ran and the confidence it reported (or null, when it
    reports none) are both recorded verbatim.
    """
    with db.connect(readonly=True) as conn:
        manuscript = _require_manuscript(conn, body.manuscript_id)
        page = _require_page(conn, body.manuscript_id, body.page)

    if page["ocr_text"] and not body.overwrite:
        return {"ok": True, "skipped": True,
                "reason": "page already has candidate text; pass overwrite=true to redo",
                "page": _page_public(page)}
    if page["review_status"] == "approved":
        raise HTTPException(409, "Page is approved; reject it before re-running OCR.")

    paired = config.REPO_ROOT / manuscript["paired_pdf"] if manuscript["paired_pdf"] else None
    provider = get_ocr_provider(paired)
    health = provider.health()
    if not health.available:
        raise HTTPException(503, f"No OCR engine available: {health.detail}")

    image = config.REPO_ROOT / (page["source_image"] or "")
    result = provider.recognise(image, lang=body.language)
    if not result.ok:
        raise HTTPException(502, f"OCR failed: {result.error}")

    with db.connect() as conn:
        conn.execute(
            """UPDATE manuscript_pages
                  SET ocr_text = ?, ocr_engine = ?, ocr_confidence = ?,
                      review_status = 'pending'
                WHERE manuscript_id = ? AND page = ?""",
            (result.text, result.engine, result.confidence, body.manuscript_id, body.page))
        db.log(conn, "ocr", None,
               f"{body.manuscript_id} p{body.page} engine={result.engine} "
               f"words={result.words} confidence={result.confidence}", actor="ocr")
        conn.commit()
        row = _require_page(conn, body.manuscript_id, body.page)

    return {"ok": True, "engine": result.engine, "words": result.words,
            "confidence": result.confidence, "page": _page_public(row)}


@router.post("/manuscript/{manuscript_id}/review", summary="Record a correction")
def review(manuscript_id: str, body: ReviewRequest) -> dict:
    with db.connect(readonly=True) as conn:
        _require_manuscript(conn, manuscript_id)
        _require_page(conn, manuscript_id, body.page)

    with db.connect() as conn:
        conn.execute(
            """UPDATE manuscript_pages
                  SET corrected_text = COALESCE(?, corrected_text),
                      review_note = COALESCE(?, review_note),
                      reviewer = ?, reviewed_at = datetime('now'),
                      review_status = 'in_review'
                WHERE manuscript_id = ? AND page = ?""",
            (body.corrected_text, body.note, body.reviewer, manuscript_id, body.page))
        db.log(conn, "edit", None,
               f"{manuscript_id} p{body.page} corrected={body.corrected_text is not None}",
               actor=body.reviewer)
        conn.commit()
        row = _require_page(conn, manuscript_id, body.page)
    return {"ok": True, "page": _page_public(row)}


@router.post("/manuscript/{manuscript_id}/approve", summary="Approve and index a page")
def approve(manuscript_id: str, body: DecisionRequest) -> dict:
    """Approval is the ONLY route by which manuscript text becomes
    searchable. It writes a chunk carrying the page anchors and the real
    OCR confidence, so an answer citing it is as traceable as one citing a
    printed volume."""
    with db.connect(readonly=True) as conn:
        manuscript = _require_manuscript(conn, manuscript_id)
        page = _require_page(conn, manuscript_id, body.page)

    text = (page["corrected_text"] or page["ocr_text"] or "").strip()
    if not text:
        raise HTTPException(400, "Page has no text to approve; run OCR or supply a correction.")

    document_id = f"ms-{manuscript_id}"
    with db.connect() as conn:
        # The manuscript is represented in the canonical archive as one
        # document, created on first approval so an empty shell never
        # appears in the archive listing.
        exists = conn.execute("SELECT 1 FROM documents WHERE id = ?", (document_id,)).fetchone()
        if not exists:
            conn.execute(
                """INSERT INTO documents
                     (id, title, author, source, publisher, volume, date_text, language,
                      doc_type, file_path, sha256, byte_size, page_count,
                      extraction_method, licence, verification_status, approved_by, approved_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))""",
                (document_id, manuscript["title"], None, manuscript["source"], None, None,
                 None, "en", "Manuscript", manuscript["source_path"] or "",
                 "", 0, manuscript["page_count"], "ocr", manuscript["licence"],
                 "approved", body.reviewer))

        if page["chunk_id"]:
            conn.execute("DELETE FROM chunks WHERE id = ?", (page["chunk_id"],))

        uid = f"{document_id}:p{body.page:04d}:c0000"
        cursor = conn.execute(
            """INSERT INTO chunks
                 (uid, document_id, seq, text, char_count,
                  page_start, page_end, printed_page_start, printed_page_end,
                  char_start, char_end, section, language, chunk_kind,
                  confidence, verification_status)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'body',?,'approved')""",
            (uid, document_id, body.page, text, len(text),
             body.page, body.page, body.page, body.page, 0, len(text),
             page["caption"] or manuscript["title"], "en", page["ocr_confidence"]))
        chunk_id = cursor.lastrowid

        conn.execute(
            """UPDATE manuscript_pages
                  SET review_status = 'approved', reviewer = ?, reviewed_at = datetime('now'),
                      review_note = COALESCE(?, review_note), chunk_id = ?
                WHERE manuscript_id = ? AND page = ?""",
            (body.reviewer, body.note, chunk_id, manuscript_id, body.page))
        db.log(conn, "approve", document_id,
               f"{manuscript_id} p{body.page} chunk={chunk_id} chars={len(text)}",
               actor=body.reviewer)
        conn.commit()
        row = _require_page(conn, manuscript_id, body.page)

    return {"ok": True, "indexed": True, "chunkId": chunk_id, "uid": uid,
            "documentId": document_id, "page": _page_public(row),
            "note": "Lexical search covers this page immediately. It joins vector "
                    "search at the next index build."}


@router.post("/manuscript/{manuscript_id}/reject", summary="Reject a page")
def reject(manuscript_id: str, body: DecisionRequest) -> dict:
    """Rejection withdraws the page from the archive. If it had been
    approved, its chunk is deleted, so retrieval stops seeing it at once."""
    with db.connect(readonly=True) as conn:
        _require_manuscript(conn, manuscript_id)
        page = _require_page(conn, manuscript_id, body.page)

    with db.connect() as conn:
        if page["chunk_id"]:
            conn.execute("DELETE FROM chunks WHERE id = ?", (page["chunk_id"],))
        conn.execute(
            """UPDATE manuscript_pages
                  SET review_status = 'rejected', reviewer = ?, reviewed_at = datetime('now'),
                      review_note = COALESCE(?, review_note), chunk_id = NULL
                WHERE manuscript_id = ? AND page = ?""",
            (body.reviewer, body.note, manuscript_id, body.page))
        db.log(conn, "reject", None, f"{manuscript_id} p{body.page}", actor=body.reviewer)
        conn.commit()
        row = _require_page(conn, manuscript_id, body.page)
    return {"ok": True, "withdrawn": bool(page["chunk_id"]), "page": _page_public(row)}
