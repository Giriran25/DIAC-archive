"""Cross-encoder reranking of the fused candidate set.

A bi-encoder embeds query and passage separately, so it never sees them
together. A cross-encoder reads the pair jointly and is markedly better at
judging relevance - at the cost of one full forward pass PER CANDIDATE,
which is why it runs over ~20 fused candidates and never over the corpus.

That linear cost is what drove the model choice. On this laptop (8 CPU
cores, no CUDA) a 568M-parameter reranker such as bge-reranker-v2-m3 would
need ~20 large forward passes per query; the measured comparison lives in
backend/tests/bench_rerankers.py and the selected model in config.

The model is a process-wide singleton, warmed at startup.
"""

from __future__ import annotations

import re
import threading
import time
from dataclasses import dataclass

from ..app.core import config


# ---------------------------------------------------------------------------
# Query form
# ---------------------------------------------------------------------------
#
# The cross-encoder is an MS MARCO model, trained on short web queries
# ("riddle of Rama and Krishna"), not on conversational sentences. A visitor
# at a kiosk types the sentence form, and the wrapper measurably depresses
# the score for the SAME passages:
#
#     "riddle of Rama and Krishna"                              -> 2.68
#     "What did Ambedkar write about the riddle of Rama and     -> 1.50
#      Krishna?"
#
# With the evidence floor at 2.5 that difference is the whole answer: the
# archive refused a question it holds sixty passages about. Stripping the
# wrapper puts the query in the form the scorer was trained on, so the score
# reflects the passage rather than the phrasing.
#
# This changes only what the SCORER is shown. Retrieval - dense, lexical,
# RRF - still uses the visitor's words, the gate floor is unchanged, and the
# evidence returned is the same evidence.

_LEAD_IN = re.compile(
    r"""^\s*(?:
        (?:please\s+)?
        (?:can|could|would|will)\s+you\s+(?:please\s+)?(?:tell\s+me|explain|describe|say)\s*
      | (?:please\s+)?(?:tell\s+me|explain|describe|summari[sz]e)\s+
      | what\s+(?:did|does|do|was|were|is|are)\s+
      | how\s+(?:did|does|do|was|were|is|are)\s+
      | why\s+(?:did|does|do|was|were|is|are)\s+
      | when\s+(?:did|does|do|was|were|is|are)\s+
      | where\s+(?:did|does|do|was|were|is|are)\s+
      | who\s+(?:did|does|do|was|were|is|are)\s+
      | what\s+is\s+the\s+relationship\s+between\s+
      | what\s+
    )""",
    re.IGNORECASE | re.VERBOSE,
)

# Fillers that survive the lead-in strip and carry no retrieval signal.
_FILLER = re.compile(
    r"\b(?:ambedkar|dr\.?\s*ambedkar|babasaheb)\s+(?:say|said|says|write|wrote|argue|argued|"
    r"think|thought|believe|believed|state|stated|mean|meant)\b(?:\s+about)?",
    re.IGNORECASE,
)

_TRAILING = re.compile(r"[\s?.!]+$")


def query_for_scoring(question: str) -> str:
    """Reduce a conversational question to the keyword form the
    cross-encoder was trained on.

    Conservative by construction: if stripping would leave too little to
    score against, the original question is returned unchanged. A short
    query that loses its content words scores worse, not better.
    """
    original = (question or "").strip()
    if not original:
        return original

    reduced = _LEAD_IN.sub("", original)
    reduced = _FILLER.sub("", reduced)
    reduced = re.sub(r"\s+", " ", reduced)
    reduced = _TRAILING.sub("", reduced).strip()
    # Leading connectives left behind by the strip ("about the riddle...").
    reduced = re.sub(r"^(?:about|regarding|concerning|on)\s+", "", reduced,
                     flags=re.IGNORECASE).strip()

    # And the determiner those leave behind. Measured on this archive:
    # "the Mahad Satyagraha" scores 2.490 and is refused, while
    # "Mahad Satyagraha" scores 2.630 and is answered - the same question,
    # decided by a word that carries no retrieval signal at all. Stripping
    # it makes the query cleaner; it does not lower the floor.
    reduced = re.sub(r"^(?:the|a|an)\s+", "", reduced, flags=re.IGNORECASE).strip()

    # Two content words is the floor; below that the original is safer.
    if len(reduced.split()) < 2 or len(reduced) < 8:
        return original
    return reduced


