"""Reciprocal Rank Fusion of the dense and lexical result lists.

RRF combines rankings rather than scores, which is the whole point: FAISS
returns cosine similarities in roughly 0.5-0.9 and FTS5 returns BM25
values with no bounded range. Normalising two such scales against each
other requires assumptions that do not hold across queries; ranks need no
such assumption.

    score(chunk) = sum over retrievers of  1 / (k + rank)

k damps the influence of the top rank so a single retriever cannot
dominate on its own; 60 is the value from the original RRF paper and the
common default.

A chunk found by BOTH retrievers accumulates two terms and therefore
outranks a chunk found by only one at the same position - which is
exactly the agreement signal hybrid retrieval exists to exploit.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..app.core import config


@dataclass
class FusedHit:
    chunk_id: int
    score: float                                   # RRF score
    rank: int = 0                                  # 1-based, after fusion
    dense_rank: int | None = None
    lexical_rank: int | None = None
    dense_score: float | None = None
    lexical_score: float | None = None
    sources: list[str] = field(default_factory=list)

    @property
    def found_by_both(self) -> bool:
        return self.dense_rank is not None and self.lexical_rank is not None


def reciprocal_rank_fusion(
    dense: list,
    lexical: list,
    *,
    k: int | None = None,
    limit: int | None = None,
) -> list[FusedHit]:
    """Fuse DenseHit and LexicalHit lists into one ranking.

    Both inputs only need `.chunk_id`, `.rank` and `.score`, so this stays
    independent of either retriever's implementation.
    """
    k = config.RRF_K if k is None else k
    limit = config.FUSION_K if limit is None else limit

    merged: dict[int, FusedHit] = {}

    for hit in dense:
        entry = merged.setdefault(hit.chunk_id, FusedHit(chunk_id=hit.chunk_id, score=0.0))
        entry.score += 1.0 / (k + hit.rank)
        entry.dense_rank = hit.rank
        entry.dense_score = hit.score
        entry.sources.append("dense")

    for hit in lexical:
        entry = merged.setdefault(hit.chunk_id, FusedHit(chunk_id=hit.chunk_id, score=0.0))
        entry.score += 1.0 / (k + hit.rank)
        entry.lexical_rank = hit.rank
        entry.lexical_score = hit.score
        entry.sources.append("lexical")

    ordered = sorted(
        merged.values(),
        # Ties broken toward the chunk both retrievers agreed on, then by
        # the better single rank, then by id so the order is deterministic.
        key=lambda h: (
            -h.score,
            not h.found_by_both,
            min(h.dense_rank or 10**6, h.lexical_rank or 10**6),
            h.chunk_id,
        ),
    )
    for position, hit in enumerate(ordered, start=1):
        hit.rank = position
    return ordered[:limit]
