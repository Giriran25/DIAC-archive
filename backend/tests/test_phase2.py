"""Phase 2 tests: fusion, vector index, evidence gate, pipeline, API.

Split by cost. The fusion and gate tests are pure functions and run in
milliseconds; the ones that need the embedding model, the reranker or the
built index are marked and skip cleanly on a fresh clone.
"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app.core import config, db
from backend.app.main import app
from backend.retrieval import fusion, gate, vector
from backend.retrieval.embedder import prefixes_for
from backend.retrieval.fusion import reciprocal_rank_fusion

needs_index = pytest.mark.skipif(
    not config.FAISS_PATH.exists(), reason="vector index not built"
)
needs_archive = pytest.mark.skipif(
    not config.DB_PATH.exists(), reason="archive not built"
)


class Hit:
    """Minimal stand-in for DenseHit / LexicalHit."""
    def __init__(self, chunk_id, rank, score=1.0):
        self.chunk_id, self.rank, self.score = chunk_id, rank, score


# ---------------------------------------------------------------------------
# embedding prefixes - silent quality killers if wrong
# ---------------------------------------------------------------------------

def test_bge_gets_query_instruction_and_bare_passages():
    p = prefixes_for("BAAI/bge-small-en-v1.5")
    assert p.query.startswith("Represent this sentence")
    assert p.passage == ""


def test_e5_labels_both_sides():
    p = prefixes_for("intfloat/multilingual-e5-small")
    assert p.query == "query: "
    assert p.passage == "passage: "


def test_unknown_model_gets_no_prefix():
    p = prefixes_for("some/other-model")
    assert p.query == "" and p.passage == ""


# ---------------------------------------------------------------------------
# reciprocal rank fusion
# ---------------------------------------------------------------------------

def test_rrf_rewards_agreement_between_retrievers():
    """A chunk both retrievers found should beat one that only ranked
    first in a single retriever - that agreement signal is the whole
    reason for running two retrievers."""
    dense = [Hit(1, 1), Hit(2, 2)]
    lexical = [Hit(2, 1), Hit(3, 2)]
    fused = reciprocal_rank_fusion(dense, lexical, k=60)
    assert fused[0].chunk_id == 2
    assert fused[0].found_by_both


def test_rrf_score_matches_the_formula():
    fused = reciprocal_rank_fusion([Hit(7, 1)], [Hit(7, 3)], k=60)
    assert fused[0].chunk_id == 7
    assert fused[0].score == pytest.approx(1 / 61 + 1 / 63)


def test_rrf_keeps_single_retriever_hits():
    fused = reciprocal_rank_fusion([Hit(1, 1)], [], k=60)
    assert [f.chunk_id for f in fused] == [1]
    assert fused[0].dense_rank == 1 and fused[0].lexical_rank is None


def test_rrf_is_deterministic_on_ties():
    a = reciprocal_rank_fusion([Hit(5, 1), Hit(9, 1)], [], k=60)
    b = reciprocal_rank_fusion([Hit(9, 1), Hit(5, 1)], [], k=60)
    assert [h.chunk_id for h in a] == [h.chunk_id for h in b]


def test_rrf_respects_limit_and_assigns_ranks():
    dense = [Hit(i, i) for i in range(1, 11)]
    fused = reciprocal_rank_fusion(dense, [], limit=3)
    assert len(fused) == 3
    assert [f.rank for f in fused] == [1, 2, 3]


def test_rrf_empty_inputs():
    assert reciprocal_rank_fusion([], []) == []


# ---------------------------------------------------------------------------
# vector index
# ---------------------------------------------------------------------------

def test_flat_index_returns_exact_nearest_neighbour():
    vecs = np.eye(4, dtype=np.float32)          # already unit length
    idx = vector.build(vecs, [10, 20, 30, 40], dim=4)
    hits = idx.search(np.array([0, 1, 0, 0], dtype=np.float32), k=2)
    assert hits[0].chunk_id == 20
    assert hits[0].score == pytest.approx(1.0, abs=1e-5)
    assert hits[0].rank == 1


def test_index_ids_are_chunk_ids():
    vecs = np.eye(3, dtype=np.float32)
    idx = vector.build(vecs, [101, 202, 303], dim=3)
    got = {h.chunk_id for h in idx.search(np.array([1, 0, 0], dtype=np.float32), k=3)}
    assert got == {101, 202, 303}


def test_index_handles_k_larger_than_corpus():
    vecs = np.eye(2, dtype=np.float32)
    idx = vector.build(vecs, [1, 2], dim=2)
    assert len(idx.search(np.array([1, 0], dtype=np.float32), k=50)) == 2


@needs_index
def test_persisted_index_matches_configured_model():
    """Searching an index built by a different embedding model returns
    confident nonsense - the worst possible failure mode here."""
    status = vector.status()
    assert status["present"]
    assert status["matches_configured_model"], (
        f"index built with {status['model']}, config says {config.EMBED_MODEL}"
    )


@needs_index
@needs_archive
def test_every_vector_has_a_chunk_row():
    idx = vector.load()
    with db.connect(readonly=True) as conn:
        n = conn.execute(
            "SELECT COUNT(*) FROM chunks WHERE chunk_kind='body' AND faiss_id IS NOT NULL"
        ).fetchone()[0]
    assert idx.size == n


# ---------------------------------------------------------------------------
# evidence gate
# ---------------------------------------------------------------------------

class Row(dict):
    """sqlite3.Row stand-in - supports row['key']."""


def _row(**kw):
    base = dict(text="", verification_status="approved", document_id="d1",
                page_start=1, char_start=0, char_end=10)
    base.update(kw)
    return Row(base)


def test_gate_refuses_when_nothing_retrieved():
    d = gate.refuse_empty()
    assert not d.passed
    assert "No confident source" in d.message


def test_coverage_counts_question_terms_present_in_evidence():
    rows = [_row(text="Caste is a division of labourers, not of labour.")]
    assert gate.coverage_of("What is caste and labour?", rows) > 0.5
    assert gate.coverage_of("nuclear submarine propulsion reactor", rows) == 0.0


def test_coverage_ignores_stopwords():
    rows = [_row(text="the of and to in a is was")]
    # Only stopwords in the question -> no content terms -> zero coverage
    assert gate.coverage_of("what is the of and to", rows) == 0.0


def test_provenance_rejects_unapproved_chunk():
    ok, why = gate.provenance_valid(_row(verification_status="pending"))
    assert not ok and "not approved" in why


def test_provenance_rejects_missing_page_anchor():
    ok, why = gate.provenance_valid(_row(page_start=None))
    assert not ok and "page" in why


def test_provenance_rejects_missing_offsets():
    ok, why = gate.provenance_valid(_row(char_start=None))
    assert not ok and "offset" in why


def test_provenance_accepts_a_citable_chunk():
    ok, why = gate.provenance_valid(_row())
    assert ok and why == "ok"


def test_gate_blocks_on_provenance_even_when_relevance_is_high():
    """A passage that cannot be cited is not evidence, however relevant."""
    hit = Hit(1, 1, score=10.0)
    rows = {1: _row(text="highly relevant caste labour text", verification_status="pending")}
    d = gate.evaluate("caste labour", [hit], rows)
    assert not d.passed
    assert "provenance" in d.reason


def test_gate_blocks_on_low_relevance():
    hit = Hit(1, 1, score=-99.0)
    rows = {1: _row(text="caste labour")}
    d = gate.evaluate("caste labour", [hit], rows)
    assert not d.passed and "relevance" in d.reason


def test_gate_passes_with_strong_evidence():
    hit = Hit(1, 1, score=8.0)
    rows = {1: _row(text="Caste is a division of labourers and labour in India.")}
    d = gate.evaluate("caste labour", [hit], rows)
    assert d.passed and d.reason == "passed"


# ---------------------------------------------------------------------------
# end-to-end pipeline (needs models)
# ---------------------------------------------------------------------------

@needs_index
@needs_archive
def test_pipeline_answers_from_the_real_corpus():
    from backend.retrieval import pipeline
    with db.connect(readonly=True) as conn:
        r = pipeline.search(conn, "What did Ambedkar say about caste and division of labour?")
    assert r.decision.passed, f"gate refused: {r.decision.reason}"
    assert r.evidence, "expected evidence"
    assert r.answer.strip()
    assert r.timings.total_ms > 0


@needs_index
@needs_archive
def test_extractive_answer_is_verbatim_from_the_evidence():
    """Nothing is generated in Phase 2. Every sentence returned must exist
    character-for-character in a retrieved passage."""
    from backend.retrieval import pipeline
    from backend.ingest.chunk import split_sentences

    with db.connect(readonly=True) as conn:
        r = pipeline.search(conn, "What did Ambedkar say about untouchability in villages?")
    if not r.decision.passed:
        pytest.skip("gate refused; nothing to verify")
    corpus = " ".join(e["quote"] for e in r.evidence)
    for sentence in split_sentences(r.answer):
        assert sentence.strip() in corpus, f"not verbatim: {sentence[:70]!r}"


@needs_index
@needs_archive
def test_every_returned_citation_is_reachable():
    from backend.retrieval import pipeline
    with db.connect(readonly=True) as conn:
        r = pipeline.search(conn, "Round Table Conference safeguards for the Depressed Classes")
    for e in r.evidence:
        assert e["documentId"]
        assert e["pdfPage"] is not None
        assert e["charStart"] is not None and e["charEnd"] is not None
        assert e["citation"] and e["uid"]
        # A clean text layer has no engine score; nothing may invent one.
        if e["extractionMethod"] == "text_layer":
            assert e["confidence"] is None


@needs_index
@needs_archive
def test_refusal_returns_no_evidence():
    """Showing passages beside 'no confident source' invites the reader to
    treat them as the answer."""
    from backend.retrieval import pipeline
    with db.connect(readonly=True) as conn:
        r = pipeline.search(conn, "What is the best recipe for Neapolitan pizza dough?")
    assert not r.decision.passed
    assert r.evidence == []
    assert r.fallback


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

@needs_index
@needs_archive
def test_ask_endpoint_returns_evidence_and_timings():
    with TestClient(app) as client:
        r = client.post("/api/ask", json={"question": "What did Ambedkar say about caste?"})
        assert r.status_code == 200
        body = r.json()
        assert "answer" in body and "evidence" in body
        assert "gate" in body and "timings" in body
        assert body["timings"]["total_ms"] > 0


@needs_index
@needs_archive
def test_search_endpoint_exposes_candidates_and_stage_ranks():
    with TestClient(app) as client:
        body = client.get("/api/search", params={"q": "linguistic states"}).json()
        assert body["candidates"], "diagnostics must expose the fused candidates"
        first = body["candidates"][0]
        for key in ("rrfScore", "fusedRank", "denseRank", "lexicalRank"):
            assert key in first
        assert set(body["counts"]) >= {"dense", "lexical", "fused", "agreed"}


def test_ask_rejects_empty_question():
    with TestClient(app) as client:
        assert client.post("/api/ask", json={"question": "   "}).status_code == 400


def test_ask_rejects_overlong_question():
    with TestClient(app) as client:
        r = client.post("/api/ask", json={"question": "x" * (config.MAX_QUESTION_CHARS + 50)})
        assert r.status_code in (413, 422)


@needs_index
def test_health_reports_phase2_capabilities():
    with TestClient(app) as client:
        caps = client.get("/api/health").json()["capabilities"]
        assert caps["vector_search"] is True
        assert caps["hybrid_retrieval"] is True
        assert caps["evidence_gate"] is True
        # Retrieval must not depend on generation being present: the
        # extractive path stands on its own.
        assert caps["extractive_answer"] is True
