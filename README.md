# DAIC ARCHIVE
## Digital Heritage Archive for Memorials, Manuscripts & Ambedkar

DAIC ARCHIVE is an AI-powered institutional heritage archive prototype designed to preserve, organise and improve access to historical materials through verified archival content, semantic discovery, evidence-grounded research and multilingual access.

**Team:** CortexEdge

**Event:** Smart India Hackathon (SIH) 2026 - Internal Hackathon Prototype

DAIC ARCHIVE is developed as an internal hackathon prototype for SIH 2026 by Team CortexEdge. It is not presented as a production-deployed government or institutional system.

## 1. Overview

Historical manuscripts, writings, speeches, photographs and audio-visual material are often fragmented across sources and difficult to search, verify and explore together. Digital preservation needs more than a document viewer: it needs structured metadata, durable source references and a clear path from a discovery result back to the archival material.

DAIC ARCHIVE combines a canonical archive, document ingestion, full-text reading, semantic discovery and evidence-grounded assistance. Retrieval is constrained by approved source records and page or media anchors so that archival research can distinguish a supported answer from an unsupported one.

## 2. Key Features

- Hybrid semantic and lexical search
- FAISS dense retrieval with SQLite FTS5 lexical search
- Reciprocal Rank Fusion (RRF)
- Cross-encoder reranking of the fused candidate set
- Evidence Gate for relevance, query coverage and provenance
- Citation and provenance validation
- Extractive fallback using verbatim archival passages
- PDF text extraction and Tesseract OCR integration for manuscript workflows
- Archivist intake, metadata editing, review and approval before indexing
- Full-text archival reading with page-level references
- Manuscript viewing and review status tracking
- Interactive timeline and heritage storytelling views
- Audio-visual archive views
- Multilingual interface and translation layer, with an external translation provider when configured
- Browser Speech Synthesis read-aloud support
- LAN-ready laptop, tablet and kiosk-oriented prototype operation

## 3. Problem & Motivation

Historical material is valuable but frequently hard to locate across collections, formats and languages. Search results without reliable provenance can also make archival research difficult to verify.

The project addresses this gap by combining preservation workflows, structured metadata, OCR and hybrid retrieval in an archive-first interface. Evidence selection, page references and explicit verification status help keep access connected to the source record.

## 4. System Architecture

```text
Heritage Sources
	-> Ingestion & OCR
	-> Human Validation & Metadata
	-> Canonical Archive
	-> FAISS + SQLite FTS5
	-> Reciprocal Rank Fusion
	-> Top-K Retrieval
	-> Cross-Encoder Reranking
	-> Evidence Gate
	-> Grounded Answer / Extractive Fallback
	-> Citation Validation
	-> Web / Tablet / Kiosk Experience
```

Source files are extracted into the canonical archive with metadata and provenance records. Approved body chunks are available to dense and lexical retrieval. The API returns evidence with source anchors for the React client; archivist approval is the route into the searchable archive.

## 5. AI & Retrieval Approach

The system follows a provenance-aware hybrid RAG approach in which retrieved archival evidence is reranked and checked through an evidence gate before being used for answering.

1. The query is processed by the API and used for both retrieval paths.
2. Dense semantic retrieval searches the FAISS index using `BAAI/bge-small-en-v1.5` embeddings.
3. Lexical retrieval searches SQLite FTS5, including its BM25 ranking function.
4. RRF combines the two rankings without treating their scores as interchangeable.
5. The fused list is limited to 20 candidates.
6. `cross-encoder/ms-marco-MiniLM-L-6-v2` reranks those candidates.
7. The top 3-5 passages are selected as evidence; the current default is 4.
8. The Evidence Gate checks relevance, query coverage and provenance before answering.
9. The default provider returns extractive text from the evidence. A configured server-side generator may produce a grounded answer, with extractive fallback available when generation is unavailable or insufficient.
10. Citation validation checks that generated citations resolve to retrieved, anchored and approved evidence.

The operating priority is verified archive evidence rather than unsupported generation.

## 6. Archival Preservation & Trust

The archive records human validation, metadata, provenance, source references, page-level references, verification status and preserved archival text. Raw source content remains distinct from presentation-level corrections where applicable. Uploaded material is extracted for review but is not searchable until approved.

## 7. Technology Stack

**Frontend**

- React 19
- Vite
- Tailwind CSS and project CSS
- Lucide React
- Web App Manifest and PWA-oriented kiosk metadata

**Backend**

- Python
- FastAPI and Uvicorn
- Pydantic
- PyMuPDF for PDF extraction

**AI / Retrieval**

- FAISS
- SQLite FTS5 with BM25 ranking
- Sentence Transformers with `BAAI/bge-small-en-v1.5` embeddings
- Sentence Transformers CrossEncoder with `cross-encoder/ms-marco-MiniLM-L-6-v2`

**Storage**

- SQLite canonical archive and metadata records
- Canonical archival files under `Data/`
- FAISS index and local model artifacts under `backend/archive/`

**Other**

- Tesseract OCR provider integration, when the Tesseract executable is installed
- Browser Web Speech API for read-aloud narration
- Translation provider interface with optional Bhashini connectivity

## 8. Deployment / Prototype Setup

The prototype runs as a FastAPI edge server on a laptop or local server and a Vite development client during development. The backend binds to `0.0.0.0:8000`; Vite binds to `5180` and proxies `/api` to the backend. The server prints LAN addresses so a tablet or kiosk on the same network can use the archive.

Some translation capabilities require configured credentials and network access. The current implementation is an internal hackathon prototype and is not presented as a production deployment. The archive and retrieval components can run from local files and cached model artifacts, subject to the installed dependencies and available corpus.

### Setup

```bash
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
npm install
```

Build or refresh the local archive when the source corpus is available:

```bash
backend/.venv/Scripts/python.exe -m backend.ingest.build --rebuild
backend/.venv/Scripts/python.exe -m backend.ingest.build_index
```

Run the backend and frontend in separate terminals:

```bash
backend/.venv/Scripts/python.exe -m backend.run
npm run dev
```

Useful checks:

```bash
backend/.venv/Scripts/python.exe -m pytest backend/tests -q
npm test
npm run build
```

The backend API health endpoint is `/api/health`, and the OpenAPI documentation is available at `/api/docs` while the backend is running.

## 9. Project Structure

```text
DAIC-archive/
├── backend/                 # FastAPI server, ingestion, OCR and retrieval
├── Data/                    # Local heritage source corpus
├── public/                  # Manifest, fonts and public assets
├── src/                     # React application, views, data and tests
├── index.html
├── package.json
├── README.md
└── LICENSE
```

## 10. Team

Developed by Team CortexEdge:
- Ranjith Kumar G
- Dhruthi Sharath Kumar
- Sangeeta G
- Harshinee
- Chethana
- Mohammad Abrar

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
