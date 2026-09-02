"""Citation validator - the check that runs after generation.

The evidence gate decides whether the model may speak. This decides
whether what it said may be shown. A generated answer is only allowed out
if every citation in it points at a passage that was actually retrieved
for this question.

Four checks, per cited marker:

  1. **In range**  - [E4] when only three passages were supplied is an
     invented citation, not a typo.
  2. **Document**  - the marker resolves to a real document id.
  3. **Page**      - the passage carries the page anchor a reader would
     follow. A citation that cannot be opened is not a citation.
  4. **Provenance** - it is approved material with character offsets, the
     same standard the gate applied.

An answer with no citations at all fails too: an uncited sentence is
indistinguishable from an invented one, which is the failure this archive
exists to prevent.

Failure is never silent. The caller discards the generated answer and
returns the extractive fallback instead.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CitationReport:
    valid: bool
    reason: str = "ok"
    cited: list[int] = field(default_factory=list)      # markers found in the answer
    resolved: list[dict] = field(default_factory=list)  # the evidence they point at
    invalid: list[int] = field(default_factory=list)    # markers that failed

    def as_dict(self) -> dict:
        return {
            "valid": self.valid,
            "reason": self.reason,
            "cited": self.cited,
            "invalid": self.invalid,
            "resolvedIds": [e.get("uid") for e in self.resolved],
        }


def validate(cited: list[int], evidence: list[dict]) -> CitationReport:
    """Check the markers a model produced against the evidence it was given.

    `cited` are 1-based indices into `evidence`, exactly as they were
    rendered into the prompt as [E1], [E2], ...
    """
    if not evidence:
        return CitationReport(False, "no evidence was supplied to the model")

    if not cited:
        # An answer that cites nothing cannot be traced, so it is treated
        # as ungrounded regardless of how plausible it reads.
        return CitationReport(False, "answer contains no citation")

    resolved: list[dict] = []
    invalid: list[int] = []
    reasons: list[str] = []

    for marker in cited:
        if marker < 1 or marker > len(evidence):
            invalid.append(marker)
            reasons.append(f"[E{marker}] out of range (1-{len(evidence)})")
            continue

        ev = evidence[marker - 1]

        if not ev.get("documentId"):
            invalid.append(marker)
            reasons.append(f"[E{marker}] has no document id")
            continue

        # Page anchor: a printed page, or an explicit PDF page, or a media
        # timestamp for A/V. One of them must be present.
        has_page = (
            ev.get("page") is not None
            or ev.get("pdfPage") is not None
            or ev.get("mediaStartMs") is not None
        )
        if not has_page:
            invalid.append(marker)
            reasons.append(f"[E{marker}] has no page anchor")
            continue

        if ev.get("charStart") is None or ev.get("charEnd") is None:
            invalid.append(marker)
            reasons.append(f"[E{marker}] has no character offsets")
            continue

        if ev.get("verificationStatus") not in (None, "approved"):
            invalid.append(marker)
            reasons.append(f"[E{marker}] not approved ({ev.get('verificationStatus')})")
            continue

        resolved.append(ev)

    if invalid:
        return CitationReport(False, "; ".join(reasons), cited, resolved, invalid)

    return CitationReport(True, "ok", cited, resolved, [])


def attach(answer_evidence: list[dict], report: CitationReport) -> list[dict]:
    """Return only the evidence the answer actually cited, in citation
    order, so the UI shows the passages the text rests on rather than
    everything that was retrieved."""
    if not report.valid or not report.resolved:
        return answer_evidence
    return report.resolved
