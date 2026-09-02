"""Tesseract OCR provider.

NOT AVAILABLE on this machine: `tesseract` is not on PATH and
`pytesseract` is not installed. The provider is written and wired so that
installing Tesseract is the only step needed to turn real OCR on - until
then `health()` reports unavailable and the manuscript workflow falls back
to the paired text layer rather than inventing a transcription.

When Tesseract IS present, its TSV output carries a per-word confidence,
which is averaged into the page score. That is the only path by which a
confidence value ever enters this system.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from .base import OCRHealth, OCRProvider, OCRResult


class TesseractProvider(OCRProvider):
    def __init__(self, binary: str = "tesseract"):
        self.binary = binary

    def name(self) -> str:
        return "tesseract"

    def health(self) -> OCRHealth:
        if not shutil.which(self.binary):
            return OCRHealth(
                False, "tesseract",
                "tesseract is not installed on this machine; install it and "
                "the manuscript workflow will use it automatically",
            )
        try:
            out = subprocess.run([self.binary, "--version"], capture_output=True,
                                 text=True, timeout=20)
            version = (out.stdout or out.stderr).splitlines()[0].strip()
        except Exception as exc:
            return OCRHealth(False, "tesseract", f"tesseract present but not runnable: {exc}")
        return OCRHealth(True, "tesseract", version)

    def recognise(self, image_path: Path, *, lang: str = "eng") -> OCRResult:
        health = self.health()
        if not health.available:
            return OCRResult(False, engine="tesseract", error=health.detail)

        image_path = Path(image_path)
        if not image_path.exists():
            return OCRResult(False, engine="tesseract", error="image not found")

        try:
            proc = subprocess.run(
                [self.binary, str(image_path), "stdout", "-l", lang, "tsv"],
                capture_output=True, text=True, timeout=180,
            )
            if proc.returncode != 0:
                return OCRResult(False, engine="tesseract",
                                 error=(proc.stderr or "tesseract failed").strip()[:300])

            words: list[str] = []
            confidences: list[float] = []
            for line in proc.stdout.splitlines()[1:]:
                cols = line.split("\t")
                if len(cols) < 12:
                    continue
                text, conf = cols[11].strip(), cols[10].strip()
                if not text:
                    continue
                words.append(text)
                try:
                    value = float(conf)
                    if value >= 0:
                        confidences.append(value / 100.0)
                except ValueError:
                    pass

            joined = " ".join(words)
            return OCRResult(
                ok=bool(joined),
                text=joined,
                confidence=(sum(confidences) / len(confidences)) if confidences else None,
                engine="tesseract",
                words=len(words),
                error=None if joined else "no text recognised",
            )
        except subprocess.TimeoutExpired:
            return OCRResult(False, engine="tesseract", error="tesseract timed out")
        except Exception as exc:
            return OCRResult(False, engine="tesseract", error=f"{type(exc).__name__}: {exc}")
