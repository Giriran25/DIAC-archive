"""FAISS vector index - the dense half of hybrid retrieval.

IndexFlatIP wrapped in IndexIDMap2, deliberately:

  * **Flat, not IVF or PQ.** At ~3,900 vectors an exhaustive scan is a few
    million floating-point operations - microseconds to low milliseconds.
    An approximate index would add tuning surface, a training step, and
    recall loss, and buy nothing measurable at this scale.
  * **IndexIDMap2** so the stored id is `chunks.id` itself. That is also
    the FTS5 rowid, so dense hits, lexical hits and SQLite rows join
    without a translation table.
  * **Inner product** on L2-normalised vectors, which is cosine similarity.

The index is persisted next to the database and loaded once at startup.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..app.core import config


@dataclass
class DenseHit:
    chunk_id: int
    score: float          # cosine similarity, -1..1
    rank: int             # 1-based


class VectorIndex:
    def __init__(self, index, dim: int, model_name: str):
        self.index = index
        self.dim = dim
        self.model_name = model_name

    @property
    def size(self) -> int:
        return int(self.index.ntotal)

    def search(self, query_vec: np.ndarray, k: int) -> list[DenseHit]:
        if self.size == 0:
            return []
        q = np.asarray(query_vec, dtype=np.float32).reshape(1, -1)
        scores, ids = self.index.search(q, min(k, self.size))
        hits: list[DenseHit] = []
        for rank, (score, cid) in enumerate(zip(scores[0], ids[0]), start=1):
            if cid == -1:          # FAISS pads short result sets with -1
                continue
            hits.append(DenseHit(chunk_id=int(cid), score=float(score), rank=rank))
        return hits


def build(vectors: np.ndarray, chunk_ids: list[int], *, dim: int) -> "VectorIndex":
    import faiss

    if len(vectors) != len(chunk_ids):
        raise ValueError("vectors and chunk_ids must be the same length")

    base = faiss.IndexFlatIP(dim)
    index = faiss.IndexIDMap2(base)
    index.add_with_ids(
        np.ascontiguousarray(vectors, dtype=np.float32),
        np.asarray(chunk_ids, dtype=np.int64),
    )
    return VectorIndex(index, dim, config.EMBED_MODEL)


def save(vec_index: "VectorIndex", path: Path | None = None) -> Path:
    import faiss

    target = Path(path or config.FAISS_PATH)
    target.parent.mkdir(parents=True, exist_ok=True)
    faiss.write_index(vec_index.index, str(target))
    # The model that produced the vectors is recorded beside the index:
    # searching an index with embeddings from a different model returns
    # confident nonsense, which is the worst possible failure here.
    target.with_suffix(".model").write_text(
        f"{vec_index.model_name}\n{vec_index.dim}\n", encoding="utf-8"
    )
    return target


_index: VectorIndex | None = None
_load_seconds: float = 0.0


def load(path: Path | None = None, *, force: bool = False) -> VectorIndex | None:
    """Load the persisted index once per process. Returns None when the
    index has not been built yet, so the API can report the capability as
    unavailable rather than crashing."""
    global _index, _load_seconds
    if _index is not None and not force:
        return _index

    import faiss

    target = Path(path or config.FAISS_PATH)
    if not target.exists():
        return None

    started = time.perf_counter()
    raw = faiss.read_index(str(target))
    meta = target.with_suffix(".model")
    model_name, dim = config.EMBED_MODEL, raw.d
    if meta.exists():
        lines = meta.read_text(encoding="utf-8").splitlines()
        if lines:
            model_name = lines[0].strip()
        if len(lines) > 1:
            dim = int(lines[1])
    _index = VectorIndex(raw, dim, model_name)
    _load_seconds = time.perf_counter() - started
    return _index


def load_seconds() -> float:
    return _load_seconds


def status() -> dict:
    """What the health endpoint reports about the dense half."""
    path = Path(config.FAISS_PATH)
    if not path.exists():
        return {"present": False, "vectors": 0, "model": None, "dim": None}
    idx = load()
    if idx is None:
        return {"present": False, "vectors": 0, "model": None, "dim": None}
    return {
        "present": True,
        "vectors": idx.size,
        "model": idx.model_name,
        "dim": idx.dim,
        "matches_configured_model": idx.model_name == config.EMBED_MODEL,
    }
