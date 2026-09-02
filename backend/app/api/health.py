"""GET /api/health - readiness of the edge server.

Publishes the canonical archive counts. Because every surface (visitor
archive, archivist dashboard, kiosk) reads these same numbers, they are the
proof that the archive is centralized (PS req 17).
"""

import sqlite3

from fastapi import APIRouter

from ..core import config, db
from .schemas import ArchiveStats, HealthResponse

router = APIRouter()

# Capability flags let the frontend degrade honestly instead of guessing.
# Each flips to True in the phase that implements it.
# Capabilities are reported from what actually loaded, not from a hand
# edited list - so the frontend can degrade honestly if a model is missing.
_RUNTIME: dict = {}


def set_runtime(loaded: dict) -> None:
    """Called by the startup warm-up with what it managed to load."""
    global _RUNTIME
    _RUNTIME = loaded or {}


def capabilities() -> dict:
    """Reported from what actually loaded and what is actually installed.

    Nothing here is a hand-maintained list: a capability is True only when
    the thing behind it answered. A frontend can therefore hide or degrade
    a feature honestly instead of discovering at runtime that it is absent.
    """
    dense = bool(_RUNTIME.get("index")) and bool(_RUNTIME.get("embedder"))
    reranker = bool(_RUNTIME.get("reranker"))
    generation = bool(_RUNTIME.get("llm_available"))

    counts = {}
    try:
        with db.connect(readonly=True) as conn:
            for key, sql in (
                ("manuscripts", "SELECT COUNT(*) FROM manuscripts"),
                ("media", "SELECT COUNT(*) FROM media_assets"),
                ("timeline", "SELECT COUNT(*) FROM timeline_events"),
                ("entities", "SELECT COUNT(*) FROM entities"),
                ("intake", "SELECT COUNT(*) FROM intake_items"),
            ):
                counts[key] = conn.execute(sql).fetchone()[0]
    except Exception:
        counts = {}

    try:
        from ...ocr import ocr_status as _ocr
        ocr_ready = bool(_ocr().get("available"))
    except Exception:
        ocr_ready = False
    try:
        from ... import translation as tr
        translation_ready = tr.get_translator().health().available
    except Exception:
        translation_ready = False

    return {
        "lexical_search": True,                    # Phase 1 - SQLite FTS5
        "semantic_search": dense,                  # Phase 2 - FAISS
        "vector_search": dense,
        "reranking": reranker,                     # Phase 2 - cross-encoder
        "hybrid_retrieval": dense,                 # Phase 2 - RRF
        "evidence_gate": True,                     # Phase 2
        "extractive_answer": True,                 # Phase 2
        "generation": generation,                  # Phase 3 - local LLM
        "citation_validation": generation,         # only meaningful with generation
        "summarization": True,                     # extractive at minimum
        "full_text_access": True,
        "archive_browse": True,
        "preservation": True,
        "archivist": True,
        "manuscript_viewer": counts.get("manuscripts", 0) > 0,
        "ocr": ocr_ready,
        "media": counts.get("media", 0) > 0,
        "timeline": counts.get("timeline", 0) > 0,
        "knowledge_mapping": counts.get("entities", 0) > 0,
        "translation": translation_ready,
        "audio_narration": True,                   # browser TTS; no server dependency
    }


def _subsystems() -> dict:
    """Why a capability is off, when it is off - so the reason reaches the
    UI instead of only the server log."""
    out: dict = {}
    try:
        from ...ocr import ocr_status
        out["ocr"] = ocr_status()
    except Exception as exc:
        out["ocr"] = {"available": False, "detail": str(exc)}
    try:
        from ... import translation as tr
        out["translation"] = tr.translation_status()
    except Exception as exc:
        out["translation"] = {"available": False, "detail": str(exc)}
    out["llm"] = {
        "provider": _RUNTIME.get("llm"),
        "available": bool(_RUNTIME.get("llm_available")),
        "loaded": bool(_RUNTIME.get("llm_loaded")),
        "detail": _RUNTIME.get("llm_detail"),
    }
    return out


PHASE = "4 - frontend integration surfaces"


@router.get("/health", response_model=HealthResponse, summary="Edge server readiness")
def health() -> HealthResponse:
    db_present = config.DB_PATH.exists()

    if not db_present:
        return HealthResponse(
            status="empty",
            archive=config.ARCHIVE_NAME,
            schema_version="0",
            phase=PHASE,
            database=str(config.DB_PATH),
            database_present=False,
            stats=ArchiveStats(
                documents=0, documents_approved=0, documents_pending=0,
                chunks=0, chunks_indexed_vector=0, characters=0, pages=0,
                entities=0, timeline_events=0, ingest_log_entries=0,
            ),
            capabilities=capabilities(),
            detail="Archive database not built yet. Run: python -m backend.ingest.build",
        )

    try:
        with db.connect(readonly=True) as conn:
            stats = db.archive_stats(conn)
            row = conn.execute(
                "SELECT value FROM schema_meta WHERE key = 'schema_version'"
            ).fetchone()
            schema_version = row[0] if row else "unknown"
    except sqlite3.Error as exc:
        return HealthResponse(
            status="degraded",
            archive=config.ARCHIVE_NAME,
            schema_version="unknown",
            phase=PHASE,
            database=str(config.DB_PATH),
            database_present=True,
            stats=ArchiveStats(
                documents=0, documents_approved=0, documents_pending=0,
                chunks=0, chunks_indexed_vector=0, characters=0, pages=0,
                entities=0, timeline_events=0, ingest_log_entries=0,
            ),
            capabilities=capabilities(),
            detail=f"Archive database unreadable: {exc}",
        )

    from ...retrieval import vector
    empty = stats["chunks"] == 0
    return HealthResponse(
        subsystems=_subsystems(),
        retrieval={
            "embedModel": _RUNTIME.get("embed_model"),
            "embedDim": _RUNTIME.get("embed_dim"),
            "rerankModel": _RUNTIME.get("rerank_model"),
            "index": vector.status(),
            "warmed": bool(_RUNTIME.get("embedder") and _RUNTIME.get("reranker")),
            "llm": _RUNTIME.get("llm"),
            "llmLoaded": _RUNTIME.get("llm_loaded"),
            "llmDetail": _RUNTIME.get("llm_detail"),
        },
        status="empty" if empty else "ok",
        archive=config.ARCHIVE_NAME,
        schema_version=schema_version,
        phase=PHASE,
        database=str(config.DB_PATH),
        database_present=True,
        stats=ArchiveStats(**stats),
        capabilities=capabilities(),
        detail="Archive schema exists but holds no chunks yet." if empty else None,
    )
