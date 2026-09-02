-- ---------------------------------------------------------------------------
-- DAIC ARCHIVE - canonical archive schema
--
-- This database is THE single source of truth for the archive (PS req 17).
-- The old duplicate corpora (src/data/corpus.js, server/corpus.js) are
-- replaced by it; nothing else may hold archival content.
--
-- The full schema is created up front - including tables Phase 1 does not
-- populate yet - so later phases add rows, never migrations.
--
--   Phase 1 populates : documents, chunks, chunks_fts, ingest_log
--   Phase 2 populates : chunks.faiss_id
--   Phase 4 populates : entities, entity_links, timeline_events,
--                       timeline_sources
-- ---------------------------------------------------------------------------

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;


-- ---------------------------------------------------------------------------
-- documents - one row per real source file on disk
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
    id                  TEXT PRIMARY KEY,          -- stable slug, e.g. 'ws-vol-01'
    title               TEXT NOT NULL,
    author              TEXT,
    source              TEXT,                      -- publishing body / archive
    publisher           TEXT,
    volume              TEXT,                      -- 'Vol. I' etc, NULL if n/a
    date_text           TEXT,                      -- '1936', '1942-46' (as printed)
    language            TEXT NOT NULL DEFAULT 'en',
    doc_type            TEXT NOT NULL,             -- Writing|Speech|Debate|Manuscript|Photograph|Audio|Video

    -- provenance / preservation (PS req 12)
    file_path           TEXT NOT NULL,             -- repo-relative path into Data/
    sha256              TEXT NOT NULL,
    byte_size           INTEGER NOT NULL,
    page_count          INTEGER,
    extraction_method   TEXT NOT NULL,             -- text_layer|ocr|asr|manual
    licence             TEXT,                      -- filled by the licence register

    -- human-in-the-loop (PS req 14)
    verification_status TEXT NOT NULL DEFAULT 'approved'
                        CHECK (verification_status IN ('pending','in_review','approved','rejected')),
    approved_by         TEXT,
    approved_at         TEXT,

    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_type   ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_lang   ON documents(language);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(verification_status);


-- ---------------------------------------------------------------------------
-- chunks - the retrieval unit
--
-- id is an INTEGER PRIMARY KEY on purpose: it doubles as the FTS5 rowid and
-- as the FAISS vector id, so the three stores join without a mapping table.
-- uid is the stable human-readable handle used in citations and URLs.
--
-- Page anchors (page_start/page_end) and character offsets
-- (char_start/char_end) are mandatory for text: a citation must be able to
-- reach the exact passage on the exact page (PS req 3).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chunks (
    id              INTEGER PRIMARY KEY,           -- = faiss id, = chunks_fts rowid
    uid             TEXT NOT NULL UNIQUE,          -- 'ws-vol-01:p0042:c00'
    document_id     TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    seq             INTEGER NOT NULL,              -- order within the document

    text            TEXT NOT NULL,
    char_count      INTEGER NOT NULL,

    -- anchors back into the source.
    -- page_* is the 1-based PDF page (what the source viewer opens).
    -- printed_page_* is the number printed on the page (what a scholar
    -- cites). In Writings and Speeches Vol. I these differ by 14, so both
    -- are stored: one is needed to navigate, the other to cite.
    page_start          INTEGER,
    page_end            INTEGER,
    printed_page_start  INTEGER,
    printed_page_end    INTEGER,
    char_start          INTEGER,                   -- offset into document plain text
    char_end            INTEGER,

    -- The work within the volume, recovered from the running header
    -- (e.g. 'Annihilation of Caste'). Turns a citation from
    -- "Vol. I, p. 33" into "Vol. I - Annihilation of Caste, p. 33".
    section         TEXT,

    -- audio/video anchors (PS req 8); NULL for text
    media_start_ms  INTEGER,
    media_end_ms    INTEGER,

    language        TEXT NOT NULL DEFAULT 'en',

    -- 'body' is prose that can serve as evidence. 'toc' and 'listing' are
    -- navigation apparatus - tables of contents, indexes, the publisher's
    -- volume list. They stay in the archive (full-text access, PS req 3)
    -- but are excluded from retrieval: a table of contents names every
    -- work in the volume, so it matches almost any query and outranks the
    -- passage that actually answers it.
    chunk_kind      TEXT NOT NULL DEFAULT 'body'
                    CHECK (chunk_kind IN ('body','toc','listing')),

    -- genuine extraction confidence. NULL for a clean embedded text layer;
    -- a real engine score for OCR/ASR. Never populated with an invented value.
    confidence      REAL,

    verification_status TEXT NOT NULL DEFAULT 'approved'
                        CHECK (verification_status IN ('pending','in_review','approved','rejected')),

    faiss_id        INTEGER,                       -- set in Phase 2 (mirrors id)
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id, seq);
CREATE INDEX IF NOT EXISTS idx_chunks_page     ON chunks(document_id, page_start);
CREATE INDEX IF NOT EXISTS idx_chunks_status   ON chunks(verification_status);
CREATE INDEX IF NOT EXISTS idx_chunks_kind     ON chunks(chunk_kind);


