"""Sentence embeddings for the dense half of hybrid retrieval.

The model is loaded once per process and reused. Loading a transformer
costs seconds; doing it per request would dominate the entire retrieval
budget, so `get_embedder()` is a process-wide singleton and the server
warms it at startup.

Two details are easy to get wrong and fail silently rather than loudly:

  * **Asymmetric prefixes.** BGE and E5 models are trained with different
    text on the query side than the passage side. Omitting the prefix
    costs retrieval quality with no error and no warning, so the prefixes
    live in PREFIXES below, keyed by model family.
  * **Normalisation.** The FAISS index is IndexFlatIP (inner product).
    Inner product equals cosine similarity only for unit-length vectors,
    so every embedding is L2-normalised on the way out.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import numpy as np

from ..app.core import config


@dataclass(frozen=True)
class Prefixes:
    """Query-side and passage-side instructions for one model family."""
    query: str
    passage: str


# Keyed by a substring of the model id. BGE puts an instruction only on the
# query side; E5 labels both sides.
PREFIXES: dict[str, Prefixes] = {
    "bge-": Prefixes(
        query="Represent this sentence for searching relevant passages: ",
        passage="",
    ),
    "e5-": Prefixes(query="query: ", passage="passage: "),
}
_DEFAULT_PREFIXES = Prefixes(query="", passage="")


def prefixes_for(model_name: str) -> Prefixes:
    lowered = model_name.lower()
    for key, value in PREFIXES.items():
        if key in lowered:
            return value
    return _DEFAULT_PREFIXES


class Embedder:
    """Thin wrapper over SentenceTransformer that owns the prefix and
    normalisation rules so no caller has to remember them."""

    def __init__(self, model_name: str | None = None):
        # Imported lazily: sentence-transformers pulls in torch, which is
        # slow to import and not needed by the ingest-only code paths.
        from sentence_transformers import SentenceTransformer

        self.model_name = model_name or config.EMBED_MODEL
        started = time.perf_counter()
        self.model = SentenceTransformer(
            self.model_name,
            cache_folder=str(config.MODEL_CACHE),
            device="cpu",
        )
        self.load_seconds = time.perf_counter() - started
        self.prefixes = prefixes_for(self.model_name)
        # sentence-transformers 6 renamed this; support both so a version
        # bump does not break the index build.
        getter = getattr(self.model, "get_embedding_dimension", None) or \
            self.model.get_sentence_embedding_dimension
        self.dim = int(getter())

    def encode_passages(self, texts: list[str], *, batch_size: int | None = None,
                        show_progress: bool = False) -> np.ndarray:
        prefixed = [f"{self.prefixes.passage}{t}" for t in texts]
        return self._encode(prefixed, batch_size, show_progress)

    def encode_query(self, text: str) -> np.ndarray:
        vec = self._encode([f"{self.prefixes.query}{text}"], None, False)
        return vec[0]

    def _encode(self, texts: list[str], batch_size: int | None,
                show_progress: bool) -> np.ndarray:
        out = self.model.encode(
            texts,
            batch_size=batch_size or config.EMBED_BATCH,
            convert_to_numpy=True,
            normalize_embeddings=True,   # unit length -> inner product is cosine
            show_progress_bar=show_progress,
        )
        return np.asarray(out, dtype=np.float32)


_embedder: Embedder | None = None
_lock = threading.Lock()


def get_embedder(model_name: str | None = None) -> Embedder:
    """Process-wide singleton. Warmed at server startup so the first real
    query does not pay the model load cost."""
    global _embedder
    wanted = model_name or config.EMBED_MODEL
    with _lock:
        if _embedder is None or _embedder.model_name != wanted:
            _embedder = Embedder(wanted)
        return _embedder


def is_loaded() -> bool:
    return _embedder is not None
