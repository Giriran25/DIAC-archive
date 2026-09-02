"""The Phase 2 retrieval pipeline.

    question
      -> dense (FAISS)  +  lexical (FTS5)      run over the same corpus
      -> reciprocal rank fusion
      -> cross-encoder rerank of the fused top-K
      -> evidence gate
      -> extractive answer + citations

Every stage is timed separately, because "retrieval is slow" is not an
actionable statement - knowing the reranker owns 80% of the budget is.

No LLM is involved. The answer is extractive: sentences are lifted
verbatim from the retrieved passages, so a citation cannot point at text
that does not exist. Phase 3 replaces the answer step with a grounded
generator and keeps this extractive path as its fallback.
"""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass, field

from ..app.core import config
from . import fusion, gate, lexical, vector
from . import embedder as emb
from . import rerank as rr
from .evidence import to_evidence


@dataclass
class Timings:
    embed_ms: float = 0.0
    dense_ms: float = 0.0
    lexical_ms: float = 0.0
    fusion_ms: float = 0.0
    hydrate_ms: float = 0.0
    rerank_ms: float = 0.0
    gate_ms: float = 0.0
    answer_ms: float = 0.0
    generate_ms: float = 0.0
    total_ms: float = 0.0

    def as_dict(self) -> dict:
        return {k: round(v, 2) for k, v in self.__dict__.items()}


@dataclass
class RetrievalResult:
    question: str
    evidence: list[dict] = field(default_factory=list)
    decision: gate.GateDecision | None = None
    answer: str = ""
    fallback: bool = True
    timings: Timings = field(default_factory=Timings)
    counts: dict = field(default_factory=dict)
    candidates: list[dict] = field(default_factory=list)

    # --- set by answer(); untouched by pure retrieval ---
    grounded: bool = False              # produced by a model, citations validated
    provider: str = "extractive"
    generation: dict = field(default_factory=dict)
    citations: dict = field(default_factory=dict)
    degraded: str | None = None         # why the generated answer was not used


# Sentence splitting mirrors the frontend splitter so an extracted answer
# breaks where the UI would break it for read-aloud.
def _sentences(text: str) -> list[str]:
    from ..ingest.chunk import split_sentences
    return split_sentences(text)


def _is_prose(sentence: str) -> bool:
    """Reject the running furniture that survives into a chunk.

    Scanned volumes carry sitting headers and all-capitals section titles
    ('DEMAND FOR SPECIFIC AND CONCRETE PROVISIONS FOR SAFEGUARDS...').
    They are legitimately part of the source and stay in the quoted
    passage, but they read as shouting when lifted into an answer, so an
    extracted sentence has to look like a sentence.
    """
    s = sentence.strip()
    if len(s) < 45:
        return False
    if not s.rstrip().endswith((".", "!", "?", '"', "'", "”", "’")):
        return False
    letters = [c for c in s if c.isalpha()]
    if not letters:
        return False
    if sum(1 for c in letters if c.isupper()) / len(letters) > 0.5:
        return False          # a heading, not a sentence
    if sum(c.isdigit() for c in s) / len(s) > 0.25:
        return False          # a table row
    return True


def _extractive_answer(question: str, rows: dict, hits: list) -> str:
    """Build an answer from sentences that physically exist in the sources.

    Sentences are selected by overlap with the question's content words,
    then emitted in their original order so the result reads as prose
    rather than as a bag of fragments. Nothing is paraphrased: every
    sentence returned appears verbatim in a retrieved passage, which is
    what lets the citation be trusted without a validator.
    """
    match = lexical.build_match_query(question, mode="or")
    terms = {t for t in match.replace('"', "").split(" OR ")} if match else set()

    parts: list[str] = []
    for hit in hits[:2]:
        row = rows.get(hit.chunk_id)
        if row is None:
            continue
        sentences = [s for s in _sentences(row["text"]) if _is_prose(s)]
        if not sentences:
            continue
        scored = []
        for i, s in enumerate(sentences):
            low = s.lower()
            overlap = sum(1 for t in terms if t and t in low)
            scored.append((overlap, -i, i, s))
        scored.sort(reverse=True)
        picked = [x for x in scored[:2] if x[0] > 0] or scored[:1]
        picked.sort(key=lambda x: x[2])
        parts.append(" ".join(x[3] for x in picked))

    return " ".join(p.strip() for p in parts if p.strip())


