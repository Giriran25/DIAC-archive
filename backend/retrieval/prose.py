"""Whether a passage reads as prose, or as apparatus.

Scanned volumes carry more than the author's text: title pages, printer's
imprints with addresses and telephone numbers, running heads, and back-matter
lists of other volumes in the series. The ingest classifier catches most of
these as 'toc' or 'listing', but not all - a "PUBLISHED VOLUMES" advertisement
at the back of Volume 1 is stored as body text, and the retrieval pipeline
will happily return it, because lexically it is full of the right words.

Quoting one of those as an answer is the failure this module prevents:

    Q: What did Ambedkar say about the annihilation of caste?
    A: 1  z Castes in India  z Annihilation of Caste, Maharashtra as a
       Linguistic Province, Need for Checks and Balances ...

Nothing here deletes, rewrites or reclassifies anything. Every passage stays
in the index, stays searchable, and stays readable at its page. This decides
only whether a passage may be QUOTED BACK as an answer or a summary - and
when nothing else is available, the caller may still quote it rather than
leave a visitor with no response at all.

The thresholds were measured against the seven documents in the archive, not
chosen by eye: they keep 87-98% of body chunks per volume. The intent is to
drop the colophon, not to prune the archive.
"""

from __future__ import annotations

#: Running heads and title pages shout; continuous prose does not.
MAX_UPPER_RATIO = 0.10

#: Prose wraps at roughly 80 characters. Front matter and list layouts set
#: short lines, which is the cheapest reliable signal that a block is a list.
MIN_MEAN_LINE = 55

#: Addresses, telephone numbers, price notices and index tables.
MAX_DIGIT_RATIO = 0.06

#: Control characters used by scanners as bullet glyphs. Their presence in
#: quantity means a list, whatever the words around them say.
_BULLET_CONTROLS = "\x01\x02\x03\x04\x05\x06\x07\x0b\x0c\x0e\x0f"


def reads_as_prose(text: str) -> bool:
    """True when a passage is continuous prose rather than apparatus."""
    if not text:
        return False

    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False

    if sum(1 for c in letters if c.isupper()) / len(letters) > MAX_UPPER_RATIO:
        return False

    lines = [ln for ln in text.splitlines() if ln.strip()]
    if lines and (sum(len(ln) for ln in lines) / len(lines)) < MIN_MEAN_LINE:
        return False

    if sum(c.isdigit() for c in text) / len(text) > MAX_DIGIT_RATIO:
        return False

    # A handful of bullet glyphs is a list, not a paragraph.
    if sum(text.count(c) for c in _BULLET_CONTROLS) >= 3:
        return False

    return True


def prefer_prose(passages: list, key=lambda p: p) -> list:
    """Return the prose passages, or the original list if none qualify.

    The fallback matters: a visitor asking a question the archive can answer
    must get an answer. Filtering to nothing and returning silence would be a
    worse failure than quoting an imperfect passage.
    """
    kept = [p for p in passages if reads_as_prose(key(p) or "")]
    return kept or list(passages)