@dataclass
class RerankedHit:
    chunk_id: int
    score: float          # cross-encoder relevance; scale is model-specific
    rank: int             # 1-based, after reranking
    fused_rank: int       # where it sat before reranking
    dense_rank: int | None = None
    lexical_rank: int | None = None
    rrf_score: float = 0.0


class Reranker:
    def __init__(self, model_name: str | None = None):
        from sentence_transformers import CrossEncoder

        self.model_name = model_name or config.RERANK_MODEL
        started = time.perf_counter()
        self.model = CrossEncoder(
            self.model_name,
            max_length=512,
            device="cpu",
            cache_folder=str(config.MODEL_CACHE),
        )
        self.load_seconds = time.perf_counter() - started

    def score(self, query: str, passages: list[str],
              *, batch_size: int | None = None) -> list[float]:
        if not passages:
            return []
        pairs = [(query, p) for p in passages]
        raw = self.model.predict(
            pairs,
            batch_size=batch_size or config.RERANK_BATCH,
            show_progress_bar=False,
        )
        return [float(x) for x in raw]

    def rerank(self, query: str, candidates: list, texts: dict[int, str],
               *, top_k: int | None = None,
               second_chance_floor: float | None = None) -> list[RerankedHit]:
        """Score fused candidates and return the best `top_k`.

        `candidates` are FusedHit objects; `texts` maps chunk_id -> text.

        Two query forms, because neither one wins
        -----------------------------------------
        Stripping the conversational wrapper helps some questions badly and
        hurts others just as badly. Measured on this archive:

            "...about the riddle of Rama and Krishna?"  raw 1.50  stripped 2.59
            "...about labour rights?"                   raw 4.52  stripped 1.42
            "...about the rights of workers?"           raw 4.77  stripped -0.27

        Scoring only the stripped form therefore refused questions the
        archive can answer, and scoring only the raw form refuses others.
        Neither is "the" query; both are the same information need worded
        differently, and a phrasing artefact must not decide whether the
        archive answers.

        So when the best score falls short of the gate, the other form gets
        a hearing and each passage keeps its better score. The floor is NOT
        lowered - a passage still has to clear it, just not be disqualified
        for how the question happened to be typed.

        The second pass runs only on queries that would otherwise be
        refused, so the common path still costs one forward pass per
        candidate.
        """
        top_k = config.EVIDENCE_K if top_k is None else top_k
        if not candidates:
            return []

        passages = [texts.get(c.chunk_id, "") for c in candidates]
        primary = query_for_scoring(query)
        scores = self.score(primary, passages)

        alternate = (query or "").strip()
        if (second_chance_floor is not None and scores
                and max(scores) < second_chance_floor
                and alternate and alternate != primary):
            scores = [max(a, b) for a, b in zip(scores, self.score(alternate, passages))]

        scored = [
            RerankedHit(
                chunk_id=c.chunk_id,
                score=s,
                rank=0,
                fused_rank=c.rank,
                dense_rank=c.dense_rank,
                lexical_rank=c.lexical_rank,
                rrf_score=c.score,
            )
            for c, s in zip(candidates, scores)
        ]
        scored.sort(key=lambda h: (-h.score, h.fused_rank))
        for position, hit in enumerate(scored, start=1):
            hit.rank = position
        return scored[:top_k]


_reranker: Reranker | None = None
_lock = threading.Lock()


def get_reranker(model_name: str | None = None) -> Reranker:
    global _reranker
    wanted = model_name or config.RERANK_MODEL
    with _lock:
        if _reranker is None or _reranker.model_name != wanted:
            _reranker = Reranker(wanted)
        return _reranker


def is_loaded() -> bool:
    return _reranker is not None
