"""Phase 4 tests: the frontend-integration surfaces.

The load-bearing assertions are the ones about AUTHORITY:

  * unapproved OCR text must not be retrievable
  * approving it must make it retrievable
  * rejecting it must withdraw it again

Everything else here is contract-shape checking, so a frontend can rely on
the field names without reading the source.
"""

from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.app.core import config, db
from backend.app.main import app
from backend.ocr import TesseractProvider, TextLayerProvider
from backend.retrieval import lexical

needs_archive = pytest.mark.skipif(not config.DB_PATH.exists(), reason="archive not built")


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _first_document(client) -> str:
    return client.get("/api/archive").json()["documents"][0]["id"]


# ---------------------------------------------------------------------------
# archive + source resolution (PS req 3, 17)
# ---------------------------------------------------------------------------

@needs_archive
def test_archive_lists_documents_with_facets(client):
    body = client.get("/api/archive").json()
    assert body["count"] >= 1
    doc = body["documents"][0]
    for key in ("id", "title", "docType", "language", "verificationStatus", "checksum"):
        assert key in doc
    assert "docTypes" in body["facets"]


@needs_archive
def test_archive_never_leaks_a_filesystem_path(client):
    blob = repr(client.get("/api/archive").json())
    assert "C:\\" not in blob and "/Users/" not in blob
    assert "Data/" not in blob


@needs_archive
def test_document_detail_lists_sections(client):
    body = client.get(f"/api/archive/{_first_document(client)}").json()
    assert body["document"]["id"]
    assert body["totals"]["chunks"] > 0


@needs_archive
def test_unknown_document_returns_404(client):
    r = client.get("/api/archive/no-such-document")
    assert r.status_code == 404
    assert "detail" in r.json()


@needs_archive
def test_citation_uid_resolves_to_its_passage(client):
    """A citation the RAG returns must resolve to the exact source."""
    answer = client.post("/api/ask", json={"question": "caste and division of labour"}).json()
    if not answer["evidence"]:
        pytest.skip("gate refused; no citation to resolve")
    uid = answer["evidence"][0]["uid"]

    body = client.get(f"/api/source/{uid}").json()
    source = body["source"]
    assert source["uid"] == uid
    assert source["documentId"] and source["pdfPage"] is not None
    assert source["charStart"] is not None and source["charEnd"] is not None
    assert source["quote"]


@needs_archive
def test_unknown_source_returns_404(client):
    assert client.get("/api/source/definitely-not-a-real-uid").status_code == 404


@needs_archive
def test_page_endpoint_returns_full_text(client):
    doc = _first_document(client)
    with db.connect(readonly=True) as conn:
        row = conn.execute(
            "SELECT printed_page_start FROM chunks WHERE document_id = ? "
            "AND printed_page_start IS NOT NULL LIMIT 1", (doc,)).fetchone()
    if row is None:
        pytest.skip("no printed page anchors")
    body = client.get(f"/api/source/{doc}/page/{row['printed_page_start']}").json()
    assert body["text"] and body["passages"]
    assert body["pageType"] == "printed"


@needs_archive
def test_missing_page_returns_404(client):
    assert client.get(f"/api/source/{_first_document(client)}/page/999999").status_code == 404


# ---------------------------------------------------------------------------
# preservation (PS req 12)
# ---------------------------------------------------------------------------

@needs_archive
def test_preservation_record_has_a_checksum(client):
    body = client.get(f"/api/preservation/{_first_document(client)}").json()
    assert len(body["sha256"]) == 64
    assert body["byteSize"] > 0
    assert isinstance(body["events"], list)


@needs_archive
def test_verify_recomputes_the_checksum(client):
    doc = _first_document(client)
    body = client.post(f"/api/preservation/verify/{doc}").json()
    if not body.get("actual"):
        pytest.skip("source file not present on this machine")
    assert body["verified"] is True
    assert body["actual"] == body["expected"]


@needs_archive
def test_audit_log_is_append_only_and_readable(client):
    body = client.get("/api/audit-log", params={"limit": 5}).json()
    assert body["appendOnly"] is True
    assert body["total"] >= 1


# ---------------------------------------------------------------------------
# manuscripts + OCR (PS req 5, 15) - the authority rules
# ---------------------------------------------------------------------------

