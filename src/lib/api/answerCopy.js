/* ---------------------------------------------------------------------- *
 * DAIC ARCHIVE — visitor-facing wording for an answer's state.
 *
 * The backend's own reasons are diagnostics: "relevance 1.501 below floor
 * 2.5 (rerank)" tells an engineer exactly what happened and tells a visitor
 * standing at a kiosk nothing at all. Worse, it puts a number on screen
 * that looks like a confidence score and is not one.
 *
 * So the raw reason never reaches the DOM. It stays in the API response,
 * where /api/search and the logs still carry the full gate decision for
 * anyone debugging; this module decides only what a reader is shown.
 *
 * The wording never overstates. A refusal says the archive found nothing it
 * could stand behind — not that nothing exists, and not that the question
 * was bad.
 * ---------------------------------------------------------------------- */

/** Why the archive declined to answer, in a visitor's terms. */
export function refusalWording(reason) {
  const raw = String(reason || '').toLowerCase();

  if (raw.includes('coverage')) {
    return 'The archive holds nothing close enough to those words to answer from. Try naming a person, place, work or year.';
  }
  if (raw.includes('provenance')) {
    return 'The passages that matched could not be traced to a verified page, so the archive will not quote them.';
  }
  if (raw.includes('model reported insufficient')) {
    return 'The sources found were too thin to answer from with confidence.';
  }
  // Includes the relevance floor, which is the common case.
  return 'No confident source found in the archive for that question.';
}

/** Why an answer is evidence-derived rather than model-written. */
export function degradedWording(reason) {
  const raw = String(reason || '').toLowerCase();

  if (raw.includes('citation')) {
    return 'The generated wording could not be matched to its sources, so the archive is quoting the passages directly instead.';
  }
  if (raw.includes('timed out') || raw.includes('unreachable') || raw.includes('http ')) {
    return 'The writing assistant was unavailable, so the archive is quoting the passages directly.';
  }
  // The configured-without-a-model case, which is the normal deployment.
  return 'Quoted directly from the archive rather than rewritten.';
}

/**
 * How the answer was produced, for the small chip beside it.
 * Provider identifiers ("extractive", "openrouter:...") are internal names
 * and are never shown.
 */
export function provenanceLabel(state, provider) {
  if (state === 'grounded') return 'Written from cited sources';
  if (state === 'degraded') return 'Quoted from the archive';
  if (provider === 'none' || !provider) return null;
  return null;
}
