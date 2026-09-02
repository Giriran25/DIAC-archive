"""Summarisation and translation.

    POST /api/summarize   grounded summary of a document, section or text
    POST /api/translate   presentation-layer translation

Summarisation deliberately reuses the RAG pipeline rather than adding a
second one: the same retrieval, the same evidence gate, the same provider,
the same citation validation. A summary is an answer to "what is this
about", so it earns the same guarantees - and there is no second thing to
keep correct.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from ... import translation as tr
from ...llm import get_fallback, get_provider
from ...retrieval import citations as cit
from ...retrieval import gate, pipeline
from ..core import config, db

router = APIRouter()

SUMMARY_INSTRUCTION = (
    "Summarise the evidence below in 3 to 5 short bullet points. "
    "Begin each bullet with '- '. Cite every bullet with its evidence "
    "marker, like [E1]."
)


class SummarizeRequest(BaseModel):
    document_id: str | None = None
    chunk_id: str | None = None
    text: str | None = Field(default=None, max_length=8000)
    target_language: str = Field(default="en", max_length=5)
    max_evidence: int = Field(default=4, ge=1, le=8)

    @model_validator(mode="after")
    def _one_of(self):
        if not (self.document_id or self.chunk_id or self.text):
            raise ValueError("Provide document_id, chunk_id or text.")
        return self


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    source_language: str = Field(default="en", max_length=5)
    target_language: str = Field(max_length=5)


@router.post("/summarize", summary="Grounded summary")
def summarize(body: SummarizeRequest) -> dict:
    """Builds a query from the requested subject, runs the normal pipeline,
    and asks the provider for bullets instead of prose."""
    with db.connect(readonly=True) as conn:
        if body.text:
            subject = body.text.strip()
            query = subject[:400]
            title = "selected text"
        elif body.chunk_id:
            row = conn.execute(
                "SELECT c.*, d.title AS doc_title FROM chunks c "
                "JOIN documents d ON d.id = c.document_id WHERE c.uid = ? OR c.id = ?",
                (body.chunk_id, body.chunk_id if body.chunk_id.isdigit() else -1)).fetchone()
            if row is None:
                raise HTTPException(404, f"No source with id {body.chunk_id!r}.")
            query = (row["section"] or row["doc_title"] or "")[:200] + " " + row["text"][:300]
            title = row["section"] or row["doc_title"]
        else:
            doc = conn.execute("SELECT * FROM documents WHERE id = ?",
                               (body.document_id,)).fetchone()
            if doc is None:
                raise HTTPException(404, f"No document with id {body.document_id!r}.")
            sections = [r[0] for r in conn.execute(
                """SELECT section FROM chunks WHERE document_id = ? AND chunk_kind='body'
                       AND section IS NOT NULL GROUP BY section
                     ORDER BY COUNT(*) DESC LIMIT 6""", (body.document_id,))]
            query = f"{doc['title']} {' '.join(sections)}"[:400]
            title = doc["title"]

        result = pipeline.search(conn, query, evidence_k=body.max_evidence, apply_gate=True)

    if result.decision is None or not result.decision.passed:
        return {
            "ok": False, "grounded": False, "subject": title,
            "summary": gate.REFUSAL, "bullets": [], "evidence": [],
            "gate": result.decision.as_dict() if result.decision else {},
            "provider": "none",
        }

    provider = get_provider()
    generation = provider.generate(f"{SUMMARY_INSTRUCTION}\n\nSubject: {title}", result.evidence)

    supplied_max = 3
    try:
        from ...llm.qwen import EVIDENCE_MAX
        supplied_max = EVIDENCE_MAX
    except Exception:
        pass
    supplied = result.evidence[:supplied_max]

    degraded = None
    if generation.ok and not generation.insufficient:
        report = cit.validate(generation.cited, supplied)
        if report.valid:
            bullets = [b.strip(" -•\t") for b in generation.text.splitlines() if b.strip()]
            return {
                "ok": True, "grounded": True, "subject": title,
                "summary": generation.text,
                "bullets": [b for b in bullets if b],
                "evidence": cit.attach(supplied, report),
                "citations": report.as_dict(),
                "gate": result.decision.as_dict(),
                "provider": provider.name(),
                "timings": {"retrieval_ms": round(result.timings.total_ms, 1)},
            }
        degraded = f"citations rejected: {report.reason}"
    elif generation.insufficient:
        degraded = "model reported insufficient evidence"
    else:
        degraded = f"provider failed: {generation.error}"

    # Extractive fallback: verbatim sentences, one bullet per passage.
    fallback = get_fallback().generate(query, supplied)
    return {
        "ok": True, "grounded": False, "subject": title,
        "summary": fallback.text if fallback.ok else gate.REFUSAL,
        "bullets": [fallback.text] if fallback.ok else [],
        "evidence": supplied,
        "gate": result.decision.as_dict(),
        "provider": "extractive",
        "degraded": degraded,
    }


@router.post("/translate", summary="Translate text for display")
def translate(body: TranslateRequest) -> dict:
    """Presentation-layer only.

    Nothing translated here is written to the archive, and this endpoint
    never touches a source quote, citation string or page number.
    """
    if body.target_language not in tr.LANGUAGES:
        raise HTTPException(
            422, f"Unsupported target language {body.target_language!r}. "
                 f"Supported: {', '.join(tr.LANGUAGES)}.")

    result = tr.translate(body.text, source=body.source_language,
                          target=body.target_language)
    return {
        "ok": result.ok,
        "text": result.text,
        "translated": result.translated,
        "sourceLanguage": result.source_language,
        "targetLanguage": result.target_language,
        "provider": result.provider,
        "mode": result.mode,
        "error": result.error,
        # What the UI should show beside a translated answer.
        "notice": None if result.translated else
                  "Translation unavailable - showing the original English.",
    }


@router.get("/languages", summary="Supported display languages")
def languages() -> dict:
    return {"languages": [{"code": c, "name": n} for c, n in tr.LANGUAGES.items()],
            "canonicalRetrievalLanguage": "en",
            "translation": tr.translation_status()}
