"""Page-aware chunking.

A chunk is the retrieval unit and the thing a citation points at, so the
rule here is that a chunk must always be able to answer "where did this
come from?" - which volume, which work, which printed page, which
characters.

Chunks are built page by page and never span a section boundary. A chunk
that straddled two works would produce a citation naming one work while
quoting another, which is exactly the failure the evidence gate exists to
prevent. Consecutive pages inside the same section are merged freely,
because a paragraph running across a page break is one idea.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..app.core import config
from .extract import ExtractedDoc, Page


# Split on sentence ends. Written without lookbehind to match the
# constraint already documented in the frontend splitter (src/lib/
# retrieval.js): lookbehind throws at parse time on iOS Safari < 16.4, and
# keeping both splitters consistent means a chunk boundary in Python lands
# where the UI would draw one too.
_SENTENCE_END = re.compile(r"([.!?][\"')\]]?)\s+")


def split_sentences(text: str) -> list[str]:
    parts = _SENTENCE_END.split(text)
    out: list[str] = []
    buf = ""
    for i, piece in enumerate(parts):
        buf += piece
        # Every odd index is a captured terminator, so the sentence ends here.
        if i % 2 == 1:
            out.append(buf.strip())
            buf = ""
    if buf.strip():
        out.append(buf.strip())
    return [s for s in out if s]


@dataclass
class Chunk:
    seq: int
    text: str
    page_start: int
    page_end: int
    printed_page_start: int | None
    printed_page_end: int | None
    char_start: int
    char_end: int
    section: str | None
    kind: str = "body"

    @property
    def char_count(self) -> int:
        return len(self.text)


# Dot leaders - '.. .. .. 23' - are the signature of a contents entry.
_DOT_LEADER = re.compile(r"\.\s*\.\s*\.")
# A line that is only figures and separators: '33,234', '1 : 15.6', '57.06'.
_NUMERIC_LINE = re.compile(r"^[\d\s.,:;%()\[\]/-]+$")

# Measured on Writings and Speeches Vol. I: running prose averages 73-84
# characters per line; contents entries and statistical table rows run 16-23.
_SHORT_LINE = 45
_MIN_LINES_TO_JUDGE = 8
# Deliberately high. Misclassifying prose withholds real evidence from
# retrieval, which is a worse failure than letting a contents page through,
# so a chunk is only withheld when it is overwhelmingly apparatus.
_NAV_RATIO = 0.70


def _is_list_like(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    if _DOT_LEADER.search(s):
        return True
    if len(s) >= _SHORT_LINE:
        return False
    if _NUMERIC_LINE.fullmatch(s):
        return True
    letters = [c for c in s if c.isalpha()]
    if letters and sum(1 for c in letters if c.isupper()) / len(letters) > 0.85:
        return True                       # short all-caps heading
    return bool(re.search(r"\d\s*$", s))  # short line ending in a figure


def classify(text: str) -> str:
    """Separate evidence-bearing prose from navigation apparatus.

    A table of contents names every work in the volume, so it matches
    almost any query about any of them - in testing it outranked the real
    'Federation versus Freedom' text on a search for that exact title.
    Statistical appendices behave similarly: they match on figures without
    answering anything.

    Judged line by line rather than by chunk average, because a chunk that
    mixes a paragraph with a table would otherwise be withheld whole.
    Navigation stays in the archive for full-text access (PS req 3); it is
    only withheld from retrieval.
    """
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) < _MIN_LINES_TO_JUDGE:
        return "body"

    listish = sum(1 for ln in lines if _is_list_like(ln))
    if listish / len(lines) < _NAV_RATIO:
        return "body"

    return "toc" if len(_DOT_LEADER.findall(text)) >= 3 else "listing"


def _flush(buffer: list[tuple[Page, str]], seq: int) -> Chunk | None:
    """Turn accumulated (page, sentence) pairs into one chunk."""
    if not buffer:
        return None
    text = " ".join(s for _, s in buffer).strip()
    if not text:
        return None

    pages = [p for p, _ in buffer]
    first, last = pages[0], pages[-1]

    # Character offsets are anchored to where this chunk's text actually
    # begins inside its first page, so a viewer can highlight the passage.
    first_text = first.text
    local = first_text.find(buffer[0][1][:60]) if buffer[0][1] else -1
    start = first.char_start + (local if local >= 0 else 0)

    printed = [p.printed_page for p in pages if p.printed_page is not None]

    section_name = (first.section or "").strip().lower()
    kind = "toc" if section_name in {"contents", "table of contents"} else classify(text)

    return Chunk(
        seq=seq,
        text=text,
        page_start=first.pdf_page,
        page_end=last.pdf_page,
        printed_page_start=printed[0] if printed else None,
        printed_page_end=printed[-1] if printed else None,
        char_start=start,
        char_end=start + len(text),
        section=first.section,
        kind=kind,
    )


def chunk_document(
    doc: ExtractedDoc,
    *,
    target: int | None = None,
    overlap: int | None = None,
    minimum: int | None = None,
) -> list[Chunk]:
    target = target or config.CHUNK_TARGET_CHARS
    overlap = overlap or config.CHUNK_OVERLAP_CHARS
    minimum = minimum or config.CHUNK_MIN_CHARS

    chunks: list[Chunk] = []
    buffer: list[tuple[Page, str]] = []
    seq = 0
    section: str | None = None

    def size() -> int:
        return sum(len(s) + 1 for _, s in buffer)

    def close(*, carry_overlap: bool) -> None:
        """Emit the buffer as a chunk, optionally keeping its tail so a
        sentence on the boundary stays retrievable from both neighbours."""
        nonlocal buffer, seq
        chunk = _flush(buffer, seq)
        if chunk is None:
            buffer = []
            return
        chunks.append(chunk)
        seq += 1

        if not carry_overlap or overlap <= 0:
            buffer = []
            return

        tail: list[tuple[Page, str]] = []
        carried = 0
        for page_sent in reversed(buffer):
            if carried + len(page_sent[1]) > overlap:
                break
            tail.insert(0, page_sent)
            carried += len(page_sent[1]) + 1
        # Never carry a sentence across a section boundary.
        last_section = buffer[-1][0].section
        buffer = [t for t in tail if t[0].section == last_section]

    for page in doc.pages:
        # Never let a chunk span two different works: the citation would
        # name one work while quoting another.
        if buffer and page.section != section:
            close(carry_overlap=False)
        section = page.section

        for sentence in split_sentences(page.text):
            buffer.append((page, sentence))
            if size() >= target:
                close(carry_overlap=True)

    close(carry_overlap=False)

    # A trailing fragment shorter than the floor is merged back into its
    # predecessor rather than left as a chunk too small to stand alone.
    if len(chunks) >= 2 and chunks[-1].char_count < minimum:
        tail = chunks.pop()
        prev = chunks[-1]
        if prev.section == tail.section:
            prev.text = f"{prev.text} {tail.text}".strip()
            prev.page_end = tail.page_end
            prev.printed_page_end = tail.printed_page_end or prev.printed_page_end
            prev.char_end = prev.char_start + len(prev.text)
        else:
            chunks.append(tail)

    return chunks
