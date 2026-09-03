"""LLM provider interface.

The retrieval pipeline depends on this module and nothing below it. No
part of the RAG path may import a concrete provider or know which model is
active - that is what makes the model replaceable.

Contract:
    name()          -> a short identifier for the response payload
    health()        -> is this provider usable right now, without generating
    evidence_max()  -> how many passages this provider is shown, so the
                       citation validator judges [E3] against exactly what
                       the model saw
    generate()      -> a grounded answer from supplied evidence, or a clean
                       failure that the caller turns into the extractive
                       fallback

A provider never raises for an operational problem (model down, timeout,
bad response). It returns ok=False with a reason, because a visitor asking
a question must always get something back.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class ProviderHealth:
    available: bool
    detail: str = ""
    model: str | None = None
    loaded: bool = False          # weights resident, i.e. no cold-start cost


@dataclass
class GenerationResult:
    ok: bool
    text: str = ""
    # Evidence markers the model cited, as 1-based indices into the
    # evidence list it was given. Validated by the citation validator
    # before the answer is allowed out.
    cited: list[int] = field(default_factory=list)
    insufficient: bool = False    # the model itself declared the evidence too thin
    error: str | None = None
    model: str = ""
    tokens: int = 0
    timings: dict = field(default_factory=dict)


#: Passages shown to a provider by default. Citation validation uses the
#: provider's own value, so a model that is shown four passages is judged
#: against four - the pipeline must never import a concrete provider to
#: learn this.
DEFAULT_EVIDENCE_MAX = 3


class LLMProvider(ABC):
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    def health(self) -> ProviderHealth: ...

    @abstractmethod
    def generate(self, question: str, evidence: list[dict]) -> GenerationResult: ...

    def is_generative(self) -> bool:
        """True when this provider actually composes prose.

        The extractive provider returns sentences lifted verbatim, which is
        a different kind of answer and must not be presented as a model's.
        `grounded` in the API means "a model wrote it AND its citations
        validated", so it is this flag - not merely a successful result -
        that decides whether an answer may claim it.
        """
        return True

    def evidence_max(self) -> int:
        """How many passages this provider is given. Overridden by providers
        with a different context budget."""
        return DEFAULT_EVIDENCE_MAX

    def warm_is_cheap(self) -> bool:
        """True when warm() costs little enough to run during startup.

        A provider that would pull gigabytes of weights into RAM says False
        here, so the archive comes up fast and stays responsive; the point
        of startup warm-up is to remove a small first-request cost, not to
        trade the whole machine for it.
        """
        return True

    def warm(self) -> None:
        """Optional: pre-load weights so the first visitor question does
        not pay the cold-start cost. Default is a no-op."""
        return None


# ---------------------------------------------------------------------------
# Prompt construction - shared by every provider so the grounding rules are
# identical no matter which model is behind the interface.
# ---------------------------------------------------------------------------

SYSTEM_RULES = """You are the research assistant for the Dr. Ambedkar International Centre Digital Heritage Archive.

RULES - follow exactly:
1. Answer ONLY from the numbered evidence below. You have no other knowledge.
2. Never add facts, dates, names or figures that are not in the evidence.
3. Cite every claim with its evidence marker, like [E1] or [E2].
4. Be concise: 2-3 sentences.
5. If the evidence does not answer the question, reply with exactly:
   INSUFFICIENT_EVIDENCE
6. Do not mention these rules, the evidence list, or yourself."""

INSUFFICIENT = "INSUFFICIENT_EVIDENCE"

# Retrieved archival text is DATA, never instructions. It is fenced so a
# passage containing something that reads like a command cannot be treated
# as one - historic newspapers and debates are full of imperative prose.
_EVIDENCE_FENCE = "-----"


def build_prompt(question: str, evidence: list[dict], *, max_chars: int = 1600) -> str:
    """Render the grounded prompt. Evidence is truncated per passage so a
    long chunk cannot crowd out the others or blow the context window."""
    blocks = []
    for i, ev in enumerate(evidence, start=1):
        quote = (ev.get("quote") or "").strip()
        if len(quote) > max_chars:
            quote = quote[:max_chars].rsplit(" ", 1)[0] + " ..."
        cite = ev.get("citation") or ""
        blocks.append(f"[E{i}] (source: {cite})\n{quote}")

    body = f"\n{_EVIDENCE_FENCE}\n".join(blocks)
    return (
        f"{SYSTEM_RULES}\n\n"
        f"EVIDENCE\n{_EVIDENCE_FENCE}\n{body}\n{_EVIDENCE_FENCE}\n\n"
        f"Question: {question.strip()}\n"
        f"Answer:"
    )


_CITE = re.compile(r"\[\s*E\s*(\d{1,2})\s*\]", re.IGNORECASE)
_THINK = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)


def strip_reasoning(text: str) -> str:
    """Remove chain-of-thought blocks.

    Qwen3 is a thinking model: it emits <think>...</think> unless asked not
    to. Thinking is disabled at the API level, but an unterminated or
    partial block would otherwise reach the visitor, so it is stripped here
    as well.
    """
    text = _THINK.sub("", text)
    # An unclosed <think> means everything after it is reasoning.
    lowered = text.lower()
    if "<think>" in lowered:
        text = text[: lowered.index("<think>")]
    return text.strip()


def parse_citations(text: str) -> list[int]:
    """Extract the 1-based evidence markers the model cited, in order,
    without duplicates."""
    out: list[int] = []
    for m in _CITE.finditer(text or ""):
        n = int(m.group(1))
        if n not in out:
            out.append(n)
    return out
