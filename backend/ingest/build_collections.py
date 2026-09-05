"""Populate manuscripts, media, timeline and entities from the real assets.

    python -m backend.ingest.build_collections

Everything written here is DERIVED from material already in Data/ or
already in the archive. Nothing is authored:

  * manuscript pages  - the 102 JP2 plates; their captions and candidate
                        text come from the album's own companion PDF
  * media             - the documentary files, with durations parsed from
                        the containers themselves
  * timeline          - built only from plate captions that state a date,
                        using the caption text verbatim
  * entities          - works are the section headings the volumes print;
                        people and places are only created when the name
                        actually occurs in indexed text, and are linked
                        only to the passages where it occurs

Where a fact is not available it is left NULL. No confidence value, no
transcript and no provenance is ever invented.
"""

from __future__ import annotations

import hashlib
import json
import re
import struct
from pathlib import Path

from ..app.core import config, db

DATA = config.REPO_ROOT / "Data" / "SIH_heritage_docs"
ALBUM_DIR = DATA / "Books, Manuscripts & Archival Papers"
JP2_DIR = ALBUM_DIR / "PR_000003009972_jp2" / "PR_000003009972_jp2"
ALBUM_PDF = ALBUM_DIR / "PR_000003009972.pdf"
AV_DIR = DATA / "Documentaries _Archival VideoAudio"

MANUSCRIPT_ID = "daic-album-01"


def rel(path: Path) -> str:
    return str(path.relative_to(config.REPO_ROOT)).replace("\\", "/")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# manuscripts
# ---------------------------------------------------------------------------

