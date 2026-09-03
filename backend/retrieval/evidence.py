"""Turn a chunk row into the Evidence object the API returns.

The field names match what the existing React UI already consumes
(EvidenceCard, the citation chips), so the frontend needs no rewrite. The
additive fields are the ones that make a citation reachable: document id,
both page numbers, and the character offsets a source viewer highlights.

Nothing here invents a value. `confidence` stays None for a clean text
layer, and every anchor comes straight from the ingested row.
"""

from __future__ import annotations

import sqlite3


# Roman numerals read better in a citation than 'Vol. 5', and the volumes
# print themselves that way.
def _volume_label(volume: str | None) -> str | None:
    return volume


def build_citation(row: sqlite3.Row) -> str:
    """A citation a reader could follow to the page.

    Prefers the printed page number - what a scholar cites - and falls
    back to the PDF page only when the printed number is genuinely
    unknown, labelling it as such rather than passing one off as the other.
    """
    title = row["doc_title"] or ""
    parts: list[str] = [title.split(",")[0] if "," in title else title]

    if row["doc_volume"]:
        parts.append(row["doc_volume"])
    if row["section"]:
        parts.append(row["section"])

    printed = row["printed_page_start"]
    if printed is not None:
        end = row["printed_page_end"]
        parts.append(f"pp. {printed}-{end}" if end and end != printed else f"p. {printed}")
    elif row["page_start"] is not None:
        parts.append(f"PDF p. {row['page_start']}")

    if row["media_start_ms"] is not None:
        ms = int(row["media_start_ms"])
        parts.append(f"at {ms // 60000:02d}:{(ms // 1000) % 60:02d}")

    return ", ".join(p for p in parts if p)


def _kind(row: sqlite3.Row) -> str:
    method = (row["extraction_method"] or "").lower()
    if method == "ocr":
        return "Manuscript"
    if method == "asr":
        return "Transcript"
    if (row["doc_type"] or "") == "Debate":
        return "Debate record"
    return "Primary source"


def _provenance(row: sqlite3.Row) -> str:
    method = (row["extraction_method"] or "unknown").replace("_", " ")
    where = f"page {row['page_start']}" if row["page_start"] is not None else "unknown page"
    base = f"Extracted by {method} from {row['doc_path']}, {where}."
    if row["confidence"] is not None:
        base += f" Engine confidence {row['confidence']:.2f}."
    return base


def _status(row: sqlite3.Row) -> str:
    return {
        "approved": "Digitised",
        "in_review": "In review",
        "pending": "Queued",
        "rejected": "Rejected",
    }.get(row["verification_status"], "Queued")


def to_evidence(row: sqlite3.Row, *, relevance: float | None = None,
                scores: dict | None = None) -> dict:
    """Serialise one chunk. `relevance` is 0-1 relative to the top hit."""
    return {
        # --- shape the current UI already renders ---
        "id": row["uid"],
        "kind": _kind(row),
        "citation": build_citation(row),
        "quote": row["text"],
        "confidence": row["confidence"],
        "provenance": _provenance(row),
        "status": _status(row),
        "articleId": row["document_id"],
        "articleTitle": row["doc_title"],
        "volume": row["doc_volume"],
        "theme": row["section"],
        "date": row["doc_date"],
        "relevance": relevance,

        # --- additive: what makes the citation reachable ---
        "uid": row["uid"],
        "documentId": row["document_id"],
        "section": row["section"],
        "page": row["printed_page_start"],
        "pageEnd": row["printed_page_end"],
        "pdfPage": row["page_start"],
        "pdfPageEnd": row["page_end"],
        "charStart": row["char_start"],
        "charEnd": row["char_end"],
        "mediaStartMs": row["media_start_ms"],
        "mediaEndMs": row["media_end_ms"],
        "language": row["language"],
        "docType": row["doc_type"],
        "extractionMethod": row["extraction_method"],
        "verificationStatus": row["verification_status"],
        "scores": scores or {},
    }