-- ---------------------------------------------------------------------------
-- chunks_fts - FTS5 lexical half of hybrid retrieval (PS req 1)
--
-- External-content table over `chunks`, so the text is stored once. Porter
-- stemming makes 'labour'/'labourers' and 'right'/'rights' collide, which the
-- hand-written stemmer in the old browser engine was approximating.
-- ---------------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    text,
    content     = 'chunks',
    content_rowid = 'id',
    tokenize    = "porter unicode61 remove_diacritics 2"
);

-- Keep the FTS index in step with the base table.
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;


-- ---------------------------------------------------------------------------
-- ingest_log - append-only provenance trail (PS req 12)
--
-- This replaces the fabricated "version history" in the current archivist UI.
-- UPDATE and DELETE are blocked by trigger, so the trail cannot be rewritten.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingest_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL DEFAULT (datetime('now')),
    actor       TEXT NOT NULL DEFAULT 'system',
    action      TEXT NOT NULL,                     -- extract|chunk|index|approve|reject|edit|verify
    document_id TEXT,
    detail      TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingest_log_doc ON ingest_log(document_id, ts);

CREATE TRIGGER IF NOT EXISTS ingest_log_no_update
BEFORE UPDATE ON ingest_log BEGIN
    SELECT RAISE(ABORT, 'ingest_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS ingest_log_no_delete
BEFORE DELETE ON ingest_log BEGIN
    SELECT RAISE(ABORT, 'ingest_log is append-only');
END;


-- ---------------------------------------------------------------------------
-- entities / entity_links - knowledge mapping (PS req 2)
--
-- Replaces the hardcoded `related: []` array. A link carries a `relation`
-- label so the UI can say WHY two things are related.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL CHECK (kind IN ('person','work','event','place','theme','document','speech')),
    name        TEXT NOT NULL,
    description TEXT,
    UNIQUE (kind, name)
);

