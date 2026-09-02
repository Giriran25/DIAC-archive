"""Retrieval endpoints.

    GET  /api/search   diagnostics - every stage exposed, gate bypassable
    POST /api/ask      the visitor path - gated, extractive answer + citations

Phase 2 has no LLM. `/api/ask` returns an extractive answer: sentences
lifted verbatim from the retrieved passages. Phase 3 adds grounded
generation behind the same contract and keeps this as its fallback.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..core import config, db
from ...retrieval import pipeline
from .schemas import Evidence

router = APIRouter()


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=config.MAX_QUESTION_CHARS)
    lang: str = "en"


class AskResponse(BaseModel):
    question: str
    answer: str
    grounded: bool          # produced by a model AND its citations validated
    fallback: bool          # extractive text was used instead of generation
    provider: str           # short name only - never a path or a secret
    evidence: list[dict]
    gate: dict
    citations: dict
    timings: dict
    generation: dict
    counts: dict
    degraded: str | None = None


class SearchResponse(AskResponse):
    candidates: list[dict]


def _run(question: str, *, apply_gate: bool, include_candidates: bool,
         evidence_k: int | None = None, generate: bool = False):
    q = (question or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Ask a question first.")
    if len(q) > config.MAX_QUESTION_CHARS:
        raise HTTPException(status_code=413, detail="Question is too long.")

    if not config.DB_PATH.exists():
        raise HTTPException(
            status_code=503,
            detail="Archive not built. Run: python -m backend.ingest.build",
        )

    # Read-only handle: a visitor request physically cannot write to the
    # archive, enforced by the driver rather than by convention.
    with db.connect(readonly=True) as conn:
        if generate:
            return pipeline.answer(conn, q, evidence_k=evidence_k)
        return pipeline.search(
            conn, q,
            evidence_k=evidence_k,
            apply_gate=apply_gate,
            include_candidates=include_candidates,
        )


@router.get("/search", response_model=SearchResponse, summary="Retrieval diagnostics")
def search(
    q: str = Query(..., description="The question"),
    gate: bool = Query(True, description="Apply the evidence gate"),
    k: int | None = Query(None, ge=1, le=20, description="Evidence to return"),
) -> SearchResponse:
    """Exposes every stage: dense and lexical hit counts, the fused
    candidate list with per-retriever ranks, the reranked evidence, the
    gate decision with its thresholds, and per-stage timings."""
    result = _run(q, apply_gate=gate, include_candidates=True, evidence_k=k)
    return SearchResponse(**_payload(result), candidates=result.candidates)


def _payload(result) -> dict:
    """Shared response shape. Deliberately exposes the provider NAME only -
    never a model path, host or filesystem detail."""
    return {
        "question": result.question,
        "answer": result.answer,
        "grounded": result.grounded,
        "fallback": result.fallback,
        "provider": result.provider,
        "evidence": result.evidence,
        "gate": result.decision.as_dict() if result.decision else {},
        "citations": result.citations,
        "timings": result.timings.as_dict(),
        "generation": result.generation,
        "counts": result.counts,
        "degraded": result.degraded,
    }


@router.post("/ask", response_model=AskResponse, summary="Ask the archive")
def ask(body: AskRequest) -> AskResponse:
    """Retrieve, gate, and only then generate.

    A gate refusal returns before any model is contacted. A generated
    answer whose citations do not validate is discarded in favour of the
    extractive one. Either way the caller gets an answer it can trace.
    """
    result = _run(body.question, apply_gate=True, include_candidates=False, generate=True)
    return AskResponse(**_payload(result))
