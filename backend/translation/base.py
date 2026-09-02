"""Translation provider interface.

Translation is a PRESENTATION layer. It sits at exactly two points -
translating an incoming non-English question, and translating an outgoing
answer - and never anywhere else.

Two rules the whole architecture depends on:

  1. **Nothing translated is ever written to the canonical archive.** The
     index is English; a translated copy in it would give two citations
     for one passage and break provenance.
  2. **Translation runs AFTER citation validation**, so it can never
     affect which sources an answer rests on. Source quotes, citation
     strings, page numbers and metadata are never translated - the quote
     is evidence, and evidence is shown as it was written.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

# The visitor languages the kiosk offers. English is the canonical
# retrieval language; the rest are display only.
LANGUAGES = {
    "en": "English",
    "hi": "Hindi",
    "mr": "Marathi",
    "kn": "Kannada",
    "ta": "Tamil",
}


@dataclass
class TranslationHealth:
    available: bool
    provider: str
    detail: str = ""
    mode: str = "unavailable"      # 'live' | 'cache' | 'passthrough' | 'unavailable'
    languages: tuple[str, ...] = ()


@dataclass
class TranslationResult:
    ok: bool
    text: str = ""
    source_language: str = "en"
    target_language: str = "en"
    provider: str = ""
    mode: str = ""                 # how this specific result was produced
    translated: bool = False       # False when the text came back unchanged
    error: str | None = None


class TranslationProvider(ABC):
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    def health(self) -> TranslationHealth: ...

    @abstractmethod
    def translate(self, text: str, *, source: str, target: str) -> TranslationResult: ...

    def supports(self, language: str) -> bool:
        return language in LANGUAGES