@needs_archive
def test_manuscript_pages_start_unapproved(client):
    body = client.get("/api/manuscripts").json()
    if not body["count"]:
        pytest.skip("no manuscripts registered")
    ms = body["manuscripts"][0]
    detail = client.get(f"/api/manuscript/{ms['id']}").json()
    assert detail["pages"]
    assert any(p["reviewStatus"] == "pending" for p in detail["pages"])


@needs_archive
def test_manuscript_page_image_renders(client):
    body = client.get("/api/manuscripts").json()
    if not body["count"]:
        pytest.skip("no manuscripts registered")
    ms_id = body["manuscripts"][0]["id"]
    thumb = client.get(f"/api/manuscript/{ms_id}/page/1/image", params={"width": 320})
    assert thumb.status_code == 200
    assert thumb.headers["content-type"] == "image/png"
    assert 1000 < len(thumb.content) < 900_000

    full = client.get(f"/api/manuscript/{ms_id}/page/1/image", params={"width": 1200})
    assert full.status_code == 200
    assert full.headers["content-type"] == "image/jpeg"
    # A tablet must not be sent a multi-megabyte plate for one page view.
    assert len(full.content) < 1_500_000

    # Byte size is not comparable across formats - a lossless thumbnail can
    # exceed a lossy full-size render - so scaling is checked between two
    # requests of the SAME format.
    bigger = client.get(f"/api/manuscript/{ms_id}/page/1/image", params={"width": 2400})
    assert bigger.headers["content-type"] == "image/jpeg"
    assert len(bigger.content) > len(full.content)


@needs_archive
def test_unapproved_ocr_text_is_not_searchable(client):
    """The rule the whole review loop exists to enforce."""
    with db.connect(readonly=True) as conn:
        row = conn.execute(
            """SELECT ocr_text FROM manuscript_pages
                WHERE review_status != 'approved' AND ocr_text IS NOT NULL
                  AND LENGTH(ocr_text) > 120 LIMIT 1""").fetchone()
    if row is None:
        pytest.skip("no unapproved page carries candidate text")

    phrase = " ".join(row["ocr_text"].split()[:8])
    with db.connect(readonly=True) as conn:
        hits = lexical.search(conn, phrase, limit=20)
        rows = lexical.hydrate(conn, [h.chunk_id for h in hits])
    for hit in hits:
        assert not rows[hit.chunk_id]["document_id"].startswith("ms-"), \
            "unapproved manuscript text reached the retrieval index"


@needs_archive
def test_ocr_then_approve_makes_a_page_searchable_and_reject_withdraws_it(client):
    """Full workflow on a real page: OCR -> review -> approve -> searchable
    -> reject -> withdrawn."""
    listing = client.get("/api/manuscripts").json()
    if not listing["count"]:
        pytest.skip("no manuscripts registered")
    ms_id = listing["manuscripts"][0]["id"]

    # A page whose companion text layer is substantial enough to search.
    with db.connect(readonly=True) as conn:
        row = conn.execute(
            """SELECT page FROM manuscript_pages
                WHERE manuscript_id = ? AND review_status = 'pending'
                  AND caption IS NOT NULL AND LENGTH(caption) > 120
                ORDER BY page LIMIT 1""", (ms_id,)).fetchone()
    if row is None:
        pytest.skip("no suitable pending page")
    page = row["page"]

    ocr = client.post("/api/ocr", json={"manuscript_id": ms_id, "page": page,
                                        "overwrite": True})
    if ocr.status_code == 503:
        pytest.skip("no OCR engine available on this machine")
    assert ocr.status_code == 200, ocr.text
    result = ocr.json()
    assert result["page"]["reviewStatus"] == "pending"
    assert result["page"]["searchable"] is False

    # A page with no engine score must not acquire one.
    if result["engine"] == "pdf_text_layer":
        assert result["confidence"] is None

    approved = client.post(f"/api/manuscript/{ms_id}/approve",
                           json={"page": page, "reviewer": "pytest"}).json()
    assert approved["indexed"] is True
    chunk_id = approved["chunkId"]

    try:
        with db.connect(readonly=True) as conn:
            stored = conn.execute("SELECT * FROM chunks WHERE id = ?", (chunk_id,)).fetchone()
        assert stored is not None
        assert stored["verification_status"] == "approved"
        assert stored["document_id"].startswith("ms-")

        phrase = " ".join((stored["text"] or "").split()[:8])
        with db.connect(readonly=True) as conn:
            hits = lexical.search(conn, phrase, limit=25)
        assert any(h.chunk_id == chunk_id for h in hits), \
            "approved manuscript text did not become searchable"
    finally:
        rejected = client.post(f"/api/manuscript/{ms_id}/reject",
                               json={"page": page, "reviewer": "pytest"}).json()
        assert rejected["withdrawn"] is True

    with db.connect(readonly=True) as conn:
        assert conn.execute("SELECT 1 FROM chunks WHERE id = ?", (chunk_id,)).fetchone() is None, \
            "rejected page remained in the index"


