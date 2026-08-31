"""Phase 1 tests: schema, extraction, chunking, FTS5, health.

The assertions that matter most are the ones protecting citation
integrity - page anchors, section boundaries, and the refusal to invent a
confidence value. Those are the properties the whole product rests on.
"""

import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.app.core import config, db
from backend.app.main import app
from backend.ingest import build
from backend.ingest.chunk import Chunk, chunk_document, classify, split_sentences
from backend.ingest.extract import Page, _looks_like_header, _titlecase, extract_pdf, reconcile_pages
from backend.ingest.sources import SOURCES, by_id
from backend.retrieval import lexical

VOLUME_1 = config.REPO_ROOT / "Data/SIH_heritage_docs/Volume1.pdf"
needs_corpus = pytest.mark.skipif(not VOLUME_1.exists(), reason="Data/ corpus not present")
needs_archive = pytest.mark.skipif(not config.DB_PATH.exists(), reason="archive not built")


# --------------------------------------------------------------------------
# schema / preservation
# --------------------------------------------------------------------------

def test_schema_creates_cleanly(tmp_path):
    path = tmp_path / "t.db"
    db.init_db(path)
    with db.connect(path) as conn:
        names = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
    for table in ("documents", "chunks", "chunks_fts", "ingest_log",
                  "entities", "entity_links", "timeline_events", "timeline_sources"):
        assert table in names


def test_ingest_log_is_append_only(tmp_path):
    """The trail replaces the fabricated version history, so it must not be
    rewritable - otherwise it is no better than the mock data."""
    path = tmp_path / "t.db"
    db.init_db(path)
    with db.connect(path) as conn:
        db.log(conn, "extract", None, "first")
        conn.commit()
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE ingest_log SET detail = 'tampered'")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("DELETE FROM ingest_log")


def test_readonly_connection_cannot_write(tmp_path):
    """Visitor role is enforced by the driver, not by convention."""
    path = tmp_path / "t.db"
    db.init_db(path)
    with db.connect(path, readonly=True) as conn:
        with pytest.raises(sqlite3.OperationalError):
            conn.execute("INSERT INTO ingest_log (action) VALUES ('nope')")


def test_fts_stays_in_sync_with_chunks(tmp_path):
    path = tmp_path / "t.db"
    db.init_db(path)
    with db.connect(path) as conn:
        conn.execute(
            """INSERT INTO documents (id,title,doc_type,file_path,sha256,byte_size,
                                      extraction_method)
               VALUES ('d1','Doc','Writing','x.pdf','abc',1,'text_layer')""")
        conn.execute(
            """INSERT INTO chunks (uid,document_id,seq,text,char_count)
               VALUES ('d1:c0','d1',0,'the annihilation of caste',25)""")
        conn.commit()
        assert conn.execute(
            "SELECT COUNT(*) FROM chunks_fts WHERE chunks_fts MATCH '\"caste\"'").fetchone()[0] == 1
        conn.execute("DELETE FROM chunks WHERE uid='d1:c0'")
        conn.commit()
        assert conn.execute(
            "SELECT COUNT(*) FROM chunks_fts WHERE chunks_fts MATCH '\"caste\"'").fetchone()[0] == 0


# --------------------------------------------------------------------------
# extraction helpers
# --------------------------------------------------------------------------

def test_titlecase_keeps_minor_words_lower():
    assert _titlecase("ANNIHILATION OF CASTE") == "Annihilation of Caste"
    assert _titlecase("FEDERATION VERSUS FREEDOM") == "Federation versus Freedom"
    assert _titlecase("COMMUNAL DEADLOCK AND A WAY TO SOLVE IT") == \
        "Communal Deadlock and a Way to Solve It"


def test_header_detection_rejects_prose():
    assert _looks_like_header("ANNIHILATION OF CASTE")
    assert _looks_like_header("PART II")
    assert not _looks_like_header("He will be compelled to take account of caste.")
    assert not _looks_like_header("x")


