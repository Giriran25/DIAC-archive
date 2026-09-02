"""OCR provider registry.

    DAIC_OCR_PROVIDER=tesseract   real OCR (requires tesseract on PATH)
    DAIC_OCR_PROVIDER=textlayer   the album's companion PDF text layer

Defaults to Tesseract and falls back to the text layer when Tesseract is
absent. Whichever ran is recorded per page in `manuscript_pages.ocr_engine`,
so the archivist can always see how a transcription was produced.
"""

from __future__ import annotations

import os

from .base import OCRHealth, OCRProvider, OCRResult
from .tesseract import TesseractProvider
from .textlayer import TextLayerProvider

__all__ = [
    "OCRProvider", "OCRResult", "OCRHealth",
    "TesseractProvider", "TextLayerProvider",
    "get_ocr_provider", "ocr_status",
]


def get_ocr_provider(pdf_path=None, name: str | None = None) -> OCRProvider:
    wanted = (name or os.getenv("DAIC_OCR_PROVIDER", "tesseract")).lower()

    if wanted == "textlayer" and pdf_path:
        return TextLayerProvider(pdf_path)

    tesseract = TesseractProvider()
    if tesseract.health().available:
        return tesseract
    if pdf_path:
        return TextLayerProvider(pdf_path)
    return tesseract          # unavailable, and honest about it


def album_pdf() -> "os.PathLike | None":
    """The companion PDF of the registered manuscript, if the archive has
    one. Looked up rather than hard-coded so the status reflects the data
    actually loaded."""
    try:
        from ..app.core import config, db
        with db.connect(readonly=True) as conn:
            row = conn.execute(
                "SELECT paired_pdf FROM manuscripts WHERE paired_pdf IS NOT NULL LIMIT 1"
            ).fetchone()
        if row and row["paired_pdf"]:
            return config.REPO_ROOT / row["paired_pdf"]
    except Exception:
        pass
    return None


def ocr_status(pdf_path=None) -> dict:
    """What /api/health reports about OCR.

    `available` means "a page can be transcribed right now", which is true
    whenever ANY provider works - not only when Tesseract is installed.
    The engine that would actually run is named, so the distinction
    between real OCR and the publisher's text layer is never hidden.
    """
    tesseract = TesseractProvider().health()
    provider = get_ocr_provider(pdf_path or album_pdf())
    health = provider.health()
    return {
        "engine": provider.name(),
        "available": health.available,
        "detail": health.detail,
        "realOcrEngine": tesseract.available,
        "tesseract": {"available": tesseract.available, "detail": tesseract.detail},
    }
