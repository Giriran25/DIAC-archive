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

import threading
import time
from dataclasses import dataclass

from ..app.core import config


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
               *, top_k: int | None = None) -> list[RerankedHit]:
        """Score fused candidates and return the best `top_k`.

        `candidates` are FusedHit objects; `texts` maps chunk_id -> text.
        """
        top_k = config.EVIDENCE_K if top_k is None else top_k
        if not candidates:
            return []

        passages = [texts.get(c.chunk_id, "") for c in candidates]
        scores = self.score(query, passages)

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
