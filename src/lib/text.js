/* ---------------------------------------------------------------------- *
 * DAIC ARCHIVE — presentation helpers for archival text.
 *
 * These decide HOW archival text is displayed. They never decide what it
 * says. Nothing here rewrites a word, corrects a spelling, guesses at a
 * damaged passage, or changes a name, date or number — the archive's text
 * is the record, and the record is not ours to improve.
 *
 * What they do is stop the interface from presenting text as something it
 * is not. The timeline and stories screens draw their events from the
 * plate album, whose "titles" are OCR captions. Some are sentences; some
 * are "Dr", "V", "f, at", or "R O L L -C A L L O P T H E E L P H I".
 * Rendered at heading size those dominate the page and say nothing, which
 * is what the archive looked like before this module existed.
 *
 * So a caption that cannot carry a heading is not made into one. The year
 * leads instead, and the caption is shown at body size, labelled as what it
 * is. The text is unchanged either way.
 * ---------------------------------------------------------------------- */

/** Words that survive OCR as single letters and mean nothing alone. */
const MIN_HEADING_CHARS = 14;

/**
 * True when a scanned caption reads as letter-spaced capitals, e.g.
 * "R O L L -C A L L O P T H E". Four or more single-letter tokens in a row
 * is well past what ordinary prose produces ("I", "A", initials).
 */
export function isLetterSpaced(text) {
  const tokens = String(text || '').trim().split(/\s+/);
  if (tokens.length < 4) return false;
  let run = 0;
  for (const tok of tokens) {
    const bare = tok.replace(/[^\p{L}]/gu, '');
    if (bare.length === 1) {
      run += 1;
      if (run >= 4) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

/**
 * Whether a caption can serve as a heading.
 *
 * Deliberately conservative: a caption is rejected only when it is plainly
 * unusable — too short to say anything, or letter-spaced scan noise. A
 * caption that is merely long or awkward is still the archive's own words
 * and is shown as written.
 */
export function canHeadline(text) {
  const s = String(text || '').trim();
  if (s.length < MIN_HEADING_CHARS) return false;
  if (isLetterSpaced(s)) return false;
  // Needs at least two real words; "On I October 19 18, Dr" scrapes by, and
  // that is correct — it is legible, if inelegant, and it is what the plate says.
  const words = s.split(/\s+/).filter((w) => /\p{L}{3,}/u.test(w));
  return words.length >= 2;
}

/**
 * A short, single-line label for a card or a tab.
 * Truncates for display only; the full text is always available beneath.
 */
export function shorten(text, max = 90) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * What to put in the heading slot for a dated archival event, and what to
 * put beneath it.
 *
 * Returns `{ heading, caption, captionIsPrimary }`. When the caption cannot
 * headline, the year becomes the heading and the caption drops to body
 * text — the same information, ordered so the legible part leads.
 */
export function eventHeading(event) {
  const title = String(event?.title || '').trim();
  const year = String(event?.year || event?.date || '').trim();

  if (canHeadline(title)) {
    return { heading: title, caption: null, captionIsPrimary: false };
  }
  return {
    heading: year || 'Undated plate',
    caption: title || null,
    captionIsPrimary: true,
  };
}
