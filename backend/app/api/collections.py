"""Timeline, knowledge mapping and the audio/video archive.

    GET /api/timeline                  events for the timeline + story cards
    GET /api/timeline/{event_id}       one event with its sources and media
    GET /api/entities                  people, works, events, places, themes
    GET /api/entities/{id}
    GET /api/entities/{id}/related     what else the archive links it to
    GET /api/media                     audio/video assets
    GET /api/media/{id}
    GET /api/media/{id}/transcript
    GET /api/media/{id}/segments       timestamped, citable
    GET /api/media/{id}/stream         range-served bytes

Knowledge mapping stays in SQLite. At this scale a graph database would
add an install, a second source of truth and a sync problem, and buy
nothing: "what else links to this" is one indexed join.
"""

from __future__ import annotations

import mimetypes
import sqlite3

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response, StreamingResponse

from ..core import config, db

router = APIRouter()

STREAM_CHUNK = 1 << 18          # 256 KB - never load a media file into memory


# ---------------------------------------------------------------------------
# timeline (PS req 9, 10)
# ---------------------------------------------------------------------------

def _event_public(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "year": row["year_label"],
        "sortYear": row["sort_year"],
        "date": row["date_text"],
        "title": row["title"],
        "category": row["category"] or row["tag"],
        "tag": row["tag"],
        "location": row["location"],
        "summary": row["summary"],
        "detail": row["detail"],
        "image": row["image_path"],
        "seq": row["seq"],
    }


@router.get("/timeline", summary="Timeline events")
def timeline(category: str | None = Query(None)) -> dict:
    sql = "SELECT * FROM timeline_events"
    params: list = []
    if category:
        sql += " WHERE category = ? OR tag = ?"
        params += [category, category]
    sql += " ORDER BY sort_year, seq"

    with db.connect(readonly=True) as conn:
        events = []
        for row in conn.execute(sql, params):
            item = _event_public(row)
            item["sourceCount"] = conn.execute(
                "SELECT COUNT(*) FROM timeline_sources WHERE event_id = ?",
                (row["id"],)).fetchone()[0]
            events.append(item)
        categories = [r[0] for r in conn.execute(
            "SELECT DISTINCT COALESCE(category, tag) FROM timeline_events "
            "WHERE COALESCE(category, tag) IS NOT NULL ORDER BY 1")]
    return {"count": len(events), "categories": categories, "events": events}


@router.get("/timeline/{event_id}", summary="One timeline event")
def timeline_event(event_id: str) -> dict:
    """Everything a story card needs: the narrative, its photograph, and
    the real archival passages it rests on."""
    with db.connect(readonly=True) as conn:
        row = conn.execute("SELECT * FROM timeline_events WHERE id = ?", (event_id,)).fetchone()
        if row is None:
            raise HTTPException(404, f"No timeline event with id {event_id!r}.")

        sources = [
            {
                "uid": s["uid"], "chunkId": s["id"], "documentId": s["document_id"],
                "documentTitle": s["doc_title"], "volume": s["doc_volume"],
                "section": s["section"], "page": s["printed_page_start"],
                "pdfPage": s["page_start"], "note": s["note"],
                "excerpt": (s["text"] or "")[:400],
            }
            for s in conn.execute(
                """SELECT c.*, d.title AS doc_title, d.volume AS doc_volume, ts.note
                     FROM timeline_sources ts
                     JOIN chunks c    ON c.id = ts.chunk_id
                     JOIN documents d ON d.id = c.document_id
                    WHERE ts.event_id = ?""", (event_id,))
        ]
        entities = [
            {"id": e["id"], "kind": e["kind"], "name": e["name"]}
            for e in conn.execute(
                """SELECT DISTINCT e.* FROM entities e
                     JOIN entity_links el ON el.entity_id = e.id
                     JOIN timeline_sources ts ON ts.chunk_id = el.chunk_id
                    WHERE ts.event_id = ?""", (event_id,))
        ]
    return {"event": _event_public(row), "sources": sources, "entities": entities}


# ---------------------------------------------------------------------------
# entities (PS req 2)
# ---------------------------------------------------------------------------