def test_tesseract_reports_unavailable_honestly():
    health = TesseractProvider().health()
    if not health.available:
        assert "not installed" in health.detail or "not runnable" in health.detail


def test_text_layer_provider_never_invents_confidence():
    from pathlib import Path
    pdf = config.REPO_ROOT / ("Data/SIH_heritage_docs/Books, Manuscripts & Archival "
                              "Papers/PR_000003009972.pdf")
    if not pdf.exists():
        pytest.skip("album PDF not present")
    result = TextLayerProvider(pdf).recognise(Path("PR_000003009972_0074.jp2"))
    assert result.ok
    assert result.confidence is None
    assert result.engine == "pdf_text_layer"


# ---------------------------------------------------------------------------
# timeline + entities (PS req 2, 9, 10)
# ---------------------------------------------------------------------------

@needs_archive
def test_timeline_events_are_ordered_and_dated(client):
    body = client.get("/api/timeline").json()
    if not body["count"]:
        pytest.skip("timeline not populated")
    years = [e["sortYear"] for e in body["events"]]
    assert years == sorted(years)
    for event in body["events"]:
        assert event["title"] and event["year"]


@needs_archive
def test_timeline_event_carries_sources(client):
    body = client.get("/api/timeline").json()
    if not body["count"]:
        pytest.skip("timeline not populated")
    detail = client.get(f"/api/timeline/{body['events'][0]['id']}").json()
    assert detail["event"]["id"]
    assert isinstance(detail["sources"], list)


@needs_archive
def test_unknown_timeline_event_returns_404(client):
    assert client.get("/api/timeline/tl-not-real").status_code == 404


@needs_archive
def test_entities_and_relations(client):
    body = client.get("/api/entities").json()
    if not body["count"]:
        pytest.skip("entities not populated")
    entity_id = body["entities"][0]["id"]

    detail = client.get(f"/api/entities/{entity_id}").json()
    assert detail["entity"]["name"]

    related = client.get(f"/api/entities/{entity_id}/related").json()
    for item in related["related"]:
        # A link must explain itself rather than assert a bare connection.
        assert item["sharedPassages"] >= 1
        assert "appears with" in item["reason"]


@needs_archive
def test_unknown_entity_returns_404(client):
    assert client.get("/api/entities/999999").status_code == 404


# ---------------------------------------------------------------------------
# media (PS req 8)
# ---------------------------------------------------------------------------

@needs_archive
def test_media_lists_assets_with_durations(client):
    body = client.get("/api/media").json()
    if not body["count"]:
        pytest.skip("no media registered")
    for item in body["media"]:
        assert item["type"] in ("audio", "video")
        assert "durationMs" in item


@needs_archive
def test_master_video_is_registered_but_not_servable(client):
    """The 950 MB master must never be streamed over the demo LAN."""
    items = client.get("/api/media").json()["media"]
    masters = [m for m in items if not m["servable"]]
    if not masters:
        pytest.skip("no unservable asset registered")
    master = masters[0]
    assert master["streamUrl"] is None
    assert master["unservableReason"]
    assert client.get(f"/api/media/{master['id']}/stream").status_code == 409


