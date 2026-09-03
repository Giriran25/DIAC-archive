/* ---------------------------------------------------------------------- *
 * Sentence splitting.
 *
 * Lifted out of lib/retrieval.js, which imports the demonstration corpus.
 * Three production views needed nothing from that module but this function,
 * and importing it pulled every fixture article and passage into the
 * production bundle - roughly 40 KB of invented archive text shipped to a
 * kiosk that must only ever show the real one. Nothing here imports data.
 * ---------------------------------------------------------------------- */

export function splitSentences(text) {
  // Written without lookbehind on purpose: (?<=...) throws a SyntaxError at
  // parse time on iOS Safari before 16.4, which would take the whole page
  // down on an older phone rather than degrading.
  const CLOSERS = "\"'’”)]";
  const OPENERS = "\"'‘“";
  const out = [];
  let buf = "";
  const chars = String(text).split("");

  for (let i = 0; i < chars.length; i++) {
    buf += chars[i];
    if (!".!?;".includes(chars[i])) continue;

    // A terminator can sit inside the quotation: `six."` ends the sentence,
    // so absorb any closing punctuation before deciding.
    let j = i + 1;
    while (j < chars.length && CLOSERS.includes(chars[j])) {
      buf += chars[j];
      j++;
    }

    // Then require whitespace followed by a capital or an opening quote.
    let k = j;
    let sawSpace = false;
    while (k < chars.length && /\s/.test(chars[k])) { sawSpace = true; k++; }

    if (!sawSpace || k >= chars.length) { i = j - 1; continue; }

    const next = chars[k];
    const startsNew =
      OPENERS.includes(next) ||
      (next === next.toUpperCase() && next !== next.toLowerCase());

    if (startsNew) {
      out.push(buf.trim());
      buf = "";
      i = k - 1;
    } else {
      i = j - 1;
    }
  }

  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}
