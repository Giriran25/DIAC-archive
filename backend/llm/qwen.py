"""Qwen provider backed by the Ollama runtime already installed here.

Detected on this laptop, not assumed:
    runtime  : Ollama 0.33.1, serving on http://127.0.0.1:11434
    model    : qwen3:8b - 8.2B parameters, Q4_K_M, 5.2 GB, 40960 ctx
    install  : pre-existing; this module never downloads, pulls or
               modifies a model. If the configured model is absent it
               reports unavailable and the pipeline falls back.

Only the standard library is used to talk to Ollama, so no HTTP
dependency is added to the runtime. The endpoint is loopback-only; nothing
leaves the machine and there is no API key to leak.

Two Qwen3-specific details matter:

  * **Thinking is disabled** (`think: false`). Qwen3 emits a
    <think>...</think> block by default, which on this CPU costs far more
    tokens than the answer itself.
  * **keep_alive** holds the weights resident between questions. A cold
    load measured 295.8s on this machine - 5.2 GB paged into ~1.8 GB of
    free RAM - against 0.0s once resident. Keeping it loaded is the
    difference between a usable kiosk and an unusable one.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request

from .base import (
    GenerationResult,
    INSUFFICIENT,
    LLMProvider,
    ProviderHealth,
    build_prompt,
    parse_citations,
    strip_reasoning,
)

OLLAMA_HOST = os.getenv("DAIC_OLLAMA_HOST", "http://127.0.0.1:11434")
QWEN_MODEL = os.getenv("DAIC_QWEN_MODEL", "qwen3:8b")

# Budgets derived from measured rates on this laptop, not guessed:
#   prompt evaluation  25-45 tokens/s (rises with prompt length)
#   generation         ~5.5 tokens/s  (flat)
#
# Generation is the expensive half, so the output cap matters most: 220
# tokens would cost ~40s on its own. 128 covers the 2-3 sentences the
# prompt asks for. Evidence is capped in build_prompt via EVIDENCE_CHARS
# and EVIDENCE_MAX below - four 1600-char passages measured ~35s of prompt
# evaluation before a single token was produced.
GEN_TIMEOUT = float(os.getenv("DAIC_LLM_TIMEOUT", "90"))
KEEP_ALIVE = os.getenv("DAIC_LLM_KEEP_ALIVE", "30m")
NUM_PREDICT = int(os.getenv("DAIC_LLM_MAX_TOKENS", "128"))
NUM_CTX = int(os.getenv("DAIC_LLM_CTX", "4096"))

# How much evidence reaches the model. Retrieval still returns the full
# set to the UI; this only bounds what is paid for at generation time.
EVIDENCE_MAX = int(os.getenv("DAIC_LLM_EVIDENCE_MAX", "3"))
EVIDENCE_CHARS = int(os.getenv("DAIC_LLM_EVIDENCE_CHARS", "700"))


def _post(path: str, payload: dict, timeout: float) -> dict:
    req = urllib.request.Request(
        f"{OLLAMA_HOST}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def _get(path: str, timeout: float) -> dict:
    with urllib.request.urlopen(f"{OLLAMA_HOST}{path}", timeout=timeout) as resp:
        return json.loads(resp.read())


class QwenProvider(LLMProvider):
    def __init__(self, model: str | None = None, host: str | None = None):
        self.model = model or QWEN_MODEL
        self.host = host or OLLAMA_HOST
        self._warming = False
        self._lock = threading.Lock()

    def name(self) -> str:
        return f"qwen/{self.model} (ollama)"

    # -- detection ---------------------------------------------------

    def installed_models(self) -> list[str]:
        try:
            data = _get("/api/tags", timeout=5)
        except Exception:
            return []
        return [m.get("name", "") for m in data.get("models", [])]

    def _resident(self) -> bool:
        """Whether the weights are currently in RAM - i.e. whether the next
        request pays the cold-start cost."""
        try:
            data = _get("/api/ps", timeout=5)
        except Exception:
            return False
        return any(m.get("name") == self.model for m in data.get("models", []))

    def health(self) -> ProviderHealth:
        models = self.installed_models()
        if not models:
            return ProviderHealth(False, f"Ollama not reachable at {self.host}", self.model)
        if self.model not in models:
            return ProviderHealth(
                False,
                f"model {self.model!r} is not installed (present: {', '.join(models) or 'none'})",
                self.model,
            )
        loaded = self._resident()
        return ProviderHealth(
            True,
            "resident" if loaded else ("loading" if self._warming else "installed, not loaded"),
            self.model,
            loaded,
        )

    # -- warm-up -----------------------------------------------------

    def warm(self) -> None:
        """Load the weights in the background.

        Blocking on this would hold up server startup for minutes on this
        machine, during which lexical search and the extractive path are
        perfectly usable - so the server comes up immediately and the LLM
        capability switches on when the model lands.
        """
        with self._lock:
            if self._warming:
                return
            self._warming = True

        def _load() -> None:
            try:
                # An empty prompt with keep_alive loads the model without
                # generating anything.
                _post("/api/generate",
                      {"model": self.model, "prompt": "", "stream": False,
                       "keep_alive": KEEP_ALIVE},
                      timeout=900)
            except Exception:
                pass
            finally:
                self._warming = False

        threading.Thread(target=_load, name="qwen-warm", daemon=True).start()

    # -- generation --------------------------------------------------

    def generate(self, question: str, evidence: list[dict]) -> GenerationResult:
        if not evidence:
            return GenerationResult(False, error="no evidence supplied", model=self.model)

        # Only the top passages are sent for generation; the citation
        # markers stay 1-based over this same truncated list, so [E2]
        # means the second passage the model actually saw.
        supplied = evidence[:EVIDENCE_MAX]
        prompt = build_prompt(question, supplied, max_chars=EVIDENCE_CHARS)
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "think": False,          # Qwen3: suppress the reasoning block
            "keep_alive": KEEP_ALIVE,
            "options": {
                "num_predict": NUM_PREDICT,
                "num_ctx": NUM_CTX,
                "temperature": 0.0,   # deterministic: this is a citation tool
                "top_p": 1.0,
                "repeat_penalty": 1.05,
            },
        }

        started = time.perf_counter()
        try:
            data = _post("/api/generate", payload, timeout=GEN_TIMEOUT)
        except urllib.error.URLError as exc:
            return GenerationResult(
                False, error=f"provider unreachable: {exc.reason}", model=self.model,
                timings={"total_ms": round((time.perf_counter() - started) * 1000, 1)})
        except TimeoutError:
            return GenerationResult(
                False, error=f"provider timed out after {GEN_TIMEOUT}s", model=self.model,
                timings={"total_ms": round((time.perf_counter() - started) * 1000, 1)})
        except Exception as exc:
            return GenerationResult(
                False, error=f"{type(exc).__name__}: {exc}", model=self.model,
                timings={"total_ms": round((time.perf_counter() - started) * 1000, 1)})

        total_ms = (time.perf_counter() - started) * 1000
        raw = strip_reasoning(data.get("response", ""))
        timings = {
            "total_ms": round(total_ms, 1),
            "load_ms": round(data.get("load_duration", 0) / 1e6, 1),
            "prompt_ms": round(data.get("prompt_eval_duration", 0) / 1e6, 1),
            "generate_ms": round(data.get("eval_duration", 0) / 1e6, 1),
            "prompt_tokens": data.get("prompt_eval_count", 0),
            "output_tokens": data.get("eval_count", 0),
        }
        gen_s = data.get("eval_duration", 0) / 1e9
        if gen_s > 0:
            timings["tokens_per_sec"] = round(data.get("eval_count", 0) / gen_s, 2)

        if not raw:
            return GenerationResult(False, error="empty response", model=self.model,
                                    timings=timings)

        if INSUFFICIENT in raw.upper():
            return GenerationResult(
                True, text="", insufficient=True, model=self.model,
                tokens=timings["output_tokens"], timings=timings)

        return GenerationResult(
            ok=True,
            text=raw,
            cited=parse_citations(raw),
            model=self.model,
            tokens=timings["output_tokens"],
            timings=timings,
        )