def search(
    conn: sqlite3.Connection,
    question: str,
    *,
    dense_k: int | None = None,
    lexical_k: int | None = None,
    fuse_k: int | None = None,
    evidence_k: int | None = None,
    apply_gate: bool = True,
    include_candidates: bool = False,
    use_reranker: bool | None = None,
) -> RetrievalResult:
    dense_k = dense_k or config.RETRIEVE_DENSE_K
    lexical_k = lexical_k or config.RETRIEVE_LEXICAL_K
    fuse_k = fuse_k or config.FUSION_K
    evidence_k = evidence_k or config.EVIDENCE_K
    use_reranker = config.RERANK_ENABLED if use_reranker is None else use_reranker

    t = Timings()
    started = time.perf_counter()
    result = RetrievalResult(question=question, timings=t)

    # --- dense half -------------------------------------------------
    dense_hits = []
    index = vector.load()
    if index is not None:
        t0 = time.perf_counter()
        qvec = emb.get_embedder().encode_query(question)
        t.embed_ms = (time.perf_counter() - t0) * 1000

        t0 = time.perf_counter()
        dense_hits = index.search(qvec, dense_k)
        t.dense_ms = (time.perf_counter() - t0) * 1000

    # --- lexical half -----------------------------------------------
    t0 = time.perf_counter()
    lexical_hits = lexical.search(conn, question, limit=lexical_k)
    t.lexical_ms = (time.perf_counter() - t0) * 1000

    # --- fusion ------------------------------------------------------
    t0 = time.perf_counter()
    fused = fusion.reciprocal_rank_fusion(dense_hits, lexical_hits, limit=fuse_k)
    t.fusion_ms = (time.perf_counter() - t0) * 1000

    result.counts = {
        "dense": len(dense_hits),
        "lexical": len(lexical_hits),
        "fused": len(fused),
        "agreed": sum(1 for f in fused if f.found_by_both),
    }

    if not fused:
        t.total_ms = (time.perf_counter() - started) * 1000
        result.decision = gate.refuse_empty()
        result.answer = result.decision.message
        return result

    # --- hydrate -----------------------------------------------------
    t0 = time.perf_counter()
    rows = lexical.hydrate(conn, [f.chunk_id for f in fused])
    t.hydrate_ms = (time.perf_counter() - t0) * 1000

    # --- rerank ------------------------------------------------------
    # Whichever ranker produces the final order also produces the score
    # the gate judges, so the two must be reported together.
    t0 = time.perf_counter()
    if use_reranker:
        texts = {cid: row["text"] for cid, row in rows.items()}
        top = rr.get_reranker().rerank(question, fused, texts, top_k=evidence_k)
        scorer = "rerank"
    else:
        top = [
            rr.RerankedHit(
                chunk_id=f.chunk_id, score=f.score, rank=f.rank, fused_rank=f.rank,
                dense_rank=f.dense_rank, lexical_rank=f.lexical_rank, rrf_score=f.score,
            )
            for f in fused[:evidence_k]
        ]
        scorer = "rrf"
    t.rerank_ms = (time.perf_counter() - t0) * 1000
    result.counts["scorer"] = scorer

    if include_candidates:
        result.candidates = [
            {
                "uid": rows[f.chunk_id]["uid"] if f.chunk_id in rows else None,
                "chunkId": f.chunk_id,
                "rrfScore": round(f.score, 5),
                "fusedRank": f.rank,
                "denseRank": f.dense_rank,
                "lexicalRank": f.lexical_rank,
                "denseScore": round(f.dense_score, 4) if f.dense_score is not None else None,
                "lexicalScore": round(f.lexical_score, 4) if f.lexical_score is not None else None,
                "foundByBoth": f.found_by_both,
            }
            for f in fused
        ]

    # --- gate --------------------------------------------------------
    t0 = time.perf_counter()
    decision = (gate.evaluate(question, top, rows, scorer=scorer)
                if apply_gate else gate.allow_ungated(top))
    t.gate_ms = (time.perf_counter() - t0) * 1000
    result.decision = decision

    best = top[0].score if top else 0.0
    span = max(abs(best), 1e-6)
    result.evidence = [
        to_evidence(
            rows[h.chunk_id],
            relevance=round(min(max(h.score / span, 0.0), 1.0), 3) if best > 0 else None,
            scores={
                "rerank": round(h.score, 4),
                "rrf": round(h.rrf_score, 5),
                "denseRank": h.dense_rank,
                "lexicalRank": h.lexical_rank,
                "fusedRank": h.fused_rank,
            },
        )
        for h in top
        if h.chunk_id in rows
    ]

    # --- answer ------------------------------------------------------
    t0 = time.perf_counter()
    if decision.passed:
        result.answer = _extractive_answer(question, rows, top)
        result.fallback = False
    else:
        result.answer = decision.message
        result.fallback = True
        # A refusal shows no evidence: displaying passages beside "no
        # confident source" invites the reader to treat them as the answer.
        result.evidence = []
    t.answer_ms = (time.perf_counter() - t0) * 1000

    t.total_ms = (time.perf_counter() - started) * 1000
    return result


