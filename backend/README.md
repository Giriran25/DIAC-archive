# DAIC ARCHIVE — edge server

The laptop half of the Round 2 architecture. The tablet is a thin client:
the archive, database, retrieval, embeddings, generation and ingestion all
live here, and no secret is ever sent to the browser.

**Phase 1 (current):** extraction → SQLite → FTS5 lexical search.
FAISS, the evidence gate and the LLM provider arrive in Phases 2–3.

## Setup

```bash
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
```

## Build the archive

Reads the real PDFs in `Data/` and populates `backend/archive/daic.db`.
Safe to re-run; each document is replaced atomically.

```bash
backend/.venv/Scripts/python.exe -m backend.ingest.build --only ws-vol-01
backend/.venv/Scripts/python.exe -m backend.ingest.build --rebuild      # from scratch
backend/.venv/Scripts/python.exe -m backend.ingest.build --phase 2      # all Phase 2 sources
```

`Data/` and `backend/archive/` are untracked. Source files are referenced by
SHA-256 in the `documents` table rather than committed.

## Run

```bash
backend/.venv/Scripts/python.exe -m backend.run
```

Binds `0.0.0.0:8000` and prints the LAN addresses the tablet can use.
**The tablet must use the laptop's LAN IP, never `localhost`.**

- `http://<laptop-ip>:8000/api/health` — readiness and canonical counts
- `http://<laptop-ip>:8000/api/docs` — OpenAPI browser

## Tests

```bash
backend/.venv/Scripts/python.exe -m pytest backend/tests -q
```

Tests that touch `Data/` or the built archive skip automatically when
absent, so the suite runs on a fresh clone.

## Notes for whoever touches this next

- `chunks.id` is the FTS5 rowid **and** the FAISS vector id. Keep it that way;
  it is why the three stores join without a mapping table.
- `page_start` is the PDF page (what the viewer opens). `printed_page_start`
  is the number printed on the page (what a citation quotes). They differ —
  by 15 in Volume 1 — so never substitute one for the other.
- `confidence` stays `NULL` for a clean text layer. It is only ever a real
  engine score. Do not reintroduce hand-written values.
- `chunk_kind` withholds tables of contents and statistical appendices from
  retrieval while keeping them in the archive for full-text access.
- `ingest_log` is append-only, enforced by trigger.
