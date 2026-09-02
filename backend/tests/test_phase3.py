"""Phase 3 tests: provider interface, gate ordering, citation validation.

The load-bearing assertions here are about ORDERING and REFUSAL, not about
answer quality:

  * a gate refusal must not reach the model at all
  * a gate pass must reach it
  * an answer citing something it was not given must be discarded

Those are checked with fake providers so they run in milliseconds and do
not depend on Qwen being loaded. The tests that do use the real model are
marked and skip when it is unavailable.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.core import config, db
from backend.app.main import app
from backend.llm import ExtractiveProvider, QwenProvider, get_fallback, get_provider
from backend.llm.base import (
    GenerationResult,
    LLMProvider,
    ProviderHealth,
    build_prompt,
    parse_citations,
    strip_reasoning,
)
from backend.retrieval import citations as cit
from backend.retrieval import pipeline

needs_archive = pytest.mark.skipif(
    not (config.DB_PATH.exists() and config.FAISS_PATH.exists()),
    reason="archive or vector index not built",
)


def _qwen_up() -> bool:
    try:
        return QwenProvider().health().available
    except Exception:
        return False


needs_qwen = pytest.mark.skipif(not _qwen_up(), reason="local Qwen not available")


# ---------------------------------------------------------------------------
# fakes
# ---------------------------------------------------------------------------

class SpyProvider(LLMProvider):
    """Records whether it was called, and returns whatever it was told to."""

    def __init__(self, result: GenerationResult | None = None, boom: bool = False):
        self.calls = 0
        self.result = result
        self.boom = boom

    def name(self) -> str:
        return "spy"

    def health(self) -> ProviderHealth:
        return ProviderHealth(True, "fake", "spy", True)

    def generate(self, question, evidence):
        self.calls += 1
        if self.boom:
            return GenerationResult(False, error="simulated provider failure", model="spy")
        return self.result or GenerationResult(
            True, text="A grounded sentence. [E1]", cited=[1], model="spy")


def _ev(**kw):
    base = dict(uid="ws-vol-01:p0048:c0066", documentId="ws-vol-01", page=33,
                pdfPage=48, charStart=10, charEnd=99, verificationStatus="approved",
                quote="Caste is not merely a division of labour; it is a division of labourers.",
                citation="Writings and Speeches, Vol. I, Annihilation of Caste, p. 33")
    base.update(kw)
    return base


# ---------------------------------------------------------------------------
# provider interface
# ---------------------------------------------------------------------------

def test_providers_implement_the_interface():
    for provider in (QwenProvider(), ExtractiveProvider()):
        assert isinstance(provider, LLMProvider)
        assert isinstance(provider.name(), str) and provider.name()
        assert isinstance(provider.health(), ProviderHealth)


def test_provider_registry_is_a_singleton():
    assert get_provider() is get_provider()
    assert get_fallback() is get_fallback()


def test_extractive_provider_is_always_available():
    h = ExtractiveProvider().health()
    assert h.available and h.loaded


def test_extractive_provider_quotes_verbatim_and_cites():
    ev = [_ev()]
    out = ExtractiveProvider().generate("What did Ambedkar say about caste and labour?", ev)
    assert out.ok and out.cited == [1]
    body = out.text.replace("[E1]", "").strip()
    assert body in ev[0]["quote"]


def test_provider_reports_failure_rather_than_raising():
    """A visitor must always get something back, so operational problems
    are returned, not thrown."""
    dead = QwenProvider(model="does-not-exist:0b", host="http://127.0.0.1:1")
    assert dead.health().available is False
    out = dead.generate("anything", [_ev()])
    assert out.ok is False and out.error


# ---------------------------------------------------------------------------
# prompt construction
# ---------------------------------------------------------------------------

def test_prompt_numbers_evidence_and_fences_it():
    p = build_prompt("Q?", [_ev(), _ev(uid="x", documentId="ws-vol-02")])
    assert "[E1]" in p and "[E2]" in p
    assert "INSUFFICIENT_EVIDENCE" in p          # the refusal instruction
    assert p.rstrip().endswith("Answer:")


def test_prompt_truncates_a_long_passage():
    p = build_prompt("Q?", [_ev(quote="x" * 5000)], max_chars=200)
    assert len(p) < 2000


def test_reasoning_blocks_are_stripped():
    assert strip_reasoning("<think>hmm</think>Real answer.") == "Real answer."
    assert strip_reasoning("Answer. <think>unclosed") == "Answer."


def test_citation_markers_parse_in_order_without_duplicates():
    assert parse_citations("a [E2] b [E1] c [E2]") == [2, 1]
    assert parse_citations("no citations here") == []


# ---------------------------------------------------------------------------
# citation validation
# ---------------------------------------------------------------------------

def test_valid_citation_accepted():
    r = cit.validate([1], [_ev()])
    assert r.valid and r.resolved


def test_uncited_answer_is_rejected():
    """An uncited sentence cannot be traced, so it is treated as ungrounded."""
    r = cit.validate([], [_ev()])
    assert not r.valid and "no citation" in r.reason


def test_out_of_range_citation_rejected():
    r = cit.validate([3], [_ev()])
    assert not r.valid and 3 in r.invalid and "out of range" in r.reason


def test_citation_without_page_anchor_rejected():
    r = cit.validate([1], [_ev(page=None, pdfPage=None, mediaStartMs=None)])
    assert not r.valid and "page anchor" in r.reason


def test_citation_without_document_id_rejected():
    r = cit.validate([1], [_ev(documentId="")])
    assert not r.valid and "document id" in r.reason


def test_citation_without_offsets_rejected():
    r = cit.validate([1], [_ev(charStart=None)])
    assert not r.valid and "offsets" in r.reason


def test_unapproved_evidence_rejected():
    r = cit.validate([1], [_ev(verificationStatus="pending")])
    assert not r.valid and "not approved" in r.reason


def test_attach_returns_only_the_cited_passages():
    a, b = _ev(uid="A"), _ev(uid="B")
    r = cit.validate([2], [a, b])
    assert r.valid
    assert [e["uid"] for e in cit.attach([a, b], r)] == ["B"]


# ---------------------------------------------------------------------------
# gate ordering - the load-bearing behaviour
# ---------------------------------------------------------------------------

@needs_archive
def test_gate_failure_means_the_model_is_never_called():
    spy = SpyProvider()
    with db.connect(readonly=True) as conn:
        r = pipeline.answer(conn, "What is the best recipe for Neapolitan pizza dough?",
                            provider=spy)
    assert spy.calls == 0, "the model was contacted for a question the gate refused"
    assert not r.grounded and r.fallback
    assert r.evidence == []
    assert "No confident source" in r.answer


@needs_archive
def test_gate_pass_calls_the_model():
    spy = SpyProvider()
    with db.connect(readonly=True) as conn:
        r = pipeline.answer(conn, "What did Ambedkar say about caste and division of labour?",
                            provider=spy)
    assert spy.calls == 1
    assert r.grounded and not r.fallback
    assert r.answer.startswith("A grounded sentence")


@needs_archive
def test_provider_failure_degrades_to_extractive():
    spy = SpyProvider(boom=True)
    with db.connect(readonly=True) as conn:
        r = pipeline.answer(conn, "What did Ambedkar say about caste and division of labour?",
                            provider=spy)
    assert spy.calls == 1
    assert not r.grounded and r.fallback
    assert r.degraded and "provider failed" in r.degraded
    assert r.answer and "No confident source" not in r.answer
    assert r.evidence, "the extractive fallback must still show its sources"


@needs_archive
def test_invalid_citation_discards_the_generated_answer():
    """The model cites [E9] when it was given far fewer passages."""
    spy = SpyProvider(GenerationResult(True, text="Confident but wrong. [E9]",
                                       cited=[9], model="spy"))
    with db.connect(readonly=True) as conn:
        r = pipeline.answer(conn, "What did Ambedkar say about caste and division of labour?",
                            provider=spy)
    assert not r.grounded and r.fallback
    assert "citations rejected" in (r.degraded or "")
    assert "Confident but wrong" not in r.answer


@needs_archive
def test_uncited_generation_is_discarded():
    spy = SpyProvider(GenerationResult(True, text="Plausible prose with no marker.",
                                       cited=[], model="spy"))
    with db.connect(readonly=True) as conn:
        r = pipeline.answer(conn, "What did Ambedkar say about caste and division of labour?",
                            provider=spy)
    assert not r.grounded
    assert "Plausible prose" not in r.answer


@needs_archive
def test_model_reporting_insufficient_evidence_refuses():
    spy = SpyProvider(GenerationResult(True, text="", insufficient=True, model="spy"))
    with db.connect(readonly=True) as conn:
        r = pipeline.answer(conn, "What did Ambedkar say about caste and division of labour?",
                            provider=spy)
    assert not r.grounded and r.evidence == []
    assert "No confident source" in r.answer


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

@needs_archive
def test_ask_response_shape_and_no_leaked_internals():
    with TestClient(app) as client:
        body = client.post("/api/ask", json={"question": "caste and labour"}).json()
    for key in ("answer", "grounded", "fallback", "provider", "evidence",
                "gate", "citations", "timings", "generation", "counts"):
        assert key in body, f"missing {key}"
    blob = repr(body)
    # The provider name may say "ollama"; a host, port or path must not appear.
    assert "127.0.0.1" not in blob and "11434" not in blob
    assert "C:\\" not in blob and "/Users/" not in blob


# ---------------------------------------------------------------------------
# the real model
# ---------------------------------------------------------------------------

@needs_qwen
def test_local_qwen_is_detected_not_installed():
    p = QwenProvider()
    h = p.health()
    assert h.available
    assert h.model in p.installed_models(), "provider must use an already-installed model"


@needs_qwen
def test_qwen_declares_insufficient_evidence_when_it_cannot_answer():
    """The grounding rules must hold even with irrelevant evidence."""
    out = QwenProvider().generate(
        "What is the capital of Brazil?",
        [_ev(quote="Caste is not merely a division of labour; it is a division of labourers.")],
    )
    assert out.ok
    assert out.insufficient or "brasilia" not in out.text.lower()