def answer(
    conn: sqlite3.Connection,
    question: str,
    *,
    evidence_k: int | None = None,
    provider=None,
    use_reranker: bool | None = None,
) -> RetrievalResult:
    """The visitor path: retrieve, gate, and only then generate.

    Ordering is the whole point.

      * The gate runs BEFORE generation, so a question the archive cannot
        support costs zero model time and cannot produce prose at all.
      * Citation validation runs AFTER generation, so an answer that cites
        something it was not given is discarded rather than shown.

    Every failure below the gate degrades to the extractive answer, which
    is verbatim from the evidence and therefore always citable. A visitor
    always gets something back.
    """
    from ..llm import get_fallback, get_provider
    from . import citations as cit

    result = search(conn, question, evidence_k=evidence_k, apply_gate=True,
                    use_reranker=use_reranker)

    # Gate refused: no model call, no evidence shown, nothing to validate.
    if result.decision is None or not result.decision.passed:
        result.grounded = False
        result.provider = "none"
        result.fallback = True
        return result

    # The extractive answer computed by search() is the standing fallback;
    # generation only replaces it if it validates.
    extractive_answer = result.answer
    llm = provider if provider is not None else get_provider()
    result.provider = llm.name()

    started = time.perf_counter()
    gen = llm.generate(question, result.evidence)
    result.timings.generate_ms = (time.perf_counter() - started) * 1000
    result.timings.total_ms += result.timings.generate_ms
    result.generation = dict(gen.timings or {})
    result.generation["ok"] = gen.ok
    if gen.error:
        result.generation["error"] = gen.error

    # 1. provider failed outright
    if not gen.ok:
        result.degraded = f"provider failed: {gen.error}"
        result.answer = extractive_answer or _fallback_text(llm, question, result)
        result.grounded = False
        result.fallback = True
        return result

    # 2. the model itself judged the evidence too thin. It is closer to the
    #    passages than the gate's thresholds are, so this is respected.
    if gen.insufficient:
        result.degraded = "model reported insufficient evidence"
        result.answer = gate.REFUSAL
        result.evidence = []
        result.grounded = False
        result.fallback = True
        result.decision = gate.GateDecision(
            False, "model reported insufficient evidence", gate.REFUSAL,
            result.decision.relevance, result.decision.coverage, True,
            result.decision.checks)
        return result

    # 3. citation validation, against exactly the passages the model was
    #    shown - not the full retrieved set, or [E3] would be judged
    #    against evidence the model never saw.
    from ..llm.qwen import EVIDENCE_MAX
    supplied = result.evidence[:EVIDENCE_MAX]
    report = cit.validate(gen.cited, supplied)
    result.citations = report.as_dict()
    if not report.valid:
        result.degraded = f"citations rejected: {report.reason}"
        result.answer = extractive_answer or _fallback_text(llm, question, result)
        result.grounded = False
        result.fallback = True
        return result

    # 4. accepted - show only the passages the answer actually rests on
    result.answer = gen.text
    result.evidence = cit.attach(supplied, report)
    result.grounded = True
    result.fallback = False
    return result


def _fallback_text(_provider, question: str, result: RetrievalResult) -> str:
    """Last resort when search() produced no extractive text either."""
    from ..llm import get_fallback
    out = get_fallback().generate(question, result.evidence)
    return out.text if out.ok else gate.REFUSAL


def warm() -> dict:
    """Load models and the index once, at startup, so the first real query
    does not pay for it. Returns what was loaded, for /api/health."""
    out = {"embedder": False, "reranker": False, "index": False}
    try:
        e = emb.get_embedder()
        out["embedder"] = True
        out["embed_model"] = e.model_name
        out["embed_dim"] = e.dim
    except Exception as exc:
        out["embedder_error"] = str(exc)
    try:
        r = rr.get_reranker()
        out["reranker"] = True
        out["rerank_model"] = r.model_name
    except Exception as exc:
        out["reranker_error"] = str(exc)
    idx = vector.load()
    if idx is not None:
        out["index"] = True
        out["vectors"] = idx.size

    # The LLM loads in the background: on this laptop a cold load takes
    # minutes, and lexical search plus the extractive path are fully
    # usable meanwhile, so startup must not block on it.
    try:
        from ..llm import get_provider
        provider = get_provider()
        health = provider.health()
        out["llm"] = provider.name()
        out["llm_available"] = health.available
        out["llm_loaded"] = health.loaded
        out["llm_detail"] = health.detail
        if health.available and not health.loaded:
            provider.warm()
    except Exception as exc:
        out["llm_error"] = str(exc)
    return out
