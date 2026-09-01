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
    from ...retrieval import vector

    dense = bool(_RUNTIME.get("index")) and bool(_RUNTIME.get("embedder"))
    reranker = bool(_RUNTIME.get("reranker"))
    return {
        "lexical_search": True,          # Phase 1 - SQLite FTS5
        "vector_search": dense,          # Phase 2 - FAISS
        "reranking": reranker,           # Phase 2 - cross-encoder
        "hybrid_retrieval": dense,       # Phase 2 - RRF over both halves
        "evidence_gate": True,           # Phase 2
        "extractive_answer": True,       # Phase 2
        "generation": False,             # Phase 3 - LLM provider
        "citation_validation": False,    # Phase 3
        "translation": False,            # Phase 4 - Bhashini
        "ocr": False,                    # Phase 4
    }


PHASE = "2 - hybrid retrieval (FAISS + FTS5, RRF, rerank, evidence gate)"


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
        retrieval={
            "embedModel": _RUNTIME.get("embed_model"),
            "embedDim": _RUNTIME.get("embed_dim"),
            "rerankModel": _RUNTIME.get("rerank_model"),
            "index": vector.status(),
            "warmed": bool(_RUNTIME.get("embedder") and _RUNTIME.get("reranker")),
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