@needs_archive
def test_a_short_playable_video_excerpt_is_available(client):
    """The demonstration needs a video that actually plays.

    The master is 62 MB per minute and is deliberately refused, so a
    compressed excerpt stands in for it. It must be short enough to stream
    over the demonstration Wi-Fi and must declare its duration, or the
    player shows a control with nothing behind it.
    """
    items = client.get("/api/media").json()["media"]
    playable = [m for m in items
                if m["type"] == "video" and m["servable"] and m["streamUrl"]]
    if not playable:
        pytest.skip("no playable video registered")

    excerpt = next((m for m in playable if "excerpt" in m["id"]), None)
    if excerpt is None:
        pytest.skip("no excerpt registered")

    assert excerpt["durationMs"], "excerpt must declare its own duration"
    assert 120_000 <= excerpt["durationMs"] <= 420_000, (
        "the excerpt should be a few minutes, not the whole documentary")
    # Small enough that opening the page does not saturate the shared link.
    assert excerpt["byteSize"] < 80 * 1024 * 1024


@needs_archive
def test_excerpt_is_range_served_and_names_its_master(client):
    """Seeking needs byte ranges, and an excerpt must never be mistaken for
    the complete work: its provenance names the file it was cut from."""
    items = client.get("/api/media").json()["media"]
    excerpt = next((m for m in items if "excerpt" in m["id"] and m["servable"]), None)
    if excerpt is None:
        pytest.skip("no excerpt registered")

    head = client.get(f"/api/media/{excerpt['id']}/stream",
                      headers={"Range": "bytes=0-1023"})
    assert head.status_code == 206
    assert head.headers["accept-ranges"] == "bytes"
    assert head.headers["content-range"].startswith("bytes 0-1023/")

    # A seek lands mid-file, which is the request the player makes when the
    # viewer drags the scrubber.
    total = int(head.headers["content-range"].split("/")[1])
    mid = total // 2
    seek = client.get(f"/api/media/{excerpt['id']}/stream",
                      headers={"Range": f"bytes={mid}-{mid + 1023}"})
    assert seek.status_code == 206
    assert seek.headers["content-range"].startswith(f"bytes {mid}-")

    detail = client.get(f"/api/media/{excerpt['id']}").json()["media"]
    assert "BabasahebAmbedkar_Eng.mp4" in (detail["provenance"] or ""), (
        "the excerpt must name the master it was derived from")


@needs_archive
def test_transcript_absence_is_stated_not_faked(client):
    body = client.get("/api/media").json()
    if not body["count"]:
        pytest.skip("no media registered")
    transcript = client.get(f"/api/media/{body['media'][0]['id']}/transcript").json()
    if not transcript["available"]:
        assert transcript["text"] is None
        assert "not installed" in transcript["reason"]


@needs_archive
def test_unknown_media_returns_404(client):
    assert client.get("/api/media/no-such-media").status_code == 404


# ---------------------------------------------------------------------------
# translation (PS req 6)
# ---------------------------------------------------------------------------

def test_translation_degrades_to_english_when_unavailable(client):
    body = client.post("/api/translate", json={
        "text": "Caste is a division of labourers.",
        "source_language": "en", "target_language": "hi"}).json()
    if not body["ok"]:
        # No credentials: the ENGLISH text comes back, clearly labelled.
        assert body["text"] == "Caste is a division of labourers."
        assert body["translated"] is False
        assert body["notice"]


def test_same_language_is_a_passthrough(client):
    body = client.post("/api/translate", json={
        "text": "hello", "source_language": "en", "target_language": "en"}).json()
    assert body["ok"] and body["mode"] == "passthrough"
    assert body["translated"] is False


def test_unsupported_language_is_rejected(client):
    assert client.post("/api/translate", json={
        "text": "hello", "source_language": "en", "target_language": "zz"}).status_code == 422


def test_languages_endpoint_declares_canonical_language(client):
    body = client.get("/api/languages").json()
    assert body["canonicalRetrievalLanguage"] == "en"
    assert {l["code"] for l in body["languages"]} >= {"en", "hi", "mr", "kn", "ta"}


# ---------------------------------------------------------------------------
# summarize (PS req 4)
# ---------------------------------------------------------------------------

@needs_archive
def test_summarize_a_document_returns_cited_output(client):
    body = client.post("/api/summarize",
                       json={"document_id": _first_document(client)}).json()
    assert body["subject"]
    if body["ok"] and body["evidence"]:
        for ev in body["evidence"]:
            assert ev["documentId"] and ev["citation"]