CREATE TABLE IF NOT EXISTS entity_links (
    entity_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    chunk_id    INTEGER NOT NULL REFERENCES chunks(id)   ON DELETE CASCADE,
    relation    TEXT,                              -- 'mentions', 'same event', 'same theme'
    weight      REAL NOT NULL DEFAULT 1.0,
    PRIMARY KEY (entity_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_links_chunk ON entity_links(chunk_id);


-- ---------------------------------------------------------------------------
-- timeline - interactive timeline + memorial storytelling (PS req 9, 10)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timeline_events (
    id          TEXT PRIMARY KEY,
    year_label  TEXT NOT NULL,                     -- '1942-46' as displayed
    sort_year   INTEGER NOT NULL,
    title       TEXT NOT NULL,
    tag         TEXT,                              -- Life|Movement|Speech|Writing|Debate
    detail      TEXT NOT NULL,
    image_path  TEXT,                              -- archival photograph
    seq         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS timeline_sources (
    event_id    TEXT NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
    chunk_id    INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    note        TEXT,
    PRIMARY KEY (event_id, chunk_id)
);


-- ---------------------------------------------------------------------------
-- schema_meta - version marker
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_meta (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_meta(key, value) VALUES ('schema_version', '1');
INSERT OR IGNORE INTO schema_meta(key, value) VALUES ('archive_name', 'DAIC ARCHIVE');


-- ===========================================================================
-- Phase 4 - frontend-integration surfaces
--
-- Added additively; nothing above this line changed. Every table here is
-- created IF NOT EXISTS so an existing archive upgrades in place without
-- losing the ingested corpus.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- manuscripts - scanned material with a human review loop (PS req 5, 15)
--
-- The hard rule this schema enforces: OCR text is NOT authoritative until a
-- human approves it. `review_status` gates whether a page may be indexed,
-- and the retrieval index only ever draws on approved rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manuscripts (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT,
    collection      TEXT,
    source          TEXT,
    source_path     TEXT,               -- repo-relative directory of originals
    paired_pdf      TEXT,               -- companion PDF, when one exists
    page_count      INTEGER NOT NULL DEFAULT 0,
    licence         TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS manuscript_pages (
    id              INTEGER PRIMARY KEY,
    manuscript_id   TEXT NOT NULL REFERENCES manuscripts(id) ON DELETE CASCADE,
    page            INTEGER NOT NULL,   -- 1-based
    source_image    TEXT NOT NULL,      -- original scan (JP2), repo-relative
    image_path      TEXT,               -- derived web image, repo-relative
    width           INTEGER,
    height          INTEGER,

    -- Candidate transcription awaiting review.
    ocr_text        TEXT,
    ocr_engine      TEXT,               -- which engine produced it, verbatim
    -- Real engine score only. NULL when the producing engine reports none;
    -- never populated with an estimate.
    ocr_confidence  REAL,
    caption         TEXT,               -- publisher's own caption, if present

    corrected_text  TEXT,               -- archivist's correction, if any
    review_status   TEXT NOT NULL DEFAULT 'pending'
                    CHECK (review_status IN ('pending','in_review','approved','rejected')),
    reviewer        TEXT,
    reviewed_at     TEXT,
    review_note     TEXT,
    chunk_id        INTEGER REFERENCES chunks(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (manuscript_id, page)
);

CREATE INDEX IF NOT EXISTS idx_mspage_status ON manuscript_pages(review_status);
CREATE INDEX IF NOT EXISTS idx_mspage_ms     ON manuscript_pages(manuscript_id, page);


-- ---------------------------------------------------------------------------
-- media - audio/video archive (PS req 8) with timestamped segments (PS req G)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_assets (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    media_type      TEXT NOT NULL CHECK (media_type IN ('audio','video')),
    description     TEXT,
    source          TEXT,
    provenance      TEXT,
    file_path       TEXT NOT NULL,      -- repo-relative
    thumbnail_path  TEXT,
    duration_ms     INTEGER,
    byte_size       INTEGER,
    sha256          TEXT,
    licence         TEXT,
    -- Whether this file may be streamed to a client. The 950 MB master is
    -- registered for provenance but must never be served over the demo LAN.
    servable        INTEGER NOT NULL DEFAULT 1,
    unservable_reason TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media_segments (
    id              INTEGER PRIMARY KEY,
    media_id        TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    seq             INTEGER NOT NULL,
    start_ms        INTEGER NOT NULL,
    end_ms          INTEGER NOT NULL,
    text            TEXT NOT NULL,
    speaker         TEXT,
    origin          TEXT NOT NULL,      -- 'asr' | 'manual'; never invented
    confidence      REAL,
    verification_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (verification_status IN ('pending','in_review','approved','rejected')),
    chunk_id        INTEGER REFERENCES chunks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_mediaseg ON media_segments(media_id, start_ms);


-- ---------------------------------------------------------------------------
-- intake - archivist upload -> review -> approve -> index (PS req 14)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intake_items (
    id              TEXT PRIMARY KEY,
    filename        TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    sha256          TEXT,
    byte_size       INTEGER,
    detected_type   TEXT,
    title           TEXT,
    metadata_json   TEXT,
    page_count      INTEGER,
    char_count      INTEGER,
    chunk_estimate  INTEGER,
    preview         TEXT,
    status          TEXT NOT NULL DEFAULT 'uploaded'
                    CHECK (status IN ('uploaded','extracting','pending_review',
                                      'approved','rejected','indexed','failed')),
    document_id     TEXT REFERENCES documents(id) ON DELETE SET NULL,
    submitted_by    TEXT,
    submitted_at    TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_by     TEXT,
    reviewed_at     TEXT,
    note            TEXT
);

CREATE INDEX IF NOT EXISTS idx_intake_status ON intake_items(status);
