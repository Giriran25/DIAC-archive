"""OCR provider interface.

Same shape as the LLM provider abstraction: the workflow depends on this,
never on a concrete engine, so Tesseract can be added later without
touching the review pipeline.

The rule that governs every implementation here: **confidence is only ever
a real engine score.** When an engine reports none, `confidence` is None.
Nothing in this package estimates, infers or fills in a plausible number -
the archivist UI shows OCR confidence to decide what needs human eyes, and
a made-up number there is worse than no number at all.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


@dataclass
class OCRHealth:
    available: bool
    engine: str
    detail: str = ""


@dataclass
class OCRResult:
    ok: bool
    text: str = ""
    # Real engine score in 0-1, or None when the engine reports none.
    confidence: float | None = None
    engine: str = ""
    error: str | None = None
    words: int = 0


class OCRProvider(ABC):
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    def health(self) -> OCRHealth: ...

    @abstractmethod
    def recognise(self, image_path: Path, *, lang: str = "eng") -> OCRResult: ...