def build_manuscripts(conn) -> int:
    if not JP2_DIR.exists():
        print("  JP2 plates not present - skipping manuscripts")
        return 0

    import fitz

    plates = sorted(JP2_DIR.glob("*.jp2"))
    pdf = fitz.open(ALBUM_PDF) if ALBUM_PDF.exists() else None

    conn.execute(
        """INSERT OR REPLACE INTO manuscripts
             (id, title, description, collection, source, source_path, paired_pdf,
              page_count, licence)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (MANUSCRIPT_ID,
         "Dr. Babasaheb Ambedkar - archival plates album",
         "Facsimile plates of letters, certificates, newspapers and photographs "
         "from the Ambedkar archive, scanned at 2000-5100 px.",
         "Books, Manuscripts & Archival Papers",
         "DAIC heritage corpus (PR_000003009972)",
         rel(JP2_DIR),
         rel(ALBUM_PDF) if ALBUM_PDF.exists() else None,
         len(plates),
         "Compilation rights unverified - see the licence register before "
         "public deployment. Underlying documents are historical facsimiles."))

    written = 0
    for plate in plates:
        index = int(re.search(r"(\d{4})\.jp2$", plate.name).group(1))
        page = index + 1                       # 1-based for the API

        caption = None
        if pdf is not None and 0 <= index < pdf.page_count:
            text = re.sub(r"\s+", " ", pdf[index].get_text().strip())
            # A caption is the short descriptive line the album prints under
            # a plate. Longer blocks are the plate's own text, not a caption.
            if 30 <= len(text) <= 700:
                caption = text

        existing = conn.execute(
            "SELECT review_status FROM manuscript_pages WHERE manuscript_id=? AND page=?",
            (MANUSCRIPT_ID, page)).fetchone()
        if existing and existing["review_status"] in ("approved", "in_review", "rejected"):
            continue                            # never overwrite a human decision

        conn.execute(
            """INSERT INTO manuscript_pages
                 (manuscript_id, page, source_image, caption, review_status)
               VALUES (?,?,?,?, 'pending')
               ON CONFLICT(manuscript_id, page) DO UPDATE SET
                 source_image = excluded.source_image,
                 caption      = excluded.caption""",
            (MANUSCRIPT_ID, page, rel(plate), caption))
        written += 1

    if pdf is not None:
        pdf.close()
    print(f"  manuscripts: 1 album, {written} pages registered (all pending review)")
    return written


# The plates selected in the data audit for the OCR demonstration, chosen
# to span a real difficulty gradient: printed English, typed forms,
# Devanagari newspapers, and handwriting. Stored 0-based as they appear in
# the filenames; the API is 1-based.
OCR_DEMO_PLATES = [74, 24, 35, 66, 28, 42, 47, 58, 1, 44]


def seed_ocr_candidates(conn) -> int:
    """Run the available OCR engine over the demo plates so the review
    queue holds real candidate text.

    This produces CANDIDATES only. Every page stays `pending`; nothing here
    becomes authoritative or searchable without a human approving it.
    """
    from ..ocr import get_ocr_provider

    provider = get_ocr_provider(ALBUM_PDF if ALBUM_PDF.exists() else None)
    if not provider.health().available:
        print("  ocr: no engine available - pages left without candidate text")
        return 0

    done = 0
    for index in OCR_DEMO_PLATES:
        page = index + 1
        row = conn.execute(
            "SELECT source_image, review_status FROM manuscript_pages "
            "WHERE manuscript_id = ? AND page = ?", (MANUSCRIPT_ID, page)).fetchone()
        if row is None or row["review_status"] == "approved":
            continue
        result = provider.recognise(config.REPO_ROOT / row["source_image"])
        if not result.ok:
            continue
        conn.execute(
            """UPDATE manuscript_pages
                  SET ocr_text = ?, ocr_engine = ?, ocr_confidence = ?
                WHERE manuscript_id = ? AND page = ?""",
            (result.text, result.engine, result.confidence, MANUSCRIPT_ID, page))
        done += 1

    print(f"  ocr: {done} demo plates have candidate text via {provider.name()} "
          f"(all still pending review)")
    return done


# ---------------------------------------------------------------------------
# media
# ---------------------------------------------------------------------------

def _mp3_duration_ms(path: Path) -> int | None:
    """Duration from the frame headers. No ffprobe on this machine."""
    bitrates = {3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]}
    rates = {0: 44100, 1: 48000, 2: 32000}
    try:
        size = path.stat().st_size
        with path.open("rb") as handle:
            head = handle.read(10)
            offset = 0
            if head[:3] == b"ID3":
                offset = 10 + (((head[6] & 0x7F) << 21) | ((head[7] & 0x7F) << 14)
                               | ((head[8] & 0x7F) << 7) | (head[9] & 0x7F))
            handle.seek(offset)
            frames = total = 0
            while frames < 40000:
                block = handle.read(4)
                if len(block) < 4:
                    break
                if block[0] == 0xFF and (block[1] & 0xE0) == 0xE0:
                    layer = {3: 1, 2: 2, 1: 3}.get((block[1] >> 1) & 3)
                    bi, si, pad = (block[2] >> 4) & 0xF, (block[2] >> 2) & 3, (block[2] >> 1) & 1
                    if layer != 3 or bi in (0, 15) or si == 3:
                        handle.seek(-3, 1)
                        continue
                    rate = bitrates[3][bi]
                    frames += 1
                    total += rate
                    handle.seek(int(144000 * rate / rates[si]) + pad - 4, 1)
                else:
                    handle.seek(-3, 1)
            if not frames:
                return None
            average = total / frames
            return int((size * 8) / average)
    except Exception:
        return None


def _mp4_duration_ms(path: Path) -> int | None:
    """Duration from the mvhd atom."""
    try:
        with path.open("rb") as handle:
            end = path.stat().st_size

            def walk(limit):
                while handle.tell() < limit:
                    start = handle.tell()
                    header = handle.read(8)
                    if len(header) < 8:
                        return None
                    size = struct.unpack(">I", header[:4])[0]
                    kind = header[4:8]
                    if size == 1:
                        size = struct.unpack(">Q", handle.read(8))[0]
                    if size < 8:
                        return None
                    if kind == b"moov":
                        found = walk(start + size)
                        if found:
                            return found
                        handle.seek(start + size)
                    elif kind == b"mvhd":
                        data = handle.read(size - 8)
                        if data[0] == 1:
                            scale = struct.unpack(">I", data[20:24])[0]
                            duration = struct.unpack(">Q", data[24:32])[0]
                        else:
                            scale = struct.unpack(">I", data[12:16])[0]
                            duration = struct.unpack(">I", data[16:20])[0]
                        return int(duration / scale * 1000) if scale else None
                    else:
                        handle.seek(start + size)
                return None

            return walk(end)
    except Exception:
        return None


# The Internet Archive item the A/V came from - recovered from the torrent
# file shipped alongside it, not assumed.
AV_PROVENANCE = ("Internet Archive item dli.MoI.BabasahebAmbedkar_Eng "
                 "(Digital Library of India / Ministry of Information)")


def build_media(conn) -> int:
    if not AV_DIR.exists():
        print("  A/V directory not present - skipping media")
        return 0

    written = 0
    for path, media_id, kind, servable, reason in (
        (AV_DIR / "BabasahebAmbedkar_Eng.mp3", "doc-ambedkar-audio", "audio", 1, None),
        (AV_DIR / "BabasahebAmbedkar_Eng.ogv", "doc-ambedkar-video-ogv", "video", 1, None),
        (AV_DIR / "BabasahebAmbedkar_Eng.mp4", "doc-ambedkar-video-master", "video", 0,
         "Master encode, 62 MB per minute. Streaming it would saturate the demo "
         "LAN and stall retrieval. Registered for provenance; serve a compressed "
         "excerpt instead."),
    ):
        if not path.exists():
            continue
        duration = (_mp3_duration_ms(path) if path.suffix == ".mp3"
                    else _mp4_duration_ms(path) if path.suffix == ".mp4" else None)
        conn.execute(
            """INSERT OR REPLACE INTO media_assets
                 (id, title, media_type, description, source, provenance, file_path,
                  duration_ms, byte_size, sha256, licence, servable, unservable_reason)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (media_id,
             "Babasaheb Ambedkar - documentary",
             kind,
             "Documentary on the life of Dr. B. R. Ambedkar.",
             "Digital Library of India / Ministry of Information",
             AV_PROVENANCE,
             rel(path),
             duration,
             path.stat().st_size,
             sha256(path) if path.stat().st_size < 200_000_000 else None,
             "Government of India documentary via the Internet Archive; "
             "confirm terms before public deployment.",
             servable, reason))
        written += 1

    print(f"  media: {written} assets registered (no transcripts - no ASR engine installed)")
    return written


