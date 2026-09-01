"""API response contract.

Deliberately shaped to match the evidence object the existing React UI is
already built against (src/data/corpus.js -> PASSAGES, consumed by
EvidenceCard). Keeping the field names means the evidence UI, the citation
chips and the archivist tables keep working without being rewritten.

New fields are additive only:
    uid, documentId, page, pageEnd, charStart, charEnd,
    mediaStartMs, mediaEndMs, extractionMethod

camelCase is used on the wire because the consumer is JavaScript.
"""

from typing import Literal
from pydantic import BaseModel, Field


class Evidence(BaseModel):
    """One retrieved passage. This is the unit a citation points at."""

    # --- fields the current UI already consumes -------------------------
    id: str = Field(description="Stable chunk uid, e.g. 'ws-vol-01:p0042:c00'")
    kind: str = Field(description="'Primary source' | 'Cross-reference' | 'Manuscript'")
    citation: str = Field(description="Human-readable citation with volume and page")
    quote: str = Field(description="The passage text, verbatim from the source")
    confidence: float | None = Field(
        default=None,
        description="Genuine extraction confidence. None for a clean embedded "
                    "text layer; a real engine score for OCR/ASR. Never invented.",
    )
    provenance: str = Field(description="How this text was obtained")
    status: str = Field(description="Digitised | In review | Queued")

    articleId: str = Field(description="Owning document id")
    articleTitle: str = Field(description="Owning document title")
    theme: str | None = None
    date: str | None = None

    relevance: float | None = Field(
        default=None, description="0-1, relative to the top hit in this result set"
    )

    # --- additive: what makes a citation actually reachable -------------
    uid: str
    documentId: str
    page: int | None = Field(default=None, description="1-based page the passage starts on")
    pageEnd: int | None = None
    charStart: int | None = None
    charEnd: int | None = None
    mediaStartMs: int | None = None
    mediaEndMs: int | None = None
    language: str = "en"
    docType: str | None = None
    extractionMethod: str | None = None


class ArchiveStats(BaseModel):
    documents: int
    documents_approved: int
    documents_pending: int
    chunks: int
    chunks_indexed_vector: int
    characters: int
    pages: int
    entities: int
    timeline_events: int
    ingest_log_entries: int


class HealthResponse(BaseModel):
    """Readiness for the kiosk. The tablet polls this to decide whether to
    show the archive or the offline state."""

    status: Literal["ok", "degraded", "empty"]
    archive: str
    schema_version: str
    phase: str
    database: str
    database_present: bool
    stats: ArchiveStats
    capabilities: dict[str, bool]
    retrieval: dict | None = None
    detail: str | None = None
