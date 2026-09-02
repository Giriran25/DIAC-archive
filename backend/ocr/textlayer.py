"""Text-layer transcription provider for the manuscript album.

The 102 JP2 plates have a companion PDF, page for page, whose text layer
was produced by the album's own publisher. Reading it is real extraction
from real archival material - not this system inventing a transcription -
and it is labelled `pdf_text_layer` so it can never be mistaken for the
output of a recogniser we ran.

It reports **confidence = None**. No engine ran, so no score exists, and a
plausible-looking number here would be a fabrication. Pages therefore
reach the review queue unscored, which is the correct signal: a human
decides.

This is what makes the manuscript workflow demonstrable end to end on a
machine with no OCR engine installed.
"""

from __future__ import annotations

import re
from pathlib import Path

from .base import OCRHealth, OCRProvider, OCRResult


class TextLayerProvider(OCRProvider):
    """Reads page N of a companion PDF. The image path is used only to
    derive the page number; the text comes from the paired document."""

    def __init__(self, pdf_path: Path | str):
        self.pdf_path = Path(pdf_path)

    def name(self) -> str:
        return "pdf_text_layer"

    def health(self) -> OCRHealth:
        if not self.pdf_path.exists():
            return OCRHealth(False, "pdf_text_layer",
                             f"companion PDF missing: {self.pdf_path.name}")
        return OCRHealth(True, "pdf_text_layer",
                         f"reads the publisher's own text layer from {self.pdf_path.name}")

    @staticmethod
    def page_from_filename(image_path: Path) -> int | None:
        """`PR_000003009972_0074.jp2` -> 74 (0-based, matching the PDF)."""
        match = re.search(r"(\d{3,4})(?=\.\w+$)", Path(image_path).name)
        return int(match.group(1)) if match else None

    def recognise(self, image_path: Path, *, lang: str = "eng") -> OCRResult:
        health = self.health()
        if not health.available:
            return OCRResult(False, engine=self.name(), error=health.detail)

        index = self.page_from_filename(image_path)
        if index is None:
            return OCRResult(False, engine=self.name(),
                             error="could not determine page number from filename")

        import fitz

        try:
            doc = fitz.open(self.pdf_path)
            if not 0 <= index < doc.page_count:
                doc.close()
                return OCRResult(False, engine=self.name(),
                                 error=f"page {index} outside companion PDF")
            text = re.sub(r"\s+", " ", doc[index].get_text().strip())
            doc.close()
        except Exception as exc:
            return OCRResult(False, engine=self.name(), error=f"{type(exc).__name__}: {exc}")

        return OCRResult(
            ok=bool(text),
            text=text,
            confidence=None,        # no recogniser ran, so no score exists
            engine=self.name(),
            words=len(text.split()),
            error=None if text else "no text on this page",
        )
