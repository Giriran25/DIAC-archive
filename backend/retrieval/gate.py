"""The evidence gate - the decision to answer or to refuse.

This is the product's central claim: the archive would rather say nothing
than say something it cannot source. The gate runs AFTER reranking,
because the cross-encoder score is the best available estimate of whether
a passage actually answers the question, and BEFORE generation, so a
failed gate costs no model call at all.

Three independent signals, all of which must hold:

  1. **Relevance** - the top reranked score must clear a floor. This is
     the primary signal and does most of the work.
  2. **Query coverage** - enough of the question's content words must
     appear in the evidence. Catches the case where the reranker likes a
     passage that shares the question's shape but not its subject.
  3. **Provenance validity** - the chunk must be approved, from an
     approved document, and carry the anchors a citation needs. A passage
     that cannot be cited is not evidence, however relevant.

Thresholds were calibrated by sweeping them against the evaluation set
(`python -m backend.tests.evaluate --both --tune`), not chosen by
intuition. Two things that sweep established, both measured:

  * The cross-encoder score separates answerable from unanswerable far
    better than the RRF score does (33/40 vs 26/40 at the best split).
    That - not ranking quality - is what earns the reranker its place.
  * Using the MARGIN between the top score and the candidate median was
    tried and is WORSE (30/40): an unanswerable question also produces a
    clear winner within its own weak pack, so the margin does not
    discriminate. The absolute score is the better signal.

The floor deliberately favours refusing over answering. An unsupported
answer is the failure this archive exists to prevent, so the operating
point accepts some false refusals to keep leaks near zero. It MUST be
re-tuned when the reranker model changes, and again on P4's independent
question set.
"""

from __future__ import annotations

import os
import re
import sqlite3
from dataclasses import dataclass, field

from .lexical import STOPWORDS

# ---------------------------------------------------------------------------
# Thresholds.
#
# The reranker emits an unbounded logit, not a probability, and its scale
# is model-specific - so this floor is only meaningful together with the
# configured reranker, and must be re-tuned if that model changes.
# ---------------------------------------------------------------------------
# Two floors, because the two rankers emit incomparable scales: a
# cross-encoder logit is unbounded, an RRF score is a sum of 1/(k+rank)
# terms bounded by the number of retrievers. Whichever produced the top
# score picks the floor.
RELEVANCE_FLOOR = float(os.getenv("DAIC_GATE_RELEVANCE", "2.5"))        # cross-encoder logit
RRF_FLOOR = float(os.getenv("DAIC_GATE_RRF", "0.0161"))                 # RRF score
COVERAGE_FLOOR = float(os.getenv("DAIC_GATE_COVERAGE", "0.30"))

REFUSAL = "No confident source found in the archive."
REFUSAL_EMPTY = (
    "No confident source found in the archive. "
    "Try asking about the writings, speeches or Constituent Assembly debates it holds."
)

_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)


@dataclass
class GateDecision:
    passed: bool
    reason: str
    message: str = ""
    relevance: float | None = None
    coverage: float | None = None
    provenance_ok: bool = True
    checks: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "passed": self.passed,
            "reason": self.reason,
            "relevance": None if self.relevance is None else round(self.relevance, 4),
            "coverage": None if self.coverage is None else round(self.coverage, 3),
            "provenanceOk": self.provenance_ok,
            "thresholds": {
                "relevanceRerank": RELEVANCE_FLOOR,
                "relevanceRrf": RRF_FLOOR,
                "coverage": COVERAGE_FLOOR,
            },
            "checks": self.checks,
        }


def _content_terms(question: str) -> list[str]:
    return [
        w.lower() for w in _WORD.findall(question or "")
        if len(w) > 2 and w.lower() not in STOPWORDS
    ]


def coverage_of(question: str, rows: list[sqlite3.Row]) -> float:
    """Fraction of the question's content words that appear in the evidence.

    Prefix matching stands in for stemming so 'labourers' counts for
    'labour' - the FTS5 side already stems via the porter tokenizer, and
    this keeps the two halves broadly consistent.
    """
    terms = _content_terms(question)
    if not terms:
        return 0.0
    haystack = " ".join((r["text"] or "").lower() for r in rows)
    words = set(_WORD.findall(haystack))
    found = 0
    for term in terms:
        if term in words or any(w.startswith(term[:5]) for w in words if len(term) >= 5):
            found += 1
    return found / len(terms)


def provenance_valid(row: sqlite3.Row) -> tuple[bool, str]:
    """A passage that cannot be cited is not evidence."""
    if row["verification_status"] != "approved":
        return False, f"chunk not approved ({row['verification_status']})"
    if not row["document_id"]:
        return False, "no document id"
    if row["page_start"] is None:
        return False, "no page anchor"
    if row["char_start"] is None or row["char_end"] is None:
        return False, "no character offsets"
    return True, "ok"


def evaluate(question: str, hits: list, rows: dict, *, scorer: str = "rerank") -> GateDecision:
    if not hits:
        return refuse_empty()

    top = hits[0]
    evidence_rows = [rows[h.chunk_id] for h in hits if h.chunk_id in rows]
    if not evidence_rows:
        return refuse_empty()

    # 1. relevance, against the floor for whichever ranker scored it
    floor = RELEVANCE_FLOOR if scorer == "rerank" else RRF_FLOOR
    relevance = float(top.score)
    relevance_ok = relevance >= floor

    # 2. coverage
    coverage = coverage_of(question, evidence_rows)
    coverage_ok = coverage >= COVERAGE_FLOOR

    # 3. provenance - judged on the top passage, the one a citation names
    top_row = rows.get(top.chunk_id)
    prov_ok, prov_reason = provenance_valid(top_row) if top_row is not None else (False, "missing row")

    checks = {
        "relevance": {"value": round(relevance, 4), "floor": floor,
                      "scorer": scorer, "ok": relevance_ok},
        "coverage": {"value": round(coverage, 3), "floor": COVERAGE_FLOOR, "ok": coverage_ok},
        "provenance": {"ok": prov_ok, "detail": prov_reason},
    }

    if relevance_ok and coverage_ok and prov_ok:
        return GateDecision(True, "passed", "", relevance, coverage, prov_ok, checks)

    if not prov_ok:
        reason = f"provenance: {prov_reason}"
    elif not relevance_ok:
        reason = f"relevance {relevance:.4g} below floor {floor:.4g} ({scorer})"
    else:
        reason = f"coverage {coverage:.2f} below floor {COVERAGE_FLOOR}"

    return GateDecision(False, reason, REFUSAL, relevance, coverage, prov_ok, checks)


def refuse_empty() -> GateDecision:
    return GateDecision(False, "no candidates retrieved", REFUSAL_EMPTY, None, None, True, {})


def allow_ungated(hits: list) -> GateDecision:
    """Diagnostics only - lets /api/search show what the gate would have
    seen without suppressing the evidence."""
    return GateDecision(
        True, "gate bypassed (diagnostic)", "",
        float(hits[0].score) if hits else None, None, True, {},
    )
