/* ---------------------------------------------------------------------- *
 * DAIC ARCHIVE — the three states of /api/ask
 *
 * The backend answers a question in one of three ways, and the difference
 * matters more than the text does. Collapsing them would let a limited
 * answer read like a confident one, which is the failure this archive
 * exists to prevent.
 *
 *   GROUNDED  a model wrote the answer AND every citation validated
 *   DEGRADED  generation failed or its citations were rejected, so the
 *             answer is verbatim sentences lifted from the sources
 *   REFUSED   the evidence gate did not pass; no model was called and the
 *             backend deliberately returns NO evidence
 *
 * Normalising here means each screen renders a state rather than
 * re-deriving one from four booleans.
 * ---------------------------------------------------------------------- */

/* Evidence markers are how the backend ties a sentence to a passage, and
   how citation validation checks it. They are notation, not prose: the
   evidence list beneath an answer already shows the reader which sources it
   rests on, so the markers are removed from the text on the way to the
   screen rather than left as "[E1]" in the middle of a sentence. */
const MARKER = /\s*\[\s*E\s*\d{1,2}\s*\]/gi;

export function stripMarkers(text) {
  return String(text || '').replace(MARKER, '').replace(/\s+([.,;:])/g, '$1').trim();
}

export const ANSWER_STATE = {
  GROUNDED: 'grounded',
  DEGRADED: 'degraded',
  REFUSED: 'refused',
};

/**
 * Normalise a raw /api/ask (or /api/summarize) payload.
 * Never throws: a malformed response is treated as a refusal, because
 * showing nothing is safer than showing an unverified answer.
 */
export function readAnswer(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      state: ANSWER_STATE.REFUSED,
      answer: '',
      evidence: [],
      reason: 'The archive returned no response.',
      provider: null,
      citedIds: [],
      timings: {},
    };
  }

  const gatePassed = payload.gate?.passed !== false;
  const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];

  let state;
  if (!gatePassed) {
    state = ANSWER_STATE.REFUSED;
  } else if (payload.grounded === true) {
    state = ANSWER_STATE.GROUNDED;
  } else {
    state = ANSWER_STATE.DEGRADED;
  }

  return {
    state,
    answer: stripMarkers(payload.answer || ''),
    /* A refusal shows no sources. The backend already withholds them;
       this makes it true regardless of what the caller was handed. */
    evidence: state === ANSWER_STATE.REFUSED ? [] : evidence,
    reason: payload.gate?.reason || payload.degraded || null,
    /* Why generation was not used — surfaced only on a degraded answer. */
    degraded: payload.degraded || null,
    provider: payload.provider || null,
    citedIds: payload.citations?.cited || [],
    timings: payload.timings || {},
    counts: payload.counts || {},
  };
}

export const isGrounded = (s) => s === ANSWER_STATE.GROUNDED;
export const isDegraded = (s) => s === ANSWER_STATE.DEGRADED;
export const isRefused = (s) => s === ANSWER_STATE.REFUSED;
