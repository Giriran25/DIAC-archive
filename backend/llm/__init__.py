"""Provider registry.

The pipeline asks for `get_provider()` and receives something implementing
LLMProvider. It never names a model, so swapping Qwen for anything else is
one environment variable and no code change.

    DAIC_LLM_PROVIDER=qwen        local Qwen via the installed Ollama runtime
    DAIC_LLM_PROVIDER=extractive  no model; verbatim sentences only
"""

from __future__ import annotations

import os
import threading

from .base import GenerationResult, LLMProvider, ProviderHealth
from .fallback import ExtractiveProvider
from .qwen import QwenProvider

__all__ = [
    "LLMProvider", "ProviderHealth", "GenerationResult",
    "QwenProvider", "ExtractiveProvider",
    "get_provider", "get_fallback", "PROVIDERS",
]

PROVIDERS: dict[str, type[LLMProvider]] = {
    "qwen": QwenProvider,
    "extractive": ExtractiveProvider,
}

_provider: LLMProvider | None = None
_fallback: LLMProvider | None = None
_lock = threading.Lock()


def get_provider(name: str | None = None) -> LLMProvider:
    """Process-wide singleton, so weights load once rather than per request."""
    global _provider
    wanted = (name or os.getenv("DAIC_LLM_PROVIDER", "qwen")).lower()
    cls = PROVIDERS.get(wanted, QwenProvider)
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