@router.get("/entities", summary="Entities in the archive")
def entities(kind: str | None = Query(None), q: str | None = Query(None),
             limit: int = Query(200, ge=1, le=1000)) -> dict:
    sql = ("SELECT e.*, (SELECT COUNT(*) FROM entity_links el WHERE el.entity_id = e.id) links "
           "FROM entities e")
    where, params = [], []
    if kind:
        where.append("e.kind = ?"); params.append(kind)
    if q:
        where.append("LOWER(e.name) LIKE ?"); params.append(f"%{q.lower()}%")
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY links DESC, e.name LIMIT ?"
    params.append(limit)

    with db.connect(readonly=True) as conn:
        items = [{"id": r["id"], "kind": r["kind"], "name": r["name"],
                  "description": r["description"], "links": r["links"]}
                 for r in conn.execute(sql, params)]
        kinds = [{"kind": r[0], "count": r[1]} for r in conn.execute(
            "SELECT kind, COUNT(*) FROM entities GROUP BY kind ORDER BY 2 DESC")]
    return {"count": len(items), "kinds": kinds, "entities": items}


@router.get("/entities/{entity_id}", summary="One entity")
def entity(entity_id: int) -> dict:
    with db.connect(readonly=True) as conn:
        row = conn.execute("SELECT * FROM entities WHERE id = ?", (entity_id,)).fetchone()
        if row is None:
            raise HTTPException(404, f"No entity with id {entity_id}.")
        mentions = [
            {"uid": m["uid"], "chunkId": m["id"], "documentId": m["document_id"],
             "documentTitle": m["doc_title"], "section": m["section"],
             "page": m["printed_page_start"], "relation": m["relation"],
             "excerpt": (m["text"] or "")[:300]}
            for m in conn.execute(
                """SELECT c.*, d.title AS doc_title, el.relation
                     FROM entity_links el
                     JOIN chunks c    ON c.id = el.chunk_id
                     JOIN documents d ON d.id = c.document_id
                    WHERE el.entity_id = ?
                    ORDER BY el.weight DESC LIMIT 50""", (entity_id,))
        ]
    return {"entity": {"id": row["id"], "kind": row["kind"], "name": row["name"],
                       "description": row["description"]},
            "mentionCount": len(mentions), "mentions": mentions}


@router.get("/entities/{entity_id}/related", summary="Related entities")
def related(entity_id: int, limit: int = Query(20, ge=1, le=100)) -> dict:
    """Co-occurrence: two entities are related when they are linked to the
    same passage. The shared passages are returned as the REASON, so the
    UI can say why rather than asserting a bare connection."""
    with db.connect(readonly=True) as conn:
        row = conn.execute("SELECT * FROM entities WHERE id = ?", (entity_id,)).fetchone()
        if row is None:
            raise HTTPException(404, f"No entity with id {entity_id}.")
        items = [
            {"id": r["id"], "kind": r["kind"], "name": r["name"],
             "sharedPassages": r["shared"],
             "reason": f"appears with {row['name']} in {r['shared']} passage"
                       f"{'s' if r['shared'] != 1 else ''}"}
            for r in conn.execute(
                """SELECT e2.id, e2.kind, e2.name, COUNT(*) shared
                     FROM entity_links a
                     JOIN entity_links b ON b.chunk_id = a.chunk_id AND b.entity_id != a.entity_id
                     JOIN entities e2    ON e2.id = b.entity_id
                    WHERE a.entity_id = ?
                    GROUP BY e2.id ORDER BY shared DESC, e2.name LIMIT ?""",
                (entity_id, limit))
        ]
    return {"entity": {"id": row["id"], "kind": row["kind"], "name": row["name"]},
            "count": len(items), "related": items}


# ---------------------------------------------------------------------------
# media (PS req 8, and media citations for PS req G)
# ---------------------------------------------------------------------------

def _media_public(row: sqlite3.Row) -> dict:
    path = row["file_path"] or ""
    return {
        "id": row["id"], "title": row["title"], "type": row["media_type"],
        "description": row["description"], "source": row["source"],
        "provenance": row["provenance"], "licence": row["licence"],
        "durationMs": row["duration_ms"],
        "durationLabel": _hms(row["duration_ms"]),
        "byteSize": row["byte_size"],
        "checksum": (row["sha256"] or "")[:16],
        "filename": path.rsplit("/", 1)[-1],
        "servable": bool(row["servable"]),
        "unservableReason": row["unservable_reason"],
        "streamUrl": f"/api/media/{row['id']}/stream" if row["servable"] else None,
        "thumbnail": row["thumbnail_path"],
    }


def _hms(ms: int | None) -> str | None:
    if not ms:
        return None
    seconds = ms // 1000
    return f"{seconds // 3600:02d}:{(seconds // 60) % 60:02d}:{seconds % 60:02d}"


