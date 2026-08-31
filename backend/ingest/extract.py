"""Page-aware text extraction from PDFs with a clean embedded text layer.

No OCR here. The audit established that the English volumes carry proper
text layers with ToUnicode maps, so OCR would only add noise and cost. OCR
is reserved for the JP2 manuscript scans (Phase 4).

Three things are recovered per page and none of them may be lost, because
each one is load-bearing for a citation:

  * the PDF page index      - what the source viewer opens
  * the printed page number - what a scholar cites (they differ; in
                              Writings and Speeches Vol. I by 14)
  * the running header      - the work within the volume, e.g.
                              'ANNIHILATION OF CASTE'

Running headers and page numbers are then stripped from the body text.
Left in, they become the highest-frequency strings in the corpus and
poison lexical retrieval - a search for 'Ambedkar writings' would match
all 208 pages carrying the book's own running head.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import fitz  # PyMuPDF


BARE_NUMBER = re.compile(r"^\d{1,4}$")

# 'PART II', 'CHAPTER IV' - structural sub-headings inside a work, not the
# name of a work. Treated as furniture so the enclosing section persists.
SUBHEADING = re.compile(r"^(part|chapter|section|appendix)\s+[ivxlcdm\d]+$", re.I)

# Words that stay lowercase inside a title, so a citation reads
# 'Annihilation of Caste' rather than 'Annihilation Of Caste'.
_MINOR = {"a", "an", "and", "as", "at", "before", "but", "by", "for", "from",
          "in", "of", "on", "or", "the", "to", "versus", "vs", "with"}


def _titlecase(text: str) -> str:
    words = text.strip().split()
    out = []
    for i, w in enumerate(words):
        low = w.lower()
        # Running heads are set entirely in capitals, so there is no way to
        # tell an initialism from an ordinary word here. Title-casing
        # everything is the predictable choice.
        if i != 0 and low in _MINOR:
            out.append(low)
        else:
            out.append(low.capitalize() if low.isalpha() else w.title())
    return " ".join(out)

# A running header is short, mostly capitals, and has no sentence
# punctuation. Checked against the real headers found in Volume 1.
def _looks_like_header(line: str) -> bool:
    s = line.strip()
    if not (4 <= len(s) <= 70):
        return False
    if s.endswith((".", "?", "!", ",", ";", ":")):
        return False
    if SUBHEADING.match(s):
        return True  # furniture: stripped, but never recorded as a section
    letters = [c for c in s if c.isalpha()]
    if not letters:
        return False
    upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
    return upper_ratio > 0.85


@dataclass
class Page:
    """One extracted page, already cleaned."""
    pdf_page: int                 # 1-based
    printed_page: int | None      # as printed on the page, if found
    section: str | None           # running header (work within the volume)
    text: str
    char_start: int = 0           # offset into the document's full text
    char_end: int = 0


@dataclass
class ExtractedDoc:
    path: Path
    page_count: int
    pages: list[Page] = field(default_factory=list)

    @property
    def full_text(self) -> str:
        return "\n\n".join(p.text for p in self.pages)


def _normalise(text: str) -> str:
    """Normalise without destroying the source.

    Ligatures and non-breaking spaces are folded because they break word
    matching in FTS5. Smart quotes and dashes are KEPT - the volumes use
    real Unicode punctuation and a quote is part of the quotation.
    """
    text = unicodedata.normalize("NFKC", text)
    text = text.replace(" ", " ").replace("​", "")
    # Join words hyphenated across a line break: "inter-\nmarry" -> "intermarry"
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    # Collapse runs of spaces/tabs but keep paragraph structure.
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _strip_furniture(lines: list[str]) -> tuple[list[str], int | None, str | None]:
    """Remove the page-number / running-header block.

    Volume 1 puts them in three arrangements, all handled here:
        [number, HEADER, body...]   (verso)
        [HEADER, number, body...]   (recto)
        [HEADER, body..., number]   (occasional)
    """
    body = list(lines)
    printed: int | None = None
    header: str | None = None

    # Number or header in the first two positions.
    for _ in range(2):
        if not body:
            break
        first = body[0].strip()
        if printed is None and BARE_NUMBER.fullmatch(first):
            printed = int(first)
            body.pop(0)
            continue
        if header is None and _looks_like_header(first):
            header = first
            body.pop(0)
            continue
        break

    # Trailing page number.
    if printed is None and body and BARE_NUMBER.fullmatch(body[-1].strip()):
        printed = int(body[-1].strip())
        body.pop()

    return body, printed, header


def extract_pdf(path: Path, *, book_title_header: str | None = None) -> ExtractedDoc:
    """Extract a PDF page by page.

    `book_title_header` is the volume's own running head (e.g.
    'DR. BABASAHEB AMBEDKAR : WRITINGS AND SPEECHES'). It is stripped like
    any other header but never recorded as a section, because it names the
    book rather than the work inside it.
    """
    doc = fitz.open(path)
    out = ExtractedDoc(path=path, page_count=doc.page_count)

    current_section: str | None = None
    cursor = 0
    book_head = (book_title_header or "").strip().upper()

    for index in range(doc.page_count):
        raw = doc[index].get_text("text")
        lines = [ln for ln in (l.rstrip() for l in raw.splitlines()) if ln.strip()]
        if not lines:
            continue

        body, printed, header = _strip_furniture(lines)

        # A section header persists until the next one appears, so pages in
        # the middle of a work still know which work they belong to.
        if header:
            head_up = header.strip().upper()
            if book_head and head_up == book_head:
                pass  # the book's own running head - not a section
            elif SUBHEADING.match(header.strip()):
                pass  # 'PART II' - stays inside the current work
            else:
                current_section = _titlecase(header)

        text = _normalise("\n".join(body))
        if not text:
            continue

        page = Page(
            pdf_page=index + 1,
            printed_page=printed,
            section=current_section,
            text=text,
            char_start=cursor,
            char_end=cursor + len(text),
        )
        cursor = page.char_end + 2  # the "\n\n" join between pages
        out.pages.append(page)

    doc.close()
    _canonicalise_sections(out)
    reconcile_pages(out)
    return out


def reconcile_pages(doc: ExtractedDoc) -> dict[str, int]:
    """Validate every detected printed page number against the volume's
    modal offset, and repair the ones that disagree.

    `_strip_furniture` accepts any bare number at the top of a page, which
    also catches footnote markers and stray table cells - one such page in
    Volume 1 reported printed page 2 for PDF page 38. An incorrect printed
    page is an incorrect citation, so a detected value is only trusted when
    it agrees with the offset the rest of the volume establishes.
    """
    offset = page_offset(doc)
    stats = {"detected": 0, "inferred": 0, "corrected": 0, "unknown": 0}

    if offset is None:
        stats["detected"] = sum(1 for p in doc.pages if p.printed_page is not None)
        stats["unknown"] = sum(1 for p in doc.pages if p.printed_page is None)
        return stats

    for page in doc.pages:
        expected = page.pdf_page - offset

        if page.printed_page is not None and abs(page.printed_page - expected) <= 1:
            stats["detected"] += 1
            continue

        # Front matter is numbered separately (often in roman numerals);
        # inferring a body number there would invent a citation.
        if expected < 1:
            if page.printed_page is not None:
                stats["corrected"] += 1
            page.printed_page = None
            stats["unknown"] += 1
            continue

        stats["corrected" if page.printed_page is not None else "inferred"] += 1
        page.printed_page = expected

    return stats


def _canonicalise_sections(doc: ExtractedDoc) -> None:
    """Repair headers truncated by a line break.

    A two-line running head ('MAHARASHTRA AS A LINGUISTIC / PROVINCE')
    yields both the truncated and the full form. Any section that is a
    strict prefix of a longer, more frequent one is folded into it, so the
    volume ends up with one name per work.
    """
    from collections import Counter

    counts = Counter(p.section for p in doc.pages if p.section)
    if not counts:
        return

    remap: dict[str, str] = {}
    for short in counts:
        best: str | None = None
        for long in counts:
            if long == short or not long.startswith(short + " "):
                continue
            if counts[long] < counts[short]:
                continue
            if best is None or len(long) > len(best):
                best = long
        if best:
            remap[short] = best

    if not remap:
        return
    for page in doc.pages:
        if page.section in remap:
            page.section = remap[page.section]


def page_offset(doc: ExtractedDoc) -> int | None:
    """Modal (pdf_page - printed_page) offset.

    Used to infer a printed page number for pages where none was detected,
    so a citation is never left without a scholarly page reference.
    """
    from collections import Counter

    diffs = Counter(
        p.pdf_page - p.printed_page for p in doc.pages if p.printed_page is not None
    )
    if not diffs:
        return None
    offset, count = diffs.most_common(1)[0]
    # Only trust it if it is genuinely consistent across the volume.
    return offset if count >= max(10, 0.5 * sum(diffs.values())) else None
