"""Provider registry.

The pipeline asks for `get_provider()` and receives something implementing
LLMProvider. It never names a model, so changing generator is one
environment variable and no code change.

    DAIC_LLM_PROVIDER=extractive   DEFAULT. No model. Verbatim sentences
                                   lifted from the retrieved evidence, so
                                   citations are correct by construction.
    DAIC_LLM_PROVIDER=openrouter   Hosted generation, server-side only.
                                   Requires OPENROUTER_API_KEY and
                                   OPENROUTER_MODEL; falls back to
                                   extractive if either is missing or the
                                   call fails.
    DAIC_LLM_PROVIDER=qwen         Local Qwen via Ollama. NOT the default
                                   and not loaded unless asked for by name
                                   - see below.

Why extractive is the default
-----------------------------
Local Qwen was measured on the demonstration laptop at 50-86 seconds per
grounded answer, with RAM pressure severe enough to make the machine slow
while it ran, and it did not reliably produce an answer at all. A visitor
at a kiosk cannot wait that long, so the archive no longer ships pointing
at it. The provider is kept - the abstraction costs nothing and the code
is correct - but it is opt-in, and importing it is deferred so that merely
starting the archive never touches the Ollama runtime.

Whatever the provider, retrieval is unchanged: hybrid dense + lexical
search, RRF, reranking, the evidence gate and citation validation all run
identically. The provider only decides how the sentences are phrased.
"""

from __future__ import annotations

import os
import threading

from .base import GenerationResult, LLMProvider, ProviderHealth
from .fallback import ExtractiveProvider
from .openrouter import OpenRouterProvider

__all__ = [
    "LLMProvider", "ProviderHealth", "GenerationResult",
    "ExtractiveProvider", "OpenRouterProvider", "QwenProvider",
    "get_provider", "get_fallback", "provider_names", "DEFAULT_PROVIDER",
]


def __getattr__(name: str):
    """`from backend.llm import QwenProvider` still works, but importing it
    is what pulls the module in - the package itself never does.

    That difference is the operational point: starting the archive imports
    this package and must not thereby touch the Ollama runtime. A test or
    an operator naming Qwen explicitly still gets it.
    """
    if name == "QwenProvider":
        from .qwen import QwenProvider as _QwenProvider
        return _QwenProvider
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


DEFAULT_PROVIDER = "extractive"

_provider: LLMProvider | None = None
_fallback: LLMProvider | None = None
_lock = threading.Lock()


def _load(name: str) -> type[LLMProvider]:
    """Resolve a provider name to a class.

    Qwen is imported lazily and only when named. A top-level import would
    execute its module at startup on every deployment, including the ones
    that have deliberately turned it off.
    """
    if name == "openrouter":
        return OpenRouterProvider
    if name == "qwen":
        from .qwen import QwenProvider
        return QwenProvider
    return ExtractiveProvider


def provider_names() -> tuple[str, ...]:
    return ("extractive", "openrouter", "qwen")


def get_provider(name: str | None = None) -> LLMProvider:
    """Process-wide singleton, so a provider is constructed once."""
    global _provider
    wanted = (name or os.getenv("DAIC_LLM_PROVIDER", DEFAULT_PROVIDER)).strip().lower()
    cls = _load(wanted)
    with _lock:
        if _provider is None or not isinstance(_provider, cls):
            _provider = cls()
        return _provider


def get_fallback() -> LLMProvider:
    """The extractive provider, always available, used when generation is
    refused, fails, or produces citations that do not validate."""
    global _fallback
    with _lock:
        if _fallback is None:
            _fallback = ExtractiveProvider()
        return _fallback


def reset() -> None:
    """Tests only - drop the cached singletons."""
    global _provider, _fallback
    with _lock:
        _provider = None
        _fallback = None