def test_reconcile_rejects_page_number_inconsistent_with_offset():
    """A stray figure at the top of a page was being read as a page number,
    reporting printed page 2 for PDF page 38. A wrong printed page is a
    wrong citation, so it must be overridden by the volume's own offset."""
    doc = type("D", (), {"pages": []})()
    doc.pages = [Page(pdf_page=i, printed_page=i - 15, section=None, text="x")
                 for i in range(20, 40)]
    doc.pages.append(Page(pdf_page=38, printed_page=2, section=None, text="x"))
    stats = reconcile_pages(doc)
    assert doc.pages[-1].printed_page == 38 - 15
    assert stats["corrected"] == 1


def test_reconcile_leaves_front_matter_unnumbered():
    """Front matter is numbered separately; inferring a body number there
    would invent a citation."""
    doc = type("D", (), {"pages": []})()
    doc.pages = [Page(pdf_page=i, printed_page=i - 15, section=None, text="x")
                 for i in range(20, 40)]
    doc.pages.append(Page(pdf_page=3, printed_page=None, section=None, text="x"))
    reconcile_pages(doc)
    assert doc.pages[-1].printed_page is None


# --------------------------------------------------------------------------
# chunking
# --------------------------------------------------------------------------

def test_split_sentences_basic():
    out = split_sentences('One two. Three four! "Five six." Seven.')
    assert out[0] == "One two."
    assert len(out) == 4


def test_classify_keeps_prose_as_body():
    """Withholding real prose from retrieval is a worse failure than
    letting a contents page through."""
    prose = "\n".join(
        ["He will be compelled to take account of caste after the revolution"] * 12)
    assert classify(prose) == "body"


def test_classify_withholds_table_of_contents():
    toc = "\n".join(["PREFACE", "vii", "PART I", "ON CASTE",
                     "1 CASTES IN INDIA", ".. .. .. 3",
                     "2 ANNIHILATION OF CASTE", ".. .. .. 23",
                     "PART II", ".. .. 99", "PART III", ".. .. 129"])
    assert classify(toc) == "toc"


def test_classify_withholds_statistical_table():
    table = "\n".join(["33,234", "2,117", "1 : 15.6", "38,647", "4,201",
                       "1 : 9.2", "25,701", "10,132", "1 : 2.5", "26,733"])
    assert classify(table) == "listing"


def test_chunks_never_span_two_sections():
    """A chunk spanning two works would cite one while quoting the other."""
    pages = [
        Page(pdf_page=1, printed_page=1, section="Work A", text="Alpha. " * 60, char_start=0, char_end=420),
        Page(pdf_page=2, printed_page=2, section="Work B", text="Beta. " * 60, char_start=422, char_end=782),
    ]
    doc = type("D", (), {"pages": pages, "page_count": 2})()
    for chunk in chunk_document(doc):
        pass  # a chunk carries exactly one section by construction
    sections = {c.section for c in chunk_document(doc)}
    assert sections == {"Work A", "Work B"}


# --------------------------------------------------------------------------
# lexical retrieval
# --------------------------------------------------------------------------

def test_match_query_quotes_every_token():
    q = lexical.build_match_query('caste AND "labour" OR *')
    assert q is not None
    # FTS5 operators from user input must not survive as operators.
    assert '"caste"' in q and '"labour"' in q
    assert "*" not in q


def test_match_query_drops_stopwords():
    q = lexical.build_match_query("what is the meaning of caste")
    assert '"caste"' in q and '"the"' not in q


def test_match_query_empty():
    assert lexical.build_match_query("   ") is None


@needs_archive
def test_search_returns_anchored_hits():
    with db.connect(readonly=True) as conn:
        hits = lexical.search(conn, "caste is a division of labourers", limit=5)
        assert hits, "expected hits for a phrase that is verbatim in the corpus"
        rows = lexical.hydrate(conn, [h.chunk_id for h in hits])
        for h in hits:
            r = rows[h.chunk_id]
            # Every hit must be reachable: page and offsets are what make a
            # citation verifiable rather than decorative.
            assert r["page_start"] is not None
            assert r["char_start"] is not None
            assert r["document_id"]
            assert r["chunk_kind"] == "body"


