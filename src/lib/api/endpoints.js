/* ---------------------------------------------------------------------- *
 * DAIC ARCHIVE — API endpoints
 *
 * Every entry below corresponds to a route that ACTUALLY EXISTS on the
 * frozen backend. The list was diffed against the running FastAPI app;
 * nothing here is aspirational.
 *
 * If a screen needs something that is not in this file, the backend does
 * not provide it. Add a graceful UI state — never a new entry here.
 * ---------------------------------------------------------------------- */

import { get, post, patch } from './client.js';

export const api = {
  /* ---- system ---- */
  health: (opts) => get('/api/health', undefined, opts),
  languages: (opts) => get('/api/languages', undefined, opts),

  /* ---- retrieval ----
     /api/ask answers in three states: grounded, degraded (extractive) and
     refused. See lib/api/askState.js — the UI must distinguish them. */
  ask: (body) => post('/api/ask', body),
  search: (params, opts) => get('/api/search', params, opts),
  summarize: (body) => post('/api/summarize', body),
  translate: (body) => post('/api/translate', body),

  /* ---- archive & source resolution ---- */
  archive: (params, opts) => get('/api/archive', params, opts),
  document: (id, opts) => get(`/api/archive/${id}`, undefined, opts),
  source: (chunkId, opts) => get(`/api/source/${chunkId}`, undefined, opts),
  sourcePage: (docId, page, opts) => get(`/api/source/${docId}/page/${page}`, undefined, opts),

  /* ---- timeline ---- */
  timeline: (params, opts) => get('/api/timeline', params, opts),
  timelineEvent: (id, opts) => get(`/api/timeline/${id}`, undefined, opts),

  /* ---- knowledge mapping ---- */
  entities: (params, opts) => get('/api/entities', params, opts),
  entity: (id, opts) => get(`/api/entities/${id}`, undefined, opts),
  entityRelated: (id, opts) => get(`/api/entities/${id}/related`, undefined, opts),

  /* ---- manuscripts ---- */
  manuscripts: (opts) => get('/api/manuscripts', undefined, opts),
  manuscript: (id, params, opts) => get(`/api/manuscript/${id}`, params, opts),
  manuscriptPage: (id, page, opts) => get(`/api/manuscript/${id}/page/${page}`, undefined, opts),
  /* The page scan is an <img> src, not JSON. `width` is the longest edge:
     <=400 returns PNG, larger returns JPEG. */
  manuscriptPageImageUrl: (id, page, width = 1200) =>
    `/api/manuscript/${id}/page/${page}/image?width=${width}`,

  /* ---- OCR + manuscript review (the real review loop) ----
     Unapproved text is never retrievable; approve is the only route that
     indexes a page, and reject withdraws it again. */
  runOcr: (body) => post('/api/ocr', body),
  reviewPage: (id, body) => post(`/api/manuscript/${id}/review`, body),
  approvePage: (id, body) => post(`/api/manuscript/${id}/approve`, body),
  rejectPage: (id, body) => post(`/api/manuscript/${id}/reject`, body),

  /* ---- media ---- */
  media: (params, opts) => get('/api/media', params, opts),
  mediaItem: (id, opts) => get(`/api/media/${id}`, undefined, opts),
  mediaTranscript: (id, opts) => get(`/api/media/${id}/transcript`, undefined, opts),
  mediaSegments: (id, params, opts) => get(`/api/media/${id}/segments`, params, opts),
  /* Streamed bytes, range-aware. Null when the asset is not servable —
     always read `servable` / `streamUrl` from the media object first. */
  mediaStreamUrl: (id) => `/api/media/${id}/stream`,

  /* ---- archivist intake ---- */
  upload: (body) => post('/api/archivist/upload', body),
  pending: (params, opts) => get('/api/archivist/pending', params, opts),
  archivistItem: (id, opts) => get(`/api/archivist/item/${id}`, undefined, opts),
  updateItemMetadata: (id, body) => patch(`/api/archivist/item/${id}`, body),
  approveItem: (id, body) => post(`/api/archivist/item/${id}/approve`, body),
  rejectItem: (id, body) => post(`/api/archivist/item/${id}/reject`, body),

  /* ---- preservation ---- */
  preservation: (id, opts) => get(`/api/preservation/${id}`, undefined, opts),
  verifyPreservation: (id) => post(`/api/preservation/verify/${id}`),
  auditLog: (params, opts) => get('/api/audit-log', params, opts),
};

/* ---------------------------------------------------------------------- *
 * Capabilities the backend does NOT provide.
 *
 * These were previously declared as endpoints and called from the UI. Each
 * one 404s against the real server, so they are recorded here instead —
 * both to stop them being re-added, and so screens can explain the gap
 * rather than fail silently.
 * ---------------------------------------------------------------------- */
export const UNSUPPORTED = {
  auth: {
    reason:
      'The archive has no authentication service. Archivist mode is an ' +
      'unauthenticated workspace in this build.',
    formerRoutes: ['POST /api/auth/login', 'POST /api/auth/logout'],
  },
  ocrQueueEndpoint: {
    reason:
      'There is no standalone OCR queue. The review queue is derived from ' +
      'manuscript pages whose review status is still pending.',
    formerRoutes: ['GET /api/ocr/queue', 'POST /api/ocr/correct/{id}', 'POST /api/ocr/approve/{id}'],
    useInstead: ['GET /api/manuscript/{id}', 'POST /api/manuscript/{id}/review',
                 'POST /api/manuscript/{id}/approve'],
  },
  versions: {
    reason:
      'Per-document version history is not stored. The append-only ' +
      'ingestion trail at /api/audit-log is the provenance record.',
    formerRoutes: ['GET /api/archivist/versions'],
    useInstead: ['GET /api/audit-log'],
  },
  stories: {
    reason:
      'Memorial stories are not a backend collection. They are composed in ' +
      'the frontend from timeline events and their linked sources.',
    formerRoutes: ['GET /api/stories', 'GET /api/stories/{id}'],
    useInstead: ['GET /api/timeline', 'GET /api/timeline/{id}'],
  },
};
