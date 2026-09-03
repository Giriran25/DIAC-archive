"""OpenRouter provider - the preferred generator when one is configured.

Why an external API rather than a local model: a local 8B model on the
demonstration laptop took 50-86 seconds per grounded answer and made the
machine unusable while it ran. A hosted model answers in a second or two
and costs the laptop nothing, which is what the kiosk needs.

Three properties matter more than the model choice:

  * **The key never leaves the server.** The tablet talks to FastAPI over
    the LAN; FastAPI talks to OpenRouter. There is no path by which the
    browser could see the credential, and none is ever sent to it.
  * **The timeout is bounded.** A visitor standing at a kiosk will not wait
    a minute. If the call has not returned by DAIC_LLM_TIMEOUT seconds it
    is abandoned and the extractive answer is used instead.
  * **It never raises.** Every operational failure - no key, no network,
    quota exhausted, malformed JSON, empty completion - comes back as
    ok=False with a reason, and the pipeline falls back. A question must
    always get an answer when the archive holds the evidence for one.

Only the standard library is used, so this adds no dependency.

Configuration (all optional; absent key means this provider is simply not
available and the archive uses the extractive path):

    DAIC_LLM_PROVIDER=openrouter
    OPENROUTER_API_KEY=sk-or-...        (or DAIC_OPENROUTER_API_KEY)
    OPENROUTER_MODEL=...                (or DAIC_OPENROUTER_MODEL)
    DAIC_LLM_TIMEOUT=20
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

from .base import (
    INSUFFICIENT,
    GenerationResult,
    LLMProvider,
    ProviderHealth,
    build_prompt,
    parse_citations,
    strip_reasoning,
)

API_URL = os.getenv("DAIC_OPENROUTER_URL", "https://openrouter.ai/api/v1/chat/completions")

#: No default model is invented. An operator names the model they have
#: access to; without one this provider reports itself unavailable.
MODEL = os.getenv("OPENROUTER_MODEL") or os.getenv("DAIC_OPENROUTER_MODEL") or ""

#: A kiosk visitor is standing in front of the screen. Twenty seconds is
#: already long; past that the extractive answer is strictly better than
#: continuing to wait.
GEN_TIMEOUT = float(os.getenv("DAIC_LLM_TIMEOUT", "20"))

EVIDENCE_MAX = int(os.getenv("DAIC_LLM_EVIDENCE_MAX", "4"))

MAX_TOKENS = int(os.getenv("DAIC_LLM_MAX_TOKENS", "400"))


def _api_key() -> str:
    return (os.getenv("OPENROUTER_API_KEY")
            or os.getenv("DAIC_OPENROUTER_API_KEY")
            or "").strip()


class OpenRouterProvider(LLMProvider):
    """Hosted generation over the archive's own retrieved evidence."""

    def __init__(self) -> None:
        self.model = MODEL

    def name(self) -> str:
        # The response payload carries a short name only - never the key,
        # never a URL, never a filesystem path.
        return f"openrouter:{self.model}" if self.model else "openrouter"

    def evidence_max(self) -> int:
        return EVIDENCE_MAX

    def health(self) -> ProviderHealth:
        """Configuration check only. This deliberately does NOT call the
        API: health is polled by the kiosk and must not spend quota, and a
        reachable network says nothing about whether generation will
        succeed for this particular request anyway."""
        if not _api_key():
            return ProviderHealth(
                False, "no OPENROUTER_API_KEY configured; using the extractive path",
                self.model or None, False)
        if not self.model:
            return ProviderHealth(
                False, "no OPENROUTER_MODEL configured; using the extractive path",
                None, False)
        return ProviderHealth(True, "configured", self.model, True)

    def warm_is_cheap(self) -> bool:
        # Nothing is loaded locally, so there is nothing to warm.
        return True

    def generate(self, question: str, evidence: list[dict]) -> GenerationResult:
        key = _api_key()
        if not key:
            return GenerationResult(False, error="no API key configured", model=self.name())
        if not self.model:
            return GenerationResult(False, error="no model configured", model=self.name())
        if not evidence:
            return GenerationResult(False, error="no evidence supplied", model=self.name())

        supplied = evidence[:EVIDENCE_MAX]
        prompt = build_prompt(question, supplied)

        payload = json.dumps({
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": MAX_TOKENS,
            # Grounded extraction, not composition: near-zero temperature
            # keeps the answer close to the passages it was given.
            "temperature": 0.1,
        }).encode("utf-8")

        request = urllib.request.Request(
            API_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {key}",
                # OpenRouter uses these for attribution. Neither identifies
                # a person and neither is required to be reachable.
                "HTTP-Referer": os.getenv("DAIC_OPENROUTER_REFERER", "http://localhost"),
                "X-Title": "DAIC ARCHIVE",
            },
            method="POST",
        )

        started = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=GEN_TIMEOUT) as resp:
                raw = resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            # Quota, auth and rate limits all arrive here. The status is
            # useful; the body may carry a key echo, so it is not surfaced.
            return GenerationResult(
                False, error=f"provider returned HTTP {exc.code}", model=self.name(),
                timings={"total_ms": (time.perf_counter() - started) * 1000})
        except TimeoutError:
            return GenerationResult(
                False, error=f"provider timed out after {GEN_TIMEOUT}s", model=self.name(),
                timings={"total_ms": (time.perf_counter() - started) * 1000})
        except Exception as exc:                     # network down, DNS, TLS
            return GenerationResult(
                False, error=f"provider unreachable: {type(exc).__name__}", model=self.name(),
                timings={"total_ms": (time.perf_counter() - started) * 1000})

        elapsed = (time.perf_counter() - started) * 1000

        try:
            data = json.loads(raw)
            text = data["choices"][0]["message"]["content"] or ""
        except Exception:
            return GenerationResult(False, error="provider returned malformed JSON",
                                    model=self.name(), timings={"total_ms": elapsed})

        text = strip_reasoning(text).strip()
        if not text:
            return GenerationResult(False, error="provider returned an empty answer",
                                    model=self.name(), timings={"total_ms": elapsed})

        usage = data.get("usage") or {}

        if INSUFFICIENT in text.upper():
            # The model is closer to the passages than the gate's thresholds
            # are, so its own refusal is respected rather than overridden.
            return GenerationResult(
                True, text="", insufficient=True, model=self.name(),
                tokens=int(usage.get("total_tokens") or 0),
                timings={"total_ms": elapsed})

        return GenerationResult(
            ok=True,
            text=text,
            cited=parse_citations(text),
            model=self.name(),
            tokens=int(usage.get("total_tokens") or 0),
            timings={"total_ms": elapsed},
        )
