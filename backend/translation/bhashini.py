"""Bhashini translation provider.

NOT ACTIVE: Bhashini is a hosted Government of India service and requires
a ULCA user id, an API key and a pipeline id. None are present in this
environment, so `health()` reports unavailable and no request is ever
attempted.

    DAIC_BHASHINI_USER_ID
    DAIC_BHASHINI_API_KEY
    DAIC_BHASHINI_PIPELINE_ID

The request/response handling is written against Bhashini's documented
shape so that supplying credentials is the only step needed to switch it
on. Nothing here fabricates a translation: with no credentials the caller
gets `ok=False` and the English text is shown with a label, which is the
designed degradation.

There is also an architectural tension worth restating: Bhashini is an
internet service and the kiosk runs on an isolated LAN. Live translation
is therefore best-effort; the cache provider is what makes the demo path
work offline.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from .base import LANGUAGES, TranslationHealth, TranslationProvider, TranslationResult

ENDPOINT = os.getenv(
    "DAIC_BHASHINI_ENDPOINT",
    "https://dhruva-api.bhashini.gov.in/services/inference/pipeline",
)
TIMEOUT = float(os.getenv("DAIC_BHASHINI_TIMEOUT", "3"))


def _credentials() -> dict[str, str]:
    return {
        "user_id": os.getenv("DAIC_BHASHINI_USER_ID", ""),
        "api_key": os.getenv("DAIC_BHASHINI_API_KEY", ""),
        "pipeline_id": os.getenv("DAIC_BHASHINI_PIPELINE_ID", ""),
    }


class BhashiniProvider(TranslationProvider):
    def name(self) -> str:
        return "bhashini"

    def health(self) -> TranslationHealth:
        creds = _credentials()
        missing = [k for k, v in creds.items() if not v]
        if missing:
            return TranslationHealth(
                available=False,
                provider="bhashini",
                detail="credentials not configured: "
                       + ", ".join(f"DAIC_BHASHINI_{m.upper()}" for m in missing),
                mode="unavailable",
                languages=tuple(LANGUAGES),
            )
        return TranslationHealth(True, "bhashini", "credentials present", "live",
                                 tuple(LANGUAGES))

    def translate(self, text: str, *, source: str, target: str) -> TranslationResult:
        health = self.health()
        if not health.available:
            # No credentials: fail cleanly rather than pretend.
            return TranslationResult(False, text=text, source_language=source,
                                     target_language=target, provider="bhashini",
                                     mode="unavailable", error=health.detail)

        creds = _credentials()
        payload = {
            "pipelineTasks": [{
                "taskType": "translation",
                "config": {"language": {"sourceLanguage": source,
                                        "targetLanguage": target}},
            }],
            "inputData": {"input": [{"source": text}]},
        }
        request = urllib.request.Request(
            ENDPOINT,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "userID": creds["user_id"],
                "ulcaApiKey": creds["api_key"],
                "pipelineId": creds["pipeline_id"],
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                data = json.loads(response.read())
        except (urllib.error.URLError, TimeoutError) as exc:
            # Expected on an isolated LAN. English still works.
            return TranslationResult(False, text=text, source_language=source,
                                     target_language=target, provider="bhashini",
                                     mode="unavailable",
                                     error=f"bhashini unreachable: {exc}")
        except Exception as exc:
            return TranslationResult(False, text=text, source_language=source,
                                     target_language=target, provider="bhashini",
                                     mode="unavailable",
                                     error=f"{type(exc).__name__}: {exc}")

        try:
            output = data["pipelineResponse"][0]["output"][0]["target"]
        except (KeyError, IndexError, TypeError):
            return TranslationResult(False, text=text, source_language=source,
                                     target_language=target, provider="bhashini",
                                     mode="unavailable",
                                     error="unexpected response shape")

        return TranslationResult(True, text=output, source_language=source,
                                 target_language=target, provider="bhashini",
                                 mode="live", translated=True)