def test_summarize_requires_a_subject(client):
    assert client.post("/api/summarize", json={}).status_code == 422


@needs_archive
def test_summarize_unknown_document_returns_404(client):
    assert client.post("/api/summarize",
                       json={"document_id": "nope"}).status_code == 404


# ---------------------------------------------------------------------------
# archivist workflow (PS req 14)
# ---------------------------------------------------------------------------

@needs_archive
def test_archivist_rejects_a_path_outside_the_data_directory(client):
    for bad in ("../../etc/passwd", "backend/app/main.py", "/etc/hosts"):
        r = client.post("/api/archivist/upload", json={"file_path": bad})
        assert r.status_code in (404, 422), bad


@needs_archive
def test_archivist_refuses_a_file_already_in_the_archive(client):
    with db.connect(readonly=True) as conn:
        row = conn.execute("SELECT file_path FROM documents LIMIT 1").fetchone()
    r = client.post("/api/archivist/upload", json={"file_path": row["file_path"]})
    assert r.status_code == 409


@needs_archive
def test_archivist_upload_registers_without_indexing(client):
    """Volume 3 was held back precisely for this path."""
    held = config.REPO_ROOT / "Data/SIH_heritage_docs/Volume3.pdf"
    if not held.exists():
        pytest.skip("held-back document not present")

    with db.connect(readonly=True) as conn:
        already = conn.execute(
            "SELECT 1 FROM documents WHERE file_path LIKE '%Volume3.pdf'").fetchone()
    if already:
        pytest.skip("held-back document has already been ingested")

    created = client.post("/api/archivist/upload", json={
        "file_path": "Data/SIH_heritage_docs/Volume3.pdf",
        "title": "Writings and Speeches, Volume 3 (pytest)",
        "submitted_by": "pytest"})
    assert created.status_code == 200, created.text
    item = created.json()["item"]
    item_id = item["id"]

    try:
        assert created.json()["indexed"] is False
        assert item["status"] == "pending_review"
        assert item["chunkEstimate"] > 0

        assert any(i["id"] == item_id for i in
                   client.get("/api/archivist/pending").json()["items"])

        # Nothing from it may be searchable while it waits.
        with db.connect(readonly=True) as conn:
            assert conn.execute(
                "SELECT 1 FROM documents WHERE file_path LIKE '%Volume3.pdf'"
            ).fetchone() is None

        patched = client.patch(f"/api/archivist/item/{item_id}",
                               json={"volume": "Vol. III"}).json()
        assert patched["item"]["metadata"]["volume"] == "Vol. III"
    finally:
        client.post(f"/api/archivist/item/{item_id}/reject",
                    json={"reviewer": "pytest", "note": "test cleanup"})

    assert client.get(f"/api/archivist/item/{item_id}").json()["item"]["status"] == "rejected"


@needs_archive
def test_unknown_intake_item_returns_404(client):
    assert client.get("/api/archivist/item/in-nope").status_code == 404


# ---------------------------------------------------------------------------
# health / capability discovery (PS req K)
# ---------------------------------------------------------------------------

@needs_archive
def test_health_capabilities_reflect_reality(client):
    body = client.get("/api/health").json()
    caps = body["capabilities"]
    for key in ("lexical_search", "semantic_search", "hybrid_retrieval", "reranking",
                "evidence_gate", "generation", "citation_validation", "ocr",
                "translation", "media", "archivist", "preservation", "timeline",
                "knowledge_mapping"):
        assert key in caps, f"missing capability flag {key}"
        assert isinstance(caps[key], bool)

    # A capability must not be claimed when nothing behind it works, and
    # the engine that would actually run must be named - so a text-layer
    # transcription is never mistaken for real OCR.
    subsystems = body["subsystems"]
    assert caps["ocr"] is subsystems["ocr"]["available"]
    assert subsystems["ocr"]["realOcrEngine"] is TesseractProvider().health().available
    if not subsystems["ocr"]["realOcrEngine"]:
        assert subsystems["ocr"]["tesseract"]["detail"]
    if not caps["translation"]:
        assert subsystems["translation"]["detail"]
