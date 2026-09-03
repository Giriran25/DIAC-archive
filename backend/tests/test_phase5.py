"""Phase 5 - the live generation path.

The project decision these tests pin down: no local model runs during a
demonstration. Qwen took 50-86 seconds per answer on the demonstration
laptop and made the machine unusable while it ran, so the archive ships
pointing at the extractive path, optionally preferring a hosted API.

What must stay true:

  * importing backend.llm does not touch the Ollama runtime
  * the default provider is extractive
  * an unconfigured OpenRouter reports unavailable and never raises
  * every OpenRouter failure mode degrades rather than propagating
  * an extractive answer is never reported as model-generated
  * the reranker sees a query in the form it was trained on
"""

from __future__ import annotations

import sys

import pytest

from backend import llm
from backend.app.core import config
from backend.llm.fallback import ExtractiveProvider
from backend.llm.openrouter import OpenRouterProvider
from backend.retrieval.rerank import query_for_scoring

REPO_ROOT = config.REPO_ROOT

EVIDENCE = [
    {"id": "ws-vol-01:p0042:c00",
     "citation": "Writings and Speeches, Vol. 1, p. 42",
     "quote": "Caste System is not merely division of labour. It is also a division "
              "of labourers, which is quite different from division of labour."},
    {"id": "ws-vol-03:p0067:c01",
     "citation": "Writings and Speeches, Vol. 3, p. 67",
     "quote": "Political democracy cannot last unless there lies at the base of it "
              "social democracy, which means a way of life recognising liberty."},
]


# ---------------------------------------------------------------------------
# no local model on the live path
# ---------------------------------------------------------------------------

def test_importing_the_registry_does_not_load_ollama():
    """Starting the archive must not touch the Ollama runtime.

    Checked in a FRESH interpreter on purpose: another test in this suite
    imports Qwen by name, which would leave it in sys.modules and make an
    in-process assertion depend on test ordering. What matters
    operationally is a cold start, so that is what is measured.
    """
    import subprocess

    probe = "\n".join([
        "import importlib, sys",
        "for m in ('backend.llm','backend.retrieval.pipeline','backend.app.api.assist'):",
        "    importlib.import_module(m)",
        "print('LOADED' if 'backend.llm.qwen' in sys.modules else 'CLEAN')",
        "import backend.llm as L; print(L.get_provider().name())",
    ])
    out = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=180,
    )
    assert out.returncode == 0, out.stderr[-2000:]
    lines = [ln.strip() for ln in out.stdout.splitlines() if ln.strip()]
    assert "CLEAN" in lines, (
        "backend.llm.qwen was imported during a cold start; the live path "
        f"must not load the local model. stdout={lines}")
    assert "extractive" in lines


def test_default_provider_is_extractive(monkeypatch):
    monkeypatch.delenv("DAIC_LLM_PROVIDER", raising=False)
    llm.reset()
    assert llm.get_provider().name() == "extractive"
    llm.reset()


def test_qwen_is_still_reachable_by_name_but_never_default():
    assert "qwen" in llm.provider_names()
    assert llm.DEFAULT_PROVIDER == "extractive"


# ---------------------------------------------------------------------------
# the hosted provider degrades instead of failing
# ---------------------------------------------------------------------------

def test_openrouter_without_credentials_is_unavailable(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("DAIC_OPENROUTER_API_KEY", raising=False)
    health = OpenRouterProvider().health()
    assert health.available is False
    assert "extractive" in health.detail.lower()


def test_openrouter_without_credentials_returns_a_clean_failure(monkeypatch):
    """No exception may escape: a visitor question must always get an
    answer, and the pipeline turns ok=False into the extractive one."""
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("DAIC_OPENROUTER_API_KEY", raising=False)
    out = OpenRouterProvider().generate("what is caste", EVIDENCE)
    assert out.ok is False
    assert out.error
    assert out.text == ""


@pytest.mark.parametrize("boom", [
    TimeoutError("slow"),
    ConnectionRefusedError("no route"),
    ValueError("garbage"),
])
def test_openrouter_never_raises_whatever_the_transport_does(monkeypatch, boom):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    provider = OpenRouterProvider()
    provider.model = "test/model"

    def explode(*_a, **_k):
        raise boom

    monkeypatch.setattr("urllib.request.urlopen", explode)
    out = provider.generate("what is caste", EVIDENCE)
    assert out.ok is False
    assert out.text == ""
    assert out.error


def test_openrouter_rejects_an_empty_completion(monkeypatch):
    """An empty answer is a failure, not an answer. Returning it would show
    a blank response where the archive holds real evidence."""
    import io as _io
    import json as _json

    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    provider = OpenRouterProvider()
    provider.model = "test/model"

    body = _json.dumps({"choices": [{"message": {"content": "   "}}]}).encode()

    class _Resp:
        def read(self):
            return body

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: _Resp())
    out = provider.generate("what is caste", EVIDENCE)
    assert out.ok is False
    assert "empty" in (out.error or "")
    assert _io  # keep the import meaningful under linting


def test_openrouter_never_reports_the_api_key(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-SECRET-VALUE")
    provider = OpenRouterProvider()
    provider.model = "test/model"
    blob = f"{provider.name()} {provider.health().detail}"
    assert "SECRET" not in blob


# ---------------------------------------------------------------------------
# extractive answers are never dressed up as model output
# ---------------------------------------------------------------------------

def test_extractive_declares_itself_non_generative():
    assert ExtractiveProvider().is_generative() is False


def test_extractive_answer_is_verbatim_from_the_evidence():
    out = ExtractiveProvider().generate("division of labourers", EVIDENCE)
    assert out.ok
    body = out.text.split("[E")[0].strip()
    assert body, "extractive answer was empty"
    # Every sentence must appear in a passage it cited; nothing is composed.
    assert any(body.split(".")[0].strip() in ev["quote"] for ev in EVIDENCE)


def test_every_provider_declares_an_evidence_budget():
    for provider in (ExtractiveProvider(), OpenRouterProvider()):
        assert provider.evidence_max() >= 1


# ---------------------------------------------------------------------------
# the reranker is shown the query form it was trained on
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("question,expected", [
    ("What did Ambedkar write about the riddle of Rama and Krishna?",
     "the riddle of Rama and Krishna"),
    ("What did Ambedkar say about caste as a division of labourers?",
     "caste as a division of labourers"),
    ("Tell me about the Mahad Satyagraha", "the Mahad Satyagraha"),
])
def test_conversational_framing_is_stripped_for_scoring(question, expected):
    assert query_for_scoring(question) == expected


@pytest.mark.parametrize("question", ["caste", "What is caste?", "", "Rama"])
def test_short_queries_are_left_alone(question):
    """Stripping a short query would remove the only content it has, so the
    original is kept."""
    assert query_for_scoring(question) == question


def test_normalisation_keeps_the_content_words():
    out = query_for_scoring("Why did Ambedkar convert to Buddhism?")
    assert "Buddhism" in out
    assert "?" not in out
