"""Extractive provider - the answer of last resort.

Implements the same interface as a real model but generates nothing. It
returns sentences lifted verbatim from the retrieved evidence, so its
citations are correct by construction and it cannot hallucinate.

It is used in three situations, and being a provider rather than a special
case keeps all three on one code path:

  * the LLM provider is unavailable, times out, or errors
  * the LLM's citations fail validation
  * the deployment has deliberately been configured without a model

This is also why Phase 2 built the extractive path first: it is the
reference implementation the generated answer is checked against.
"""

from __future__ import annotations

import re

from .base import GenerationResult, LLMProvider, ProviderHealth

_SENT = re.compile(r"([.!?][\"')\]]?)\s+")
_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)

_STOP = frozenset("""
a about an and any are as at be been but by can did do does for from had has
have he her his how i in is it its me my of on or our say said says she should
so some such than that the their them then there these they this to was we
were what when where which who why will with would you your
""".split())


def _sentences(text: str) -> list[str]:
    parts = _SENT.split(text or "")
    out, buf = [], ""
    for i, piece in enumerate(parts):
        buf += piece
        if i % 2 == 1:
            out.append(buf.strip())
            buf = ""
    if buf.strip():
        out.append(buf.strip())
    return [s for s in out if s]


def _is_prose(s: str) -> bool:
    """Same rule the Phase 2 pipeline uses: scanned volumes carry
    all-capitals sitting headers and table rows that read as shouting when
    lifted into an answer."""
    s = s.strip()
    if len(s) < 45 or not s.endswith((".", "!", "?", '"', "'", "”", "’")):
        return False
    letters = [c for c in s if c.isalpha()]
    if not letters or sum(1 for c in letters if c.isupper()) / len(letters) > 0.5:
        return False
    return sum(c.isdigit() for c in s) / len(s) <= 0.25


class ExtractiveProvider(LLMProvider):
    """Always available; never generates."""

    def name(self) -> str:
        return "extractive"

    def health(self) -> ProviderHealth:
        return ProviderHealth(True, "always available (no model)", None, True)

    def generate(self, question: str, evidence: list[dict]) -> GenerationResult:
        if not evidence:
            return GenerationResult(False, error="no evidence supplied", model="extractive")

        terms = {w.lower() for w in _WORD.findall(question or "")
                 if len(w) > 2 and w.lower() not in _STOP}

        parts: list[str] = []
        cited: list[int] = []
        for idx, ev in enumerate(evidence[:2], start=1):
            sentences = [s for s in _sentences(ev.get("quote", "")) if _is_prose(s)]
            if not sentences:
                continue
            scored = []
            for i, s in enumerate(sentences):
                low = s.lower()
                scored.append((sum(1 for t in terms if t in low), -i, i, s))
            scored.sort(reverse=True)
            picked = [x for x in scored[:2] if x[0] > 0] or scored[:1]
            picked.sort(key=lambda x: x[2])
            chunk = " ".join(x[3] for x in picked).strip()
            if chunk:
                parts.append(f"{chunk} [E{idx}]")
                cited.append(idx)

        if not parts:
            return GenerationResult(False, error="no quotable prose in evidence",
                                    model="extractive")

        return GenerationResult(
            ok=True,
            text=" ".join(parts),
            cited=cited,
            model="extractive",
            timings={"total_ms": 0.0},
        )
