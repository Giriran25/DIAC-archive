/* ---------------------------------------------------------------------- *
 * DAIC ARCHIVE — design tokens
 *
 * Lifted verbatim out of App.jsx so the landing page and the application
 * share one source of truth. The values are unchanged; nothing here is a
 * new colour or a new typeface.
 * ---------------------------------------------------------------------- */

export const INK = "#141c30";
export const INDIGO = "#1c2c4d";
export const PARCH = "#f4ead0";
export const GOLD = "#b3862c";
export const GOLD_LIGHT = "#d9ac4f";
export const VERMIL = "#9c3d2e";
export const INKTEXT = "#241f16";
export const CREAM = "#f4ead0";

/* Each stack names real fallbacks, so a face that fails to load degrades to
   something of the same character rather than to the browser default. */
export const FONT_DISPLAY = "'Tiro Devanagari Hindi', 'Noto Serif Devanagari', Georgia, 'Times New Roman', serif";
export const FONT_BODY = "'Source Serif 4', Georgia, Cambria, 'Times New Roman', serif";
export const FONT_UI = "'Work Sans', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";

/* Secondary surface values already used throughout the app, named here so
   the landing page does not reintroduce them as loose hex literals. */
export const CARD = "#faf4e4";
export const BORDER = "#d8c79a";
export const BORDER_SOFT = "#c9b98c";
export const CHIP = "#efe0bb";
export const MUTED = "#8a7f63";
export const BODYTEXT = "#4a4330";
