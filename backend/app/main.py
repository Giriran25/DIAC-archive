"""DAIC ARCHIVE - edge server.

Runs on the laptop. The tablet is a thin client: all archive data,
retrieval, embeddings, generation and ingestion live here, and no secret
is ever sent to the browser.

Run:
    backend/.venv/Scripts/python.exe -m backend.run
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import health, search
from .core import config

log = logging.getLogger("daic")

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Load the embedding model, the reranker and the FAISS index once, at
    startup. A cold transformer load costs tens of seconds; paying it on
    the first visitor question would look like a hang on the kiosk."""
    from ..retrieval import pipeline
    try:
        loaded = pipeline.warm()
        log.info("warmed: %s", loaded)
        health.set_runtime(loaded)
    except Exception as exc:      # the archive must still serve without them
        log.warning("warm-up failed, retrieval will be degraded: %s", exc)
        health.set_runtime({"error": str(exc)})
    yield


app = FastAPI(
    lifespan=lifespan,
    title="DAIC ARCHIVE - Edge Server",
    description=(
        "Dr. Ambedkar International Centre Digital Heritage Archive. "
        "SIH 2026 PS 26096. Round 2 edge server."
    ),
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

# CORS is scoped to the private LAN only: localhost plus the RFC1918 ranges
# on the dev/preview ports. A venue network should not be able to call this
# from an arbitrary origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_origin_regex=config.CORS_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    """Reject oversized bodies before they are parsed."""
    length = request.headers.get("content-length")
    if length is not None:
        try:
            if int(length) > config.MAX_REQUEST_BYTES:
                return JSONResponse(
                    status_code=413,
                    content={"error": "Request body too large."},
                )
        except ValueError:
            return JSONResponse(status_code=400, content={"error": "Invalid Content-Length."})
    return await call_next(request)


app.include_router(health.router, prefix="/api", tags=["system"])
app.include_router(search.router, prefix="/api", tags=["retrieval"])


@app.get("/api", tags=["system"])
def root() -> dict:
    return {
        "archive": config.ARCHIVE_NAME,
        "service": "edge-server",
        "phase": health.PHASE,
        "endpoints": ["/api/health", "/api/search", "/api/ask", "/api/docs"],
    }
