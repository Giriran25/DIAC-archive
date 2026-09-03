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

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from ... import translation as tr
from ...llm import get_fallback, get_provider
from ...retrieval import citations as cit
from ...retrieval import gate, pipeline
from ...retrieval.evidence import to_evidence
from ...retrieval.prose import reads_as_prose
from ..core import config, db

router = APIRouter()

#: Evidence markers are internal notation, not something a reader needs.
_MARKER = re.compile(r"\s*\[\s*E\s*\d{1,2}\s*\]", re.IGNORECASE)

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


# ---------------------------------------------------------------------------
# Document summaries
# ---------------------------------------------------------------------------
#
# Summarising a whole volume is not the same task as answering a question,
# and running it through the question path was wrong in two ways.
#
# It refused: the relevance gate asks "does the archive hold anything
# relevant to this query", and a query built from a volume title plus its
# section names scores low against every passage, so five of the seven
# documents in the archive could not be summarised at all.
#
# And it was unscoped: retrieval ran over the whole corpus, so a summary of
# Volume 1 could be assembled from passages in Volume 3. For a summary the
# subject is already chosen; relevance is guaranteed by scoping to the
# document, which is a stronger guarantee than the gate was providing.

_SUMMARY_SELECT = """
    SELECT c.*,
           d.title AS doc_title, d.volume AS doc_volume, d.doc_type AS doc_type,
           d.date_text AS doc_date, d.author AS doc_author, d.source AS doc_source,
           d.file_path AS doc_path, d.extraction_method AS extraction_method
      FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE c.document_id = ?
       AND c.chunk_kind = 'body'
       AND c.char_count >= 400
       AND c.printed_page_start IS NOT NULL
     ORDER BY c.seq
"""

def _document_passages(conn, document_id: str, limit: int) -> list[dict]:
    """Representative body passages, spread across the whole document.

    Taking the first N would summarise the front matter of a 500-page
    volume. Sampling evenly across the sequence means the summary reflects
    the work rather than its opening pages. Table-of-contents and listing
    chunks are excluded here but remain readable in the archive - they are
    navigation, not substance.

    Every passage kept carries a printed page number, so each line of the
    summary can be followed back to a page a reader can turn to.
    """
    rows = [r for r in conn.execute(_SUMMARY_SELECT, (document_id,))
            if reads_as_prose(r["text"])]
    if not rows:
        return []
    if len(rows) <= limit:
        picked = rows
    else:
        step = len(rows) / float(limit)
        picked = [rows[int(i * step)] for i in range(limit)]
    return [to_evidence(r) for r in picked]


@router.post("/summarize", summary="Grounded summary")
def summarize(body: SummarizeRequest) -> dict:
    """Summarise a document, a passage, or supplied text.

    A document summary is scoped to that document and needs no relevance
    gate; a passage or free-text summary still goes through the normal
    retrieval path and is gated like any other question.
    """
    scoped_evidence: list[dict] | None = None
    decision = None

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
            title = doc["title"]
            query = title
            scoped_evidence = _document_passages(conn, body.document_id, body.max_evidence)

        if scoped_evidence is None:
            result = pipeline.search(conn, query, evidence_k=body.max_evidence, apply_gate=True)
            decision = result.decision
            evidence = result.evidence
            retrieval_ms = round(result.timings.total_ms, 1)
            if decision is None or not decision.passed:
                return {
                    "ok": False, "grounded": False, "subject": title,
                    "summary": gate.REFUSAL, "bullets": [], "evidence": [],
                    "gate": decision.as_dict() if decision else {},
                    "provider": "none",
                }
        else:
            evidence = scoped_evidence
            retrieval_ms = 0.0
            if not evidence:
                # The document holds no substantial body text - say so
                # plainly rather than returning an empty summary.
                return {
                    "ok": False, "grounded": False, "subject": title,
                    "summary": "This document has no transcribed body text to summarise.",
                    "bullets": [], "evidence": [],
                    "gate": {}, "provider": "none",
                }

    provider = get_provider()
    supplied = evidence[:provider.evidence_max()]
    generation = provider.generate(f"{SUMMARY_INSTRUCTION}\n\nSubject: {title}", evidence)

    gate_dict = decision.as_dict() if decision is not None else {}

    degraded = None
    if generation.ok and not generation.insufficient and provider.is_generative():
        report = cit.validate(generation.cited, supplied)
        if report.valid:
            bullets = [b.strip(" -" + chr(8226) + chr(9)) for b in generation.text.splitlines() if b.strip()]
            return {
                "ok": True, "grounded": True, "subject": title,
                "summary": generation.text,
                "bullets": [b for b in bullets if b],
                "evidence": cit.attach(supplied, report),
                "citations": report.as_dict(),
                "gate": gate_dict,
                "provider": provider.name(),
                "timings": {"retrieval_ms": retrieval_ms},
            }
        degraded = f"citations rejected: {report.reason}"
    elif generation.insufficient:
        degraded = "model reported insufficient evidence"
    elif not provider.is_generative():
        degraded = "no language model is configured; summarised from the archive text itself"
    else:
        degraded = f"provider failed: {generation.error}"

    # Extractive summary: one verbatim bullet per passage, each traceable to
    # the page it came from. Nothing here is composed, so it is never
    # reported as model-generated.
    bullets, used = [], []
    fb = get_fallback()
    for ev in evidence:
        out = fb.generate(query, [ev])
        if out.ok and out.text.strip():
            # One bullet per passage, so the [E1] marker carries no
            # information the evidence list does not already show.
            bullets.append(_MARKER.sub("", out.text).strip())
            used.append(ev)

    if not bullets:
        return {
            "ok": False, "grounded": False, "subject": title,
            "summary": "No passage in this document could be quoted as a summary.",
            "bullets": [], "evidence": [], "gate": gate_dict,
            "provider": "extractive", "degraded": degraded,
        }

    return {
        "ok": True, "grounded": False, "subject": title,
        "summary": " ".join(bullets),
        "bullets": bullets,
        "evidence": used,
        "gate": gate_dict,
        "provider": "extractive",
        "degraded": degraded,
        "timings": {"retrieval_ms": retrieval_ms},
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
