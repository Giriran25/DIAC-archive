"""Translation registry and the fallback ladder.

    translate(text, source, target)
      1. same language          -> return unchanged
      2. cached demo string     -> return the cached translation (works offline)
      3. live Bhashini          -> when credentials exist and the network allows
      4. otherwise              -> return the ENGLISH text, ok=False, labelled

Level 4 is the important one. English must always work: no visitor request
is ever blocked because a translation service is unreachable, and the
caller is told plainly that what it received is untranslated so the UI can
say so rather than passing English off as Hindi.

The cache holds only strings a human has verified. It is deliberately
empty until someone fills it - an auto-populated cache would be
machine-translated text presented as verified, which is the failure this
ladder exists to avoid.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from ..app.core import config
from .base import (
    LANGUAGES,
    TranslationHealth,
    TranslationProvider,
    TranslationResult,
)
from .bhashini import BhashiniProvider

__all__ = [
    "TranslationProvider", "TranslationResult", "TranslationHealth", "LANGUAGES",
    "BhashiniProvider", "get_translator", "translate", "translation_status",
]

# Human-verified translations for the demo path, shipped with the archive.
CACHE_PATH = Path(os.getenv("DAIC_TRANSLATION_CACHE",
                            config.ARCHIVE_DIR / "translations.json"))

_cache: dict | None = None


def _load_cache() -> dict:
    global _cache
    if _cache is None:
        try:
            _cache = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        except Exception:
            _cache = {}
    return _cache


def cache_lookup(text: str, target: str) -> str | None:
    entries = _load_cache().get(target) or {}
    return entries.get(text.strip())


_provider: TranslationProvider | None = None


def get_translator() -> TranslationProvider:
    global _provider
    if _provider is None:
        _provider = BhashiniProvider()
    return _provider


def translate(text: str, *, source: str = "en", target: str = "en") -> TranslationResult:
    """Run the ladder. Never raises; never returns empty text."""
    text = text or ""

    if source not in LANGUAGES or target not in LANGUAGES:
        return TranslationResult(False, text=text, source_language=source,
                                 target_language=target, provider="none",
                                 mode="unsupported",
                                 error=f"supported languages: {', '.join(LANGUAGES)}")

    if source == target or not text.strip():
        return TranslationResult(True, text=text, source_language=source,
                                 target_language=target, provider="none",
                                 mode="passthrough", translated=False)

    cached = cache_lookup(text, target)
    if cached:
        return TranslationResult(True, text=cached, source_language=source,
                                 target_language=target, provider="cache",
                                 mode="cache", translated=True)

    result = get_translator().translate(text, source=source, target=target)
    if result.ok:
        return result

    # Degrade to the original text, clearly marked as untranslated.
    return TranslationResult(
        ok=False, text=text, source_language=source, target_language=target,
        provider=result.provider or "bhashini", mode="untranslated",
        translated=False,
        error=result.error or "translation unavailable",
    )


def translation_status() -> dict:
    health = get_translator().health()
    cache = _load_cache()
    return {
        "provider": health.provider,
        "available": health.available,
        "mode": health.mode,
        "detail": health.detail,
        "languages": list(LANGUAGES),
        "cachedLanguages": sorted(cache.keys()),
        "cachedStrings": sum(len(v) for v in cache.values() if isinstance(v, dict)),
    }
