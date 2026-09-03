"""Register the demonstration excerpt of the Ambedkar documentary.

    python -m backend.ingest.register_media_excerpt --dry-run
    python -m backend.ingest.register_media_excerpt --apply

Why an excerpt exists
---------------------
The archival master is 950 MB of 8.7 Mbit/s H.264 - about 62 MB per minute.
Serving it over the demonstration Wi-Fi would saturate the link and stall
retrieval for everyone else on it, which is why the master record is marked
`servable = 0` and its reason has always said to serve a compressed excerpt
instead. This registers that excerpt.

What this does and does not do
------------------------------
It INSERTS one new media_assets row for the excerpt. It does not modify,
overwrite or delete the master row, and it does not touch a single byte of
the master file: the 950 MB MP4 remains exactly as ingested, still catalogued,
still carrying its own provenance and checksum.

The excerpt's provenance names the master and the exact timespan it was cut
from, so nothing here can be mistaken for the complete documentary. The
title says "archival excerpt" for the same reason.

Nothing is transcribed or captioned. The archive holds no transcript for this
recording, and the interface says so rather than inventing one.
"""

from __future__ import annotations

import argparse
import hashlib

from ..app.core import config, db

MASTER_ID = "doc-ambedkar-video-master"
EXCERPT_ID = "doc-ambedkar-video-excerpt"

REL_PATH = ("Data/SIH_heritage_docs/Documentaries _Archival VideoAudio/"
            "BabasahebAmbedkar_Eng_excerpt.mp4")

#: The cut, stated exactly, so the record cannot drift from the file.
START_MS = 0
DURATION_MS = 270_000          # 4 minutes 30 seconds


def sha256_of(path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    path = config.REPO_ROOT / REL_PATH
    if not path.exists():
        print(f"Excerpt not found: {path}")
        print("Create it first with ffmpeg, starting at 00:00 of the master.")
        return 1

    size = path.stat().st_size

    with db.connect(readonly=True) as conn:
        master = conn.execute(
            "SELECT * FROM media_assets WHERE id = ?", (MASTER_ID,)).fetchone()
        existing = conn.execute(
            "SELECT id FROM media_assets WHERE id = ?", (EXCERPT_ID,)).fetchone()

    if master is None:
        print(f"Master record {MASTER_ID!r} is missing; refusing to register an "
              "excerpt whose provenance cannot be anchored to it.")
        return 1

    mins, secs = divmod(DURATION_MS // 1000, 60)
    provenance = (
        f"Playback excerpt: first {mins}m {secs:02d}s (00:00-{mins:02d}:{secs:02d}) of "
        f"{path.parent.name}/BabasahebAmbedkar_Eng.mp4. "
        f"{master['provenance']} "
        "The archival master is retained unmodified and catalogued separately."
    )

    print(f"{'Would register' if args.dry_run else 'Registering'} {EXCERPT_ID}")
    print(f"  file       {REL_PATH}")
    print(f"  size       {size:,} bytes  (master: {master['byte_size']:,})")
    print(f"  duration   {mins}m {secs:02d}s  (master: {(master['duration_ms'] or 0)//60000}m)")
    print(f"  servable   yes")
    print(f"  provenance {provenance[:96]}...")
    if existing:
        print("  NOTE: a row with this id already exists and will be updated in place.")

    if args.dry_run:
        print("\nDry run: nothing was written.")
        return 0

    checksum = sha256_of(path)

    with db.connect() as conn:
        conn.execute(
            """INSERT INTO media_assets
                   (id, title, media_type, description, source, provenance,
                    file_path, thumbnail_path, duration_ms, byte_size, sha256,
                    licence, servable, unservable_reason)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,NULL)
               ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title, description=excluded.description,
                    provenance=excluded.provenance, file_path=excluded.file_path,
                    duration_ms=excluded.duration_ms, byte_size=excluded.byte_size,
                    sha256=excluded.sha256, servable=1, unservable_reason=NULL""",
            (
                EXCERPT_ID,
                f"{master['title']} (archival excerpt)",
                "video",
                (f"Opening {mins} minutes {secs:02d} seconds of the documentary on the "
                 f"life of Dr. B. R. Ambedkar, encoded for playback over the archive's "
                 f"local network. The complete master is held in the archive."),
                master["source"],
                provenance,
                REL_PATH,
                None,
                DURATION_MS,
                size,
                checksum,
                master["licence"],
            ),
        )
        db.log(conn, "register", EXCERPT_ID,
               f"playback excerpt registered from {MASTER_ID} "
               f"(00:00 +{DURATION_MS}ms, {size} bytes, sha256 {checksum[:16]})",
               actor="maintenance")
        conn.commit()

    print(f"\nRegistered. sha256 {checksum[:16]}...")
    print("The master row and the master file were not modified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