# ---------------------------------------------------------------------------
# timeline - only from captions that actually state a date
# ---------------------------------------------------------------------------

MONTHS = ("January February March April May June July August September "
          "October November December").split()
DATE_RE = re.compile(
    r"\b(\d{1,2})\s+(" + "|".join(MONTHS) + r")\s+(19\d{2})\b", re.IGNORECASE)
YEAR_RE = re.compile(r"\b(19[0-5]\d)\b")


def build_timeline(conn) -> int:
    rows = conn.execute(
        """SELECT page, caption FROM manuscript_pages
            WHERE manuscript_id = ? AND caption IS NOT NULL ORDER BY page""",
        (MANUSCRIPT_ID,)).fetchall()

    events, seen_years = [], set()
    for row in rows:
        caption = row["caption"]
        # A caption qualifies only if it carries a full date; a bare year is
        # too weak to anchor an event on.
        match = DATE_RE.search(caption)
        if not match:
            continue
        day, month, year = match.group(1), match.group(2).title(), int(match.group(3))
        if year in seen_years:
            continue                     # one event per year keeps the rail readable
        seen_years.add(year)

        # The title is the caption's opening clause, verbatim.
        title = re.split(r"(?<=[a-z])\.\s|\s-\s", caption.strip())[0]
        title = re.sub(r"^\W*\d+\s*", "", title).strip()
        events.append({
            "id": f"tl-{year}-p{row['page']:03d}",
            "year": year,
            "date_text": f"{day} {month} {year}",
            "title": title[:160],
            "detail": caption,
            "page": row["page"],
        })

    events.sort(key=lambda e: e["year"])
    for seq, event in enumerate(events):
        conn.execute(
            """INSERT OR REPLACE INTO timeline_events
                 (id, year_label, sort_year, title, tag, detail, image_path, seq,
                  location, category, date_text, summary)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (event["id"], str(event["year"]), event["year"], event["title"],
             "Archive", event["detail"],
             f"/api/manuscript/{MANUSCRIPT_ID}/page/{event['page']}/image",
             seq, None, "Archive plate", event["date_text"], event["title"][:200]))

    print(f"  timeline: {len(events)} events, each from a dated plate caption")
    return len(events)


# ---------------------------------------------------------------------------
# entities - derived, never authored
# ---------------------------------------------------------------------------

# Names to look for. Each is checked against the indexed text and is only
# created if it genuinely occurs; a name that appears nowhere is dropped.
CANDIDATES = [
    ("person", "B. R. Ambedkar", ["Ambedkar"]),
    ("person", "M. K. Gandhi", ["Gandhi", "Mahatma Gandhi"]),
    ("person", "M. A. Jinnah", ["Jinnah"]),
    ("person", "M. G. Ranade", ["Ranade"]),
    ("person", "Ramabai Ambedkar", ["Ramabai"]),
    ("event", "Round Table Conference", ["Round Table Conference"]),
    ("event", "Simon Commission", ["Simon Commission"]),
    ("event", "Southborough Committee", ["Southborough"]),
    ("event", "Poona Pact", ["Poona Pact"]),
    ("event", "Mahad Satyagraha", ["Mahad"]),
    ("place", "Bombay", ["Bombay"]),
    ("place", "Nagpur", ["Nagpur"]),
    ("place", "Maharashtra", ["Maharashtra"]),
    ("place", "London", ["London"]),
    ("theme", "Caste", ["caste"]),
    ("theme", "Untouchability", ["untouchab"]),
    ("theme", "Labour", ["labour"]),
    ("theme", "Constitution", ["constitution"]),
    ("theme", "Depressed Classes", ["Depressed Classes"]),
    ("theme", "Linguistic States", ["linguistic"]),
]

MIN_MENTIONS = 3


def _upsert_entity(conn, kind: str, name: str, description: str) -> int:
    """Insert if absent, then read the id back.

    `cursor.lastrowid` is not safe here: when INSERT OR IGNORE skips a row
    it keeps the rowid of whatever was inserted last - which, mid-loop, is
    a row in another table entirely. Reading the id back is the only
    reliable way.
    """
    conn.execute(
        "INSERT OR IGNORE INTO entities (kind, name, description) VALUES (?,?,?)",
        (kind, name, description))
    row = conn.execute(
        "SELECT id FROM entities WHERE kind = ? AND name = ?", (kind, name)).fetchone()
    if row is None:
        # INSERT OR IGNORE swallows CHECK violations, so a rejected `kind`
        # would otherwise vanish without a trace.
        raise ValueError(f"entity kind {kind!r} was rejected by the schema")
    return row["id"]


def build_entities(conn) -> int:
    conn.execute("DELETE FROM entity_links")
    conn.execute("DELETE FROM entities")

    created = 0

    # Works: the section headings the volumes themselves print.
    for row in conn.execute(
        """SELECT section, document_id, COUNT(*) n FROM chunks
            WHERE chunk_kind='body' AND section IS NOT NULL
            GROUP BY section HAVING n >= 5 ORDER BY section"""
    ).fetchall():
        entity_id = _upsert_entity(
            conn, "work", row["section"],
            f"Work or section in the archive ({row['n']} passages)")
        conn.execute(
            """INSERT OR IGNORE INTO entity_links (entity_id, chunk_id, relation, weight)
               SELECT ?, id, 'section', 1.0 FROM chunks
                WHERE section = ? AND chunk_kind='body'""",
            (entity_id, row["section"]))
        created += 1

    # People, events, places, themes: only where the name actually occurs.
    for kind, name, needles in CANDIDATES:
        clause = " OR ".join("LOWER(text) LIKE ?" for _ in needles)
        params = [f"%{n.lower()}%" for n in needles]
        matches = conn.execute(
            f"SELECT id FROM chunks WHERE chunk_kind='body' AND ({clause}) LIMIT 400",
            params).fetchall()
        if len(matches) < MIN_MENTIONS:
            continue
        entity_id = _upsert_entity(
            conn, kind, name, f"Occurs in {len(matches)} indexed passages")
        conn.executemany(
            "INSERT OR IGNORE INTO entity_links (entity_id, chunk_id, relation, weight) "
            "VALUES (?,?,'mentions',1.0)",
            [(entity_id, m["id"]) for m in matches])
        created += 1

    # Timeline events are NOT linked to passages here.
    #
    # This used to run:
    #
    #     SELECT id FROM chunks WHERE chunk_kind='body'
    #      AND text LIKE '%<sort_year>%' LIMIT 3
    #
    # which is "any three passages anywhere in the corpus containing this
    # year as a substring". It produced citations that were simply false:
    # the 1908 plate of Ambedkar's name in the Elphinstone College roll-call
    # was given three sources about plough cattle and agricultural stock,
    # because those passages happen to contain "1908-09". The interface then
    # displayed them under "Archival sources" with volume and page.
    #
    # A shared year is not evidence of anything. An event's real provenance
    # is the album plate it was scanned from, which is already recorded in
    # timeline_events.image_path and needs no link table.
    #
    # timeline_sources remains for genuine links - a curated one exists for
    # the birth event, added by backend/ingest/repair_timeline.py, whose
    # source actually states the date it is cited for.
    linked = 0

    print(f"  entities: {created} created, {linked} timeline source links")
    return created


def main() -> int:
    if not config.DB_PATH.exists():
        print("archive not built - run: python -m backend.ingest.build")
        return 2
    db.init_db()
    print(f"archive: {config.DB_PATH}")
    with db.connect() as conn:
        build_manuscripts(conn)
        seed_ocr_candidates(conn)
        build_media(conn)
        build_timeline(conn)
        build_entities(conn)
        db.log(conn, "index", None, "collections rebuilt from real assets", actor="ingest")
        conn.commit()

        stats = {
            "manuscript_pages": conn.execute("SELECT COUNT(*) FROM manuscript_pages").fetchone()[0],
            "media_assets": conn.execute("SELECT COUNT(*) FROM media_assets").fetchone()[0],
            "timeline_events": conn.execute("SELECT COUNT(*) FROM timeline_events").fetchone()[0],
            "entities": conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0],
            "entity_links": conn.execute("SELECT COUNT(*) FROM entity_links").fetchone()[0],
            "chunks": conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0],
        }
    print("\ncollections now hold:")
    for key, value in stats.items():
        print(f"   {key:20s} {value:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