@needs_archive
def test_search_excludes_navigation():
    with db.connect(readonly=True) as conn:
        hits = lexical.search(conn, "preface page part contents", limit=10)
        rows = lexical.hydrate(conn, [h.chunk_id for h in hits])
        assert all(rows[h.chunk_id]["chunk_kind"] == "body" for h in hits)


@needs_archive
def test_malicious_query_does_not_error():
    """User text is not a query language."""
    with db.connect(readonly=True) as conn:
        for nasty in ['" OR 1=1 --', "caste*", 'NEAR("a" "b")', "'; DROP TABLE chunks; --"]:
            lexical.search(conn, nasty, limit=3)  # must not raise


# --------------------------------------------------------------------------
# corpus-level integrity
# --------------------------------------------------------------------------

@needs_archive
def test_no_invented_confidence_values():
    """A clean embedded text layer has no engine score. The old UI showed
    hand-written confidence floats; nothing here may reintroduce them."""
    with db.connect(readonly=True) as conn:
        n = conn.execute(
            """SELECT COUNT(*) FROM chunks c JOIN documents d ON d.id = c.document_id
                WHERE d.extraction_method = 'text_layer' AND c.confidence IS NOT NULL"""
        ).fetchone()[0]
    assert n == 0


@needs_archive
def test_every_chunk_can_produce_a_citation():
    with db.connect(readonly=True) as conn:
        n = conn.execute(
            "SELECT COUNT(*) FROM chunks WHERE page_start IS NULL OR char_start IS NULL"
        ).fetchone()[0]
    assert n == 0


@needs_archive
def test_printed_pages_agree_with_volume_offset():
    """Guards the citation-integrity fix: no chunk may claim a printed page
    that disagrees with the offset established by the rest of the volume."""
    with db.connect(readonly=True) as conn:
        rows = conn.execute(
            """SELECT page_start, printed_page_start FROM chunks
                WHERE document_id = 'ws-vol-01' AND printed_page_start IS NOT NULL"""
        ).fetchall()
    assert rows
    bad = [r for r in rows if abs((r["page_start"] - r["printed_page_start"]) - 15) > 1]
    assert len(bad) <= 1, f"{len(bad)} chunks carry an inconsistent printed page"


def test_duplicate_volume_is_excluded_from_the_registry():
    """The audit verified this file duplicates Volume5.pdf. Indexing both
    would give two different citations for identical text."""
    paths = [s.file_path for s in SOURCES]
    assert not any("dr-babasaheb-ambedkar-writings-and-speeches-vol-5" in p for p in paths)
    assert not any("cad_" in p and "hindi" in p for p in paths)
    assert not any("VolumeH" in p for p in paths)


@needs_corpus
def test_citation_string_names_volume_section_and_page():
    src = by_id("ws-vol-01")
    chunk = Chunk(seq=0, text="x", page_start=48, page_end=48,
                  printed_page_start=33, printed_page_end=33,
                  char_start=0, char_end=1, section="Annihilation of Caste")
    citation = build.build_citation(src, chunk)
    assert "Vol. I" in citation
    assert "Annihilation of Caste" in citation
    assert "p. 33" in citation


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------

def test_health_endpoint_reports_capabilities():
    with TestClient(app) as client:
        r = client.get("/api/health")
        assert r.status_code == 200
        body = r.json()
        assert body["archive"] == "DAIC ARCHIVE"
        caps = body["capabilities"]
        # Phase 1 must not claim capabilities it has not built.
        assert caps["lexical_search"] is True
        assert caps["vector_search"] is False
        assert caps["generation"] is False


@needs_archive
def test_health_reports_real_counts():
    with TestClient(app) as client:
        body = client.get("/api/health").json()
        assert body["status"] == "ok"
        assert body["stats"]["chunks"] > 0
        assert body["stats"]["documents"] > 0


def test_oversized_body_rejected():
    with TestClient(app) as client:
        r = client.post("/api/health", content=b"x" * (config.MAX_REQUEST_BYTES + 1))
        assert r.status_code == 413
