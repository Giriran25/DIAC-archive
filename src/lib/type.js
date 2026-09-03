/* ---------------------------------------------------------------------- *
 * DAIC ARCHIVE — one typographic scale for the whole archive.
 *
 * Archive, Reader, Stories and Timeline were each choosing their own sizes,
 * weights and line heights, so the same kind of thing — a document title, a
 * date, a provenance line — looked different depending on which screen you
 * were standing in front of. These are the shared decisions.
 *
 * The two families carry different jobs, and the split is the rule the rest
 * of the interface follows:
 *
 *   Source Serif 4   archival reading matter: document titles, event
 *                    titles, quoted passages, body prose. Anything that is,
 *                    or represents, the archive's own words.
 *
 *   Work Sans        the apparatus around it: navigation, controls, labels,
 *                    dates, provenance, counts, status. Anything the
 *                    interface says in its own voice.
 *
 * Keeping that split honest means a reader can tell, at a glance and
 * without reading a word, which text is Ambedkar's and which is ours.
 * ---------------------------------------------------------------------- */

import { FONT_DISPLAY, FONT_BODY, FONT_UI, INKTEXT, MUTED, BODYTEXT } from './tokens.js';

/* ---- headings: the archive's own voice ------------------------------- */

/** Page-level title. One per screen. */
export const pageTitle = {
  fontFamily: FONT_DISPLAY,
  color: INKTEXT,
  lineHeight: 1.15,
  letterSpacing: '-0.01em',
};

/** A document, event or story title inside a card or panel. */
export const itemTitle = {
  fontFamily: FONT_BODY,
  color: INKTEXT,
  fontWeight: 600,
  lineHeight: 1.3,
};

/** Quoted archival prose. */
export const archivalBody = {
  fontFamily: FONT_BODY,
  color: BODYTEXT,
  lineHeight: 1.7,
};

/* ---- apparatus: the interface's own voice ---------------------------- */

/** Section eyebrow above a page title. */
export const eyebrow = {
  fontFamily: FONT_UI,
  textTransform: 'uppercase',
  letterSpacing: '0.25em',
  fontSize: '11px',
  fontWeight: 500,
};

/** Dates, volumes, pages, counts — the metadata line under a title. */
export const meta = {
  fontFamily: FONT_UI,
  color: MUTED,
  fontSize: '11px',
  lineHeight: 1.5,
};

/** Provenance and citation strings. */
export const provenance = {
  fontFamily: FONT_UI,
  color: '#6f6549',
  fontSize: '11px',
  lineHeight: 1.55,
};

/** Buttons, tabs, chips. */
export const control = {
  fontFamily: FONT_UI,
  fontWeight: 600,
  fontSize: '12px',
};

/* ---- shared card geometry -------------------------------------------- *
 * Cards are the unit every browse screen is built from, so their edges,
 * corners and padding are decided once. A screen that wants a different
 * card is almost always a screen that has drifted.
 * -------------------------------------------------------------------- */

export const CARD_CLASS =
  'daic-card min-w-0 rounded-xl border border-[#d8c79a] bg-[#faf4e4] ' +
  'transition-colors hover:border-[#b3862c]';

export const CARD_SELECTED_CLASS =
  'daic-card min-w-0 rounded-xl border border-[#b3862c] bg-[#1c2c4d] ' +
  'text-[#f4ead0] shadow-md ring-2 ring-[#b3862c]/40';

/** Padding used inside every card, so density matches across screens. */
export const CARD_PAD = 'p-5';

/**
 * Clamp a title to N lines so a long archival title wraps gracefully
 * instead of pushing a card out of alignment with its neighbours.
 * The text is never shortened — only the visible box is bounded.
 */
export function clampLines(lines) {
  return {
    display: '-webkit-box',
    WebkitLineClamp: String(lines),
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  };
}