@router.get("/media", summary="Audio and video assets")
def media(media_type: str | None = Query(None, pattern="^(audio|video)$")) -> dict:
    sql = "SELECT * FROM media_assets"
    params: list = []
    if media_type:
        sql += " WHERE media_type = ?"
        params.append(media_type)
    sql += " ORDER BY id"
    with db.connect(readonly=True) as conn:
        items = []
        for row in conn.execute(sql, params):
            item = _media_public(row)
            item["segmentCount"] = conn.execute(
                "SELECT COUNT(*) FROM media_segments WHERE media_id = ?",
                (row["id"],)).fetchone()[0]
            items.append(item)
    return {"count": len(items), "media": items}


def _require_media(conn: sqlite3.Connection, media_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM media_assets WHERE id = ?", (media_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"No media asset with id {media_id!r}.")
    return row


@router.get("/media/{media_id}", summary="One media asset")
def media_item(media_id: str) -> dict:
    with db.connect(readonly=True) as conn:
        row = _require_media(conn, media_id)
        segments = conn.execute(
            "SELECT COUNT(*) FROM media_segments WHERE media_id = ?", (media_id,)).fetchone()[0]
    item = _media_public(row)
    item["segmentCount"] = segments
    return {"media": item}


@router.get("/media/{media_id}/segments", summary="Timestamped segments")
def media_segments(media_id: str, approved_only: bool = Query(False)) -> dict:
    """Each segment is a citable unit: media id plus start and end
    timestamps, the audio/video counterpart of volume plus page."""
    with db.connect(readonly=True) as conn:
        _require_media(conn, media_id)
        sql = "SELECT * FROM media_segments WHERE media_id = ?"
        params: list = [media_id]
        if approved_only:
            sql += " AND verification_status = 'approved'"
        sql += " ORDER BY seq, start_ms"
        segments = [
            {"id": s["id"], "seq": s["seq"], "startMs": s["start_ms"], "endMs": s["end_ms"],
             "start": _hms(s["start_ms"]), "end": _hms(s["end_ms"]),
             "text": s["text"], "speaker": s["speaker"], "origin": s["origin"],
             "confidence": s["confidence"], "verificationStatus": s["verification_status"],
             "citation": f"{media_id} at {_hms(s['start_ms'])}"}
            for s in conn.execute(sql, params)
        ]
    return {"mediaId": media_id, "count": len(segments), "segments": segments}


@router.get("/media/{media_id}/transcript", summary="Full transcript")
def media_transcript(media_id: str) -> dict:
    with db.connect(readonly=True) as conn:
        row = _require_media(conn, media_id)
        segments = conn.execute(
            "SELECT * FROM media_segments WHERE media_id = ? ORDER BY seq, start_ms",
            (media_id,)).fetchall()

    if not segments:
        # No transcript exists yet. Say so plainly rather than returning an
        # empty string that reads like a silent recording.
        return {
            "mediaId": media_id, "available": False, "segments": 0, "text": None,
            "reason": "No transcript has been produced for this asset yet. "
                      "Transcription requires an ASR engine, which is not installed "
                      "on this machine.",
        }
    return {
        "mediaId": media_id, "available": True, "segments": len(segments),
        "origin": segments[0]["origin"],
        "text": " ".join(s["text"] for s in segments),
    }


@router.get("/media/{media_id}/stream", summary="Stream a media file")
def media_stream(media_id: str, request: Request):
    """Range-aware streaming.

    Files are read in 256 KB blocks and never loaded whole, and an asset
    marked unservable is refused outright - the 950 MB master would
    saturate the demo Wi-Fi and stall every retrieval request beside it.
    """
    with db.connect(readonly=True) as conn:
        row = _require_media(conn, media_id)

    if not row["servable"]:
        raise HTTPException(
            409, row["unservable_reason"] or "This asset is not served over the network.")

    path = config.REPO_ROOT / row["file_path"]
    if not path.exists():
        raise HTTPException(404, "Media file is not present on this server.")

    size = path.stat().st_size
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    range_header = request.headers.get("range")

    if not range_header:
        return FileResponse(path, media_type=media_type,
                            headers={"Accept-Ranges": "bytes"})

    try:
        raw = range_header.split("=", 1)[1]
        start_s, _, end_s = raw.partition("-")
        start = int(start_s) if start_s else 0
        end = int(end_s) if end_s else size - 1
    except (ValueError, IndexError):
        raise HTTPException(416, "Malformed Range header.")

    start = max(0, start)
    end = min(end, size - 1)
    if start > end:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})

    def body():
        remaining = end - start + 1
        with path.open("rb") as handle:
            handle.seek(start)
            while remaining > 0:
                block = handle.read(min(STREAM_CHUNK, remaining))
                if not block:
                    break
                remaining -= len(block)
                yield block

    return StreamingResponse(
        body(), status_code=206, media_type=media_type,
        headers={
            "Content-Range": f"bytes {start}-{end}/{size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(end - start + 1),
        },
    )
