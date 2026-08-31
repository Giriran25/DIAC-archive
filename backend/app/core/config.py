"""Runtime configuration for the DAIC ARCHIVE edge server.

Every value is overridable by environment variable so the laptop can be
reconfigured for the venue without editing code. Secrets live here and in
the process environment only - never in the React bundle.
"""

import os
from pathlib import Path

# backend/app/core/config.py -> backend/app/core -> backend/app -> backend -> repo root
BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent

# The heritage corpus. Untracked by git; referenced by checksum.
DATA_DIR = Path(os.getenv("DAIC_DATA_DIR", REPO_ROOT / "Data" / "SIH_heritage_docs"))

# Generated artifacts: SQLite DB, FAISS index, derived page images.
ARCHIVE_DIR = Path(os.getenv("DAIC_ARCHIVE_DIR", BACKEND_DIR / "archive"))
DB_PATH = Path(os.getenv("DAIC_DB_PATH", ARCHIVE_DIR / "daic.db"))
SCHEMA_PATH = BACKEND_DIR / "app" / "core" / "schema.sql"

# LAN binding. 0.0.0.0 so the tablet can reach the laptop over Wi-Fi;
# the tablet must use the laptop's LAN IP, never localhost.
HOST = os.getenv("DAIC_HOST", "0.0.0.0")
PORT = int(os.getenv("DAIC_PORT", "8000"))

# CORS: the Vite dev server during development. In the built kiosk
# deployment FastAPI serves the bundle itself and this is not used.
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("DAIC_CORS_ORIGINS", "http://localhost:5180,http://127.0.0.1:5180").split(",")
    if o.strip()
]
# Allow any private-LAN origin on the dev port (tablet hitting the Vite server).
CORS_ORIGIN_REGEX = os.getenv(
    "DAIC_CORS_ORIGIN_REGEX",
    r"^http://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):(5180|4173|8000)$",
)

# Request hardening
MAX_REQUEST_BYTES = int(os.getenv("DAIC_MAX_REQUEST_BYTES", str(64 * 1024)))
MAX_QUESTION_CHARS = int(os.getenv("DAIC_MAX_QUESTION_CHARS", "500"))

# Chunking. ~1200 chars keeps a chunk inside one or two printed pages, so a
# citation stays precise; 180 chars of overlap stops a sentence that straddles
# a boundary from being lost to both neighbours.
CHUNK_TARGET_CHARS = int(os.getenv("DAIC_CHUNK_CHARS", "1200"))
CHUNK_OVERLAP_CHARS = int(os.getenv("DAIC_CHUNK_OVERLAP", "180"))
CHUNK_MIN_CHARS = int(os.getenv("DAIC_CHUNK_MIN", "220"))

ARCHIVE_NAME = "DAIC ARCHIVE"
