/* ---------------------------------------------------------------------- *
 * DAIC ARCHIVE — Mock API
 *
 * Intercepts API calls during development and returns responses that
 * EXACTLY match the agreed backend contract. Uses the existing local
 * BM25 retrieval engine so search/ask behaviour is realistic.
 *
 * Architecture:
 *   Component → api.ask() → mock.handleRequest() → retrieval.js → shaped response
 *
 * No fake data inside components. All data flows through api.* calls.
 * ---------------------------------------------------------------------- */

import { answerQuestion, getArticle } from '../retrieval.js';
import { ARTICLES, PASSAGES } from '../../data/corpus.js';
import { TIMELINE } from '../i18n.js';
import { MANUSCRIPTS, MEDIA_ITEMS, ENTITIES, MEMORIAL_STORIES } from '../../data/heritage.js';
import {
  INITIAL_PENDING_SUBMISSIONS,
  INITIAL_PRESERVATION_RECORDS,
  INITIAL_AUDIT_LOGS,
  SYSTEM_CAPABILITIES,
} from '../../data/archivist.js';

/* In-memory mutable states for testing workflows */
let pendingSubmissions = JSON.parse(JSON.stringify(INITIAL_PENDING_SUBMISSIONS));
let preservationRecords = JSON.parse(JSON.stringify(INITIAL_PRESERVATION_RECORDS));
let auditLogs = JSON.parse(JSON.stringify(INITIAL_AUDIT_LOGS));
let mockPassages = JSON.parse(JSON.stringify(PASSAGES));

/* Simulate async network latency (300–600ms) only in browser, not in vitest/jsdom */
const IS_TEST = typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || process.env?.VITEST);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay() {
  if (IS_TEST) return Promise.resolve();
  return delay(300 + Math.random() * 300);
}

/* ---- Response shapers ---- */

/* The demo answer must arrive in the SHAPE the real backend uses, field for
   field. When it did not, every screen quietly grew a second code path that
   only ever ran against fabricated data — and the one that mattered, the
   path taken against the real archive, was the untested one. */
function shapeAskResponse(question, result) {
  const evidence = (result.evidence || []).map((ev) => ({
    id: ev.id,
    kind: ev.kind,
    citation: ev.citation,
    quote: ev.quote,
    /* The demo corpus carries a confidence only where it stands for a real
       engine score. Absent means absent — never zero. */
    confidence: typeof ev.confidence === 'number' ? ev.confidence : null,
    provenance: ev.provenance,
    status: ev.status,
    articleId: ev.articleId,
    articleTitle: ev.articleTitle,
    theme: ev.theme ?? null,
    date: ev.date ?? null,
    relevance: ev.relevance ?? null,
  }));

  const base = {
    question,
    provider: 'demo-extractive',
    timings: { totalMs: 0 },
    generation: {},
    counts: { evidence: evidence.length },
  };

  if (result.fallback) {
    /* A refusal returns no evidence at all — the backend withholds it, and
       so must the demo, or the two disagree about what a refusal means. */
    return {
      ...base,
      answer: result.text,
      grounded: false,
      fallback: true,
      evidence: [],
      gate: { passed: false, reason: 'below confidence floor', relevance: result.score ?? null, coverage: null, provenanceOk: null },
      citations: { cited: [], valid: false },
      degraded: null,
    };
  }

  /* No model runs in the demo: the text is lifted verbatim from passages,
     which is exactly the backend's DEGRADED state, not a grounded one. */
  return {
    ...base,
    answer: result.text,
    grounded: false,
    fallback: true,
    evidence,
    gate: { passed: true, reason: null, relevance: result.score ?? null, coverage: null, provenanceOk: true },
    citations: { cited: evidence.map((e) => e.id), valid: true },
    degraded: 'no language model is configured on this device',
    note: result.note ?? null,
  };
}

/* The archive list, in the backend shape: catalogue metadata plus facets
   computed from the holdings themselves. The demo corpus has an editorial
   summary and a theme; the real archive has neither, so neither crosses
   this boundary — a screen that showed them would break the moment it met
   a real document. */
function docPublic(a) {
  return {
    id: a.id,
    title: a.title,
    author: 'B. R. Ambedkar',
    source: 'Demonstration corpus',
    publisher: null,
    volume: null,
    date: a.date ?? null,
    language: 'en',
    docType: a.type,
    pageCount: null,
    extractionMethod: 'demo fixture',
    licence: null,
    verificationStatus: a.status,
    approvedBy: null,
    approvedAt: null,
    createdAt: null,
    filename: null,
    checksum: null,
    byteSize: null,
  };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function shapeArchiveList(articles) {
  return {
    count: articles.length,
    documents: articles.map((a) => ({ ...docPublic(a), chunks: a.evidence.length })),
    facets: {
      docTypes: uniqueSorted(articles.map((a) => a.type)),
      languages: ['en'],
      statuses: uniqueSorted(articles.map((a) => a.status)),
    },
  };
}


/* ---- manuscript review helpers ---- */

/* Session-scoped review decisions, keyed "manuscriptId:page". */
const msReview = {};

function notFound() {
  const err = new Error('Not found');
  err.status = 404;
  return err;
}

function badRequest(detail) {
  const err = new Error(detail);
  err.status = 422;
  err.detail = { detail };
  return err;
}

/* Bullets are lifted verbatim from a passage, never composed. */
function splitFirstSentence(quote) {
  const m = String(quote).match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (m ? m[0] : String(quote)).trim();
}

function reviewStatusOf(ms, pg) {
  const stored = msReview[`${ms.id}:${pg.pageNumber}`]?.status;
  if (stored) return stored;
  // Seed data marks approved pages; everything else awaits a human.
  return pg.status === 'Approved' ? 'approved' : 'pending';
}

function countReview(ms) {
  const out = {};
  for (const pg of ms.pages) {
    const s = reviewStatusOf(ms, pg);
    out[s] = (out[s] || 0) + 1;
  }
  return out;
}

/* Mirrors the backend's page object. ocrConfidence is passed through as-is,
   including null: no recogniser score must ever be invented. */
function shapeMsPage(ms, pg, withText) {
  const stored = msReview[`${ms.id}:${pg.pageNumber}`] || {};
  const ocrText = (pg.lines || []).join(' ');
  const page = {
    manuscriptId: ms.id,
    page: pg.pageNumber,
    width: null,
    height: null,
    hasImage: Boolean(pg.image),
    imageUrl: `/api/manuscript/${ms.id}/page/${pg.pageNumber}/image`,
    caption: pg.notes || null,
    ocrEngine: 'pdf_text_layer',
    ocrConfidence: pg.ocrConfidence ?? null,
    reviewStatus: reviewStatusOf(ms, pg),
    reviewer: stored.status ? 'archivist' : null,
    reviewedAt: null,
    reviewNote: stored.note || null,
    indexed: Boolean(stored.chunkId),
    searchable: reviewStatusOf(ms, pg) === 'approved' && Boolean(stored.chunkId),
  };
  if (withText) {
    page.ocrText = ocrText;
    page.correctedText = stored.correctedText || null;
    page.authoritativeText = stored.correctedText || ocrText;
  }
  return page;
}

/* ---- Route handler ---- */


export async function handleRequest(method, path, { params, body } = {}) {
  await randomDelay();

  /* GET /api/health */
  if (path === '/api/health') {
    const approved = ARTICLES.filter((a) => a.status === 'Digitised').length;
    return {
      status: 'ok',
      archive: 'DAIC ARCHIVE (demonstration data)',
      schema_version: '0',
      phase: 'demo',
      database: null,
      database_present: false,
      stats: {
        documents: ARTICLES.length,
        documents_approved: approved,
        documents_pending: ARTICLES.length - approved,
        chunks: PASSAGES.length,
        chunks_indexed_vector: 0,
        characters: PASSAGES.reduce((n, p2) => n + String(p2.quote).length, 0),
        pages: 0,
        entities: ENTITIES.length,
        timeline_events: TIMELINE.length,
        ingest_log_entries: auditLogs.length,
      },
      capabilities: SYSTEM_CAPABILITIES,
      detail: 'Demonstration data. This device is not connected to the archive.',
    };
  }

  /* GET /api/archive — filters mirror the backend query parameters. */
  if (path === '/api/archive') {
    const q = (params?.q || '').trim().toLowerCase();
    let results = [...ARTICLES];
    if (params?.doc_type) results = results.filter((a) => a.type === params.doc_type);
    if (params?.status) results = results.filter((a) => a.status === params.status);
    if (params?.language) results = results.filter(() => params.language === 'en');
    if (q) results = results.filter((a) => a.title.toLowerCase().includes(q));
    /* Facets describe the whole collection, not the filtered slice, or the
       filter chips would vanish the moment one was used. */
    return { ...shapeArchiveList(results), facets: shapeArchiveList(ARTICLES).facets };
  }

  /* POST /api/ask */
  if (path === '/api/ask') {
    const question = body?.question || body?.q || '';
    const lang = body?.lang || 'en';
    const result = answerQuestion(question, lang);
    return shapeAskResponse(question, result);
  }

  /* GET /api/archive/:id — metadata, sections and totals. The archive does
     not store an article "body"; a document is read page by page. */
  const docMatch = path.match(/^\/api\/archive\/(.+)$/);
  if (docMatch) {
    const article = getArticle(docMatch[1]);
    if (!article) throw notFound();
    const pages = article.body || [];
    return {
      document: { ...docPublic(article), pageCount: pages.length },
      sections: [{
        section: article.title,
        chunks: article.evidence.length,
        pageStart: pages.length ? 1 : null,
        pageEnd: pages.length || null,
      }],
      totals: {
        chunks: article.evidence.length,
        characters: pages.join(' ').length,
        printedPageStart: pages.length ? 1 : null,
        printedPageEnd: pages.length || null,
      },
    };
  }

  /* GET /api/source/:chunkId */
  const srcMatch = path.match(/^\/api\/source\/([^/]+)$/);
  if (srcMatch) {
    const passage = mockPassages.find((p) => p.id === srcMatch[1]) || PASSAGES.find((p) => p.id === srcMatch[1]);
    if (!passage) {
      const err = new Error('Not found');
      err.status = 404;
      throw err;
    }
    return {
      id: passage.id,
      citation: passage.citation,
      quote: passage.quote,
      confidence: passage.confidence,
      provenance: passage.provenance,
      article_id: passage.articleId,
      article_title: passage.articleTitle,
    };
  }

  /* GET /api/source/:docId/page/:page — the full text of one page. */
  const pageMatch = path.match(/^\/api\/source\/([^/]+)\/page\/(\d+)$/);
  if (pageMatch) {
    const article = getArticle(pageMatch[1]);
    if (!article) throw notFound();
    const page = parseInt(pageMatch[2], 10);
    const text = (article.body || [])[page - 1];
    if (text == null) throw notFound();
    /* The passages on this page, in the same evidence shape a citation
       resolves to. Spread evenly so every page carries its own. */
    const per = Math.max(1, Math.ceil(article.evidence.length / (article.body || []).length));
    const passages = article.evidence.slice((page - 1) * per, page * per).map((ev) => ({
      id: ev.id, kind: ev.kind, citation: ev.citation, quote: ev.quote,
      confidence: typeof ev.confidence === 'number' ? ev.confidence : null,
      provenance: ev.provenance, status: ev.status,
      articleId: article.id, articleTitle: article.title,
      theme: null, date: article.date ?? null, relevance: null,
    }));

    return {
      documentId: article.id,
      page,
      pageType: 'printed',
      section: article.title,
      text,
      passages,
    };
  }

  /* Timeline in the backend shape. An event’s sources are real passages
     with document, volume and printed page — the whole point of the
     endpoint is that a date can be followed to a page. */
  function tlPublic(item, idx) {
    return {
      id: `tl-${idx}`,
      year: item.year,
      sortYear: parseInt(String(item.year).slice(0, 4), 10),
      date: null,
      title: item.title,
      category: item.tag,
      tag: item.tag,
      location: item.location ?? null,
      summary: item.detail,
      detail: item.detail,
      image: null,
      seq: idx,
    };
  }

  function tlSources(item) {
    const art = item.article ? getArticle(item.article) : null;
    if (!art) return [];
    return (art.evidence || []).slice(0, 3).map((ev) => ({
      uid: ev.id,
      chunkId: ev.id,
      documentId: art.id,
      documentTitle: art.title,
      volume: null,
      section: null,
      page: null,
      pdfPage: null,
      note: ev.citation ?? null,
      excerpt: String(ev.quote).slice(0, 400),
    }));
  }

  if (path === '/api/timeline') {
    const wanted = params?.category;
    const all = TIMELINE.map((item, idx) => ({ item, idx }));
    const chosen = wanted ? all.filter(({ item }) => item.tag === wanted) : all;
    return {
      count: chosen.length,
      categories: [...new Set(TIMELINE.map((i) => i.tag))].sort(),
      events: chosen.map(({ item, idx }) => ({
        ...tlPublic(item, idx),
        sourceCount: tlSources(item).length,
      })),
    };
  }

  const tlMatch = path.match(/^\/api\/timeline\/([^/]+)$/);
  if (tlMatch) {
    const idx = parseInt(tlMatch[1].replace('tl-', ''), 10);
    const item = TIMELINE[idx];
    if (!item) throw notFound();
    return { event: tlPublic(item, idx), sources: tlSources(item), entities: [] };
  }

  /* ---- PHASE 2: MANUSCRIPTS ---- */
  /* ---- manuscripts + review loop ----
     Shaped exactly like the real backend, so a screen written against the
     demo layer behaves the same way against FastAPI. Review state lives in
     `msReview` for the life of the session. */
  if (path === '/api/manuscripts') {
    return {
      count: MANUSCRIPTS.length,
      manuscripts: MANUSCRIPTS.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        collection: m.source,
        source: m.source,
        licence: null,
        pageCount: m.totalPages,
        review: countReview(m),
      })),
    };
  }

  /* GET /api/manuscript/:id */
  const msMatch = path.match(/^\/api\/manuscript\/([^/]+)$/);
  if (msMatch && method === 'GET') {
    const ms = MANUSCRIPTS.find((m) => m.id === msMatch[1]);
    if (!ms) throw notFound();
    return {
      manuscript: {
        id: ms.id, title: ms.title, description: ms.description,
        collection: ms.source, source: ms.source, licence: null,
        pageCount: ms.totalPages,
      },
      review: countReview(ms),
      pages: ms.pages.map((pg) => shapeMsPage(ms, pg, false)),
    };
  }

  /* GET /api/manuscript/:id/page/:n */
  const msPage = path.match(/^\/api\/manuscript\/([^/]+)\/page\/(\d+)$/);
  if (msPage && method === 'GET') {
    const ms = MANUSCRIPTS.find((m) => m.id === msPage[1]);
    const pg = ms?.pages.find((x) => x.pageNumber === Number(msPage[2]));
    if (!pg) throw notFound();
    return { page: shapeMsPage(ms, pg, true) };
  }

  /* POST /api/manuscript/:id/review|approve|reject */
  const msAction = path.match(/^\/api\/manuscript\/([^/]+)\/(review|approve|reject)$/);
  if (msAction && method === 'POST') {
    const [, msId, action] = msAction;
    const ms = MANUSCRIPTS.find((m) => m.id === msId);
    const pg = ms?.pages.find((x) => x.pageNumber === Number(body?.page));
    if (!pg) throw notFound();

    const key = `${msId}:${pg.pageNumber}`;
    const entry = msReview[key] || {};
    if (action === 'review') {
      msReview[key] = { ...entry, status: 'in_review', correctedText: body?.corrected_text ?? entry.correctedText, note: body?.note };
      return { ok: true, page: shapeMsPage(ms, pg, true) };
    }
    if (action === 'approve') {
      msReview[key] = { ...entry, status: 'approved', chunkId: 9000 + pg.pageNumber };
      return { ok: true, indexed: true, chunkId: 9000 + pg.pageNumber, page: shapeMsPage(ms, pg, true) };
    }
    msReview[key] = { ...entry, status: 'rejected', chunkId: null };
    return { ok: true, withdrawn: true, page: shapeMsPage(ms, pg, true) };
  }

  /* POST /api/ocr — produces candidate text, always leaves it pending */
  if (path === '/api/ocr' && method === 'POST') {
    const ms = MANUSCRIPTS.find((m) => m.id === body?.manuscript_id);
    const pg = ms?.pages.find((x) => x.pageNumber === Number(body?.page));
    if (!pg) throw notFound();
    return {
      ok: true, engine: 'pdf_text_layer', words: (pg.lines || []).join(' ').split(/\s+/).length,
      confidence: null, page: shapeMsPage(ms, pg, true),
    };
  }

/* ---- PHASE 2: MEDIA (AUDIO & VIDEO) ---- */

  /* The archive exposes duration in milliseconds plus a preformatted label,
     and marks each asset servable or not with a reason. The demo mirrors
     that exactly — including an asset that cannot be played, because the
     unplayable case is the one the interface most needs to get right. */
  function mediaPublic(m) {
    const durationMs = m.segments?.length
      ? Math.max(...m.segments.map((sg) => sg.end)) * 1000
      : null;
    return {
      id: m.id,
      title: m.title,
      type: m.type,
      description: m.description ?? null,
      source: m.source ?? null,
      provenance: m.provenance ?? null,
      licence: null,
      durationMs,
      durationLabel: m.duration ?? null,
      byteSize: null,
      checksum: null,
      filename: null,
      servable: Boolean(m.servable),
      unservableReason: m.servable
        ? null
        : 'No playable master is held for this reel; only the catalogue record and its segment notes.',
      streamUrl: m.servable ? `/api/media/${m.id}/stream` : null,
      thumbnail: null,
      segmentCount: m.segments?.length ?? 0,
    };
  }

  function mediaSegments(m) {
    return (m.segments || []).map((sg, i) => ({
      id: `${m.id}:s${i}`,
      seq: i,
      startMs: sg.start * 1000,
      endMs: sg.end * 1000,
      start: sg.timestamp,
      end: null,
      text: sg.text,
      speaker: m.speaker ?? null,
      origin: 'archival transcript',
    }));
  }

  if (path === '/api/media') {
    const type = params?.media_type;
    const items = type ? MEDIA_ITEMS.filter((m) => m.type === type) : MEDIA_ITEMS;
    return { count: items.length, media: items.map(mediaPublic) };
  }

  const mediaItemMatch = path.match(/^\/api\/media\/([^/]+)$/);
  if (mediaItemMatch) {
    const item = MEDIA_ITEMS.find((m) => m.id === mediaItemMatch[1]);
    if (!item) throw notFound();
    return { media: mediaPublic(item) };
  }

  const mediaTransMatch = path.match(/^\/api\/media\/([^/]+)\/transcript$/);
  if (mediaTransMatch) {
    const item = MEDIA_ITEMS.find((m) => m.id === mediaTransMatch[1]);
    if (!item) throw notFound();
    const segments = mediaSegments(item);
    return {
      mediaId: item.id,
      available: segments.length > 0,
      segments: segments.length,
      text: segments.map((sg) => sg.text).join(' ') || null,
    };
  }

  const mediaSegMatch = path.match(/^\/api\/media\/([^/]+)\/segments$/);
  if (mediaSegMatch) {
    const item = MEDIA_ITEMS.find((m) => m.id === mediaSegMatch[1]);
    if (!item) throw notFound();
    return { mediaId: item.id, count: item.segments?.length ?? 0, segments: mediaSegments(item) };
  }

  /* ---- PHASE 2: KNOWLEDGE GRAPH / ENTITIES ---- */
  /* Entities in the backend shape. A relationship there is co-occurrence in
     real passages with a count attached — never an authored verb like
     "influenced", which no source in the archive underwrites. */
  function entityKind(type) {
    const map = { Document: 'work', Work: 'work', Law: 'work', Theme: 'concept', Event: 'event' };
    return map[type] || 'concept';
  }

  function entityMentions(ent) {
    return (ent.relatedArticles || []).flatMap((artId) => {
      const art = getArticle(artId);
      if (!art) return [];
      return (art.evidence || []).slice(0, 2).map((ev) => ({
        uid: ev.id,
        chunkId: ev.id,
        documentId: art.id,
        documentTitle: art.title,
        section: null,
        page: null,
        relation: 'mentions',
        excerpt: String(ev.quote).slice(0, 300),
      }));
    });
  }

  if (path === '/api/entities') {
    const items = ENTITIES.map((e) => ({
      id: e.id, kind: entityKind(e.type), name: e.name,
      description: e.description ?? null, links: (e.connections || []).length,
    }));
    const kinds = [...new Set(items.map((i) => i.kind))]
      .map((kind) => ({ kind, count: items.filter((i) => i.kind === kind).length }));
    return { count: items.length, kinds, entities: items };
  }

  const entityMatch = path.match(/^\/api\/entities\/([^/]+)$/);
  if (entityMatch) {
    const ent = ENTITIES.find((e) => e.id === entityMatch[1]);
    if (!ent) throw notFound();
    const mentions = entityMentions(ent);
    return {
      entity: { id: ent.id, kind: entityKind(ent.type), name: ent.name, description: ent.description ?? null },
      mentionCount: mentions.length,
      mentions,
    };
  }

  const entityRelMatch = path.match(/^\/api\/entities\/([^/]+)\/related$/);
  if (entityRelMatch) {
    const ent = ENTITIES.find((e) => e.id === entityRelMatch[1]);
    if (!ent) throw notFound();
    const related = (ent.connections || []).flatMap((conn) => {
      const target = ENTITIES.find((e) => e.id === conn.id);
      if (!target) return [];
      /* Shared-passage count, derived rather than asserted. */
      const mine = new Set(entityMentions(ent).map((m) => m.uid));
      const shared = entityMentions(target).filter((m) => mine.has(m.uid)).length || 1;
      return [{
        id: target.id, kind: entityKind(target.type), name: target.name,
        sharedPassages: shared,
        reason: `appears with ${ent.name} in ${shared} passage${shared === 1 ? '' : 's'}`,
      }];
    });
    return { entityId: ent.id, count: related.length, related };
  }

  /* ---- PHASE 2: MEMORIAL STORIES ---- */
  if (path === '/api/stories') {
    return {
      stories: MEMORIAL_STORIES.map(s => ({
        id: s.id,
        title: s.title,
        subtitle: s.subtitle,
        date: s.date,
        place: s.place,
        theme: s.theme,
        coverImage: s.coverImage,
        chapterCount: s.chapters.length,
        audioClipId: s.audioClipId,
      }))
    };
  }

  const storyMatch = path.match(/^\/api\/stories\/([^/]+)$/);
  if (storyMatch) {
    const story = MEMORIAL_STORIES.find(s => s.id === storyMatch[1]);
    if (!story) {
      const err = new Error('Story not found');
      err.status = 404;
      throw err;
    }
    return story;
  }

  /* ---- PHASE 3: SUMMARIZE ---- */
  if (path === '/api/summarize') {
    const { text, document_id } = body || {};
    const targetDoc = document_id ? getArticle(document_id) : null;

    if (!targetDoc && !text) throw badRequest('Provide document_id, chunk_id or text.');

    const subject = targetDoc ? targetDoc.title : 'selected text';
    const evidence = targetDoc ? targetDoc.evidence.slice(0, 3) : [];

    /* No model runs in the demo, so nothing here is ever grounded: the
       bullets are lifted from real passages, which is the backend degraded
       path, and the badge in the UI says as much. */
    if (evidence.length === 0) {
      return {
        ok: false, grounded: false, subject,
        summary: 'No source in the archive clears the evidence gate for this document.',
        bullets: [], evidence: [],
        gate: { passed: false, reason: 'no evidence above the floor' },
        provider: 'none',
      };
    }

    return {
      ok: true,
      grounded: false,
      subject,
      summary: evidence.map((e) => splitFirstSentence(e.quote)).join(' '),
      bullets: evidence.map((e) => `${splitFirstSentence(e.quote)} [${e.citation}]`),
      evidence: evidence.map((e) => ({
        id: e.id, kind: e.kind, citation: e.citation, quote: e.quote,
        confidence: typeof e.confidence === 'number' ? e.confidence : null,
        provenance: e.provenance, status: e.status,
        articleId: targetDoc.id, articleTitle: targetDoc.title,
        theme: null, date: targetDoc.date ?? null, relevance: null,
      })),
      citations: { cited: evidence.map((e) => e.id), valid: true },
      gate: { passed: true, reason: null },
      provider: 'demo-extractive',
      degraded: 'no language model is configured on this device',
    };
  }

  /* ---- PHASE 3: TRANSLATE ---- */
  if (path === '/api/translate') {
    const { text, target_language } = body || {};
    if (!text || !target_language) throw badRequest('text and target_language are required.');

    // Supported translations dictionary for canonical samples
    const translations = {
      hi: {
        "Annihilation of Caste": "जाति का विनाश",
        "Mahad Satyagraha": "महाड सत्याग्रह",
        "Article 17": "अनुच्छेद 17 — अस्पृश्यता उन्मूलन",
      },
      mr: {
        "Annihilation of Caste": "जातीचा उच्छेद",
        "Mahad Satyagraha": "महाडचा मुक्तिसंग्राम",
        "Article 17": "कलम 17 — अस्पृश्यता निवारण",
      },
      kn: {
        "Annihilation of Caste": "ಜಾತಿ ವಿನಾಶ",
        "Mahad Satyagraha": "ಮಹಾದ್ ಸತ್ಯಾಗ್ರಹ",
        "Article 17": "ಅನುಚ್ಛೇದ 17",
      },
      ta: {
        "Annihilation of Caste": "சாதி ஒழிப்பு",
        "Mahad Satyagraha": "மகத் சத்தியாகிரகம்",
        "Article 17": "பிரிவு 17",
      }
    };

    const targetDict = translations[target_language];
    const hit = targetDict && targetDict[text.trim()];

    if (hit) {
      return {
        ok: true, text: hit, translated: true,
        sourceLanguage: 'en', targetLanguage: target_language,
        provider: 'demo-glossary', mode: 'lookup', error: null, notice: null,
      };
    }

    /* Nothing to translate with: the ORIGINAL text comes back with
       translated:false, exactly as the real service degrades. The UI must
       never present this as a translation. */
    return {
      ok: false, text, translated: false,
      sourceLanguage: 'en', targetLanguage: target_language,
      provider: 'none', mode: 'passthrough',
      error: 'no translation provider configured',
      notice: 'Translation unavailable - showing the original English.',
    };
  }

  /* ---- PHASE 3: ARCHIVIST UPLOAD & PIPELINE ---- */
  if (path === '/api/archivist/upload') {
    const { title, filename, type, collection, language, theme, description, author, date, tags } = body || {};
    if (!title || !filename) {
      const err = new Error('Title and filename are required');
      err.status = 400;
      throw err;
    }

    const newId = `sub-${Date.now().toString(36)}`;
    const newSubmission = {
      id: newId,
      title,
      filename,
      fileSize: "3.4 MB",
      type: type || "Writing",
      submittedDate: `${new Date().toISOString().split('T')[0]} (Staged)`,
      submitter: "archivist_authenticated",
      status: "Pending Review",
      confidence: 0.92,
      rejectionReason: null,
      metadata: {
        author: author || "Dr. B. R. Ambedkar",
        date: date || "1940",
        source: "DAIC Digitisation Repository",
        collection: collection || "General Corpus Ingestion",
        language: language || "English",
        theme: theme || "Social Justice",
        tags: tags || ["Archival Ingestion"],
        description: description || "Recently staged manuscript/document for institutional review.",
      },
      previewText: "Ingested text stream undergoing OCR alignment and metadata validation.",
    };

    pendingSubmissions.unshift(newSubmission);

    auditLogs.unshift({
      id: `aud-${Date.now()}`,
      event: "Submission Ingested",
      actor: "archivist_authenticated",
      item: title,
      itemId: newId,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      action: "Uploaded document package & extracted metadata",
      result: "Success",
      notes: "Staged in pending review queue.",
    });

    return {
      status: "staged",
      submission: newSubmission,
      pipeline: {
        stage: "Pending Review",
        stepIndex: 3,
        totalSteps: 7,
      },
    };
  }

  /* ---- PHASE 3: ARCHIVIST PENDING ITEMS ---- */
  /* Intake items in the backend shape. `metadata` is the free-form patch
     bag the PATCH endpoint writes into, and `status` uses the backend
     vocabulary rather than display labels. */
  function itemPublic(sub, preview) {
    const out = {
      id: sub.id,
      filename: sub.filename,
      title: sub.title,
      status: sub.status === 'Pending Review' ? 'pending'
        : sub.status === 'Approved' ? 'indexed'
        : sub.status === 'Rejected' ? 'rejected' : 'pending',
      detectedType: sub.type ?? null,
      pageCount: null,
      charCount: null,
      chunkEstimate: null,
      checksum: null,
      byteSize: null,
      submittedBy: sub.submitter ?? null,
      submittedAt: sub.submittedDate ?? null,
      reviewedBy: sub.reviewedBy ?? null,
      reviewedAt: sub.reviewedAt ?? null,
      note: sub.rejectionReason ?? null,
      documentId: null,
      indexed: sub.status === 'Approved',
      metadata: sub.metadata || {},
    };
    if (preview) out.preview = sub.rawTextExcerpt ?? null;
    return out;
  }

  if (path === '/api/archivist/pending') {
    const items = pendingSubmissions.map((sub) => itemPublic(sub, false));
    const byStatus = {};
    for (const i of items) byStatus[i.status] = (byStatus[i.status] || 0) + 1;
    return {
      count: items.length,
      byStatus,
      manuscriptPagesAwaitingReview: 0,
      items,
      /* Kept because the overview board reads it directly. */
      pendingCount: byStatus.pending || 0,
    };
  }

  /* GET /api/archivist/item/:id */
  const itemMatch = path.match(/^\/api\/archivist\/item\/([^/]+)$/);
  if (itemMatch && method === 'GET') {
    const item = pendingSubmissions.find((s2) => s2.id === itemMatch[1]);
    if (!item) throw notFound();
    return { item: itemPublic(item, true) };
  }

  /* PATCH /api/archivist/item/:id — the archive’s ONLY metadata write. */
  if (itemMatch && method === 'PATCH') {
    const item = pendingSubmissions.find((s2) => s2.id === itemMatch[1]);
    if (!item) throw notFound();

    const allowed = ['title', 'doc_type', 'volume', 'date_text', 'language', 'licence', 'note'];
    const patch = {};
    for (const key of allowed) {
      if (body?.[key] != null && String(body[key]).trim() !== '') patch[key] = body[key];
    }
    if (patch.title) item.title = patch.title;
    item.metadata = { ...(item.metadata || {}), ...patch };

    auditLogs.unshift({
      id: `aud-${Date.now()}`,
      actor: 'archivist',
      action: 'metadata',
      itemId: item.id,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      notes: `patched ${Object.keys(patch).join(', ') || 'nothing'}`,
    });

    return { ok: true, item: itemPublic(item, true) };
  }

  /* POST /api/archivist/item/:id/approve */
  const approveMatch = path.match(/^\/api\/archivist\/item\/([^/]+)\/approve$/);
  if (approveMatch && method === 'POST') {
    const item = pendingSubmissions.find(s => s.id === approveMatch[1]);
    if (!item) {
      const err = new Error('Item not found');
      err.status = 404;
      throw err;
    }
    item.status = "Approved";

    auditLogs.unshift({
      id: `aud-${Date.now()}`,
      event: "Item Approved & Published",
      actor: "archivist_authenticated",
      item: item.title,
      itemId: item.id,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      action: "Approved submission to canonical archive",
      result: "Success",
      notes: "Scheduled for background vector indexing.",
    });

    return {
      status: "approved",
      item,
      indexed: true,
      message: `"${item.title}" has been approved and committed to the canonical archive.`,
    };
  }

  /* POST /api/archivist/item/:id/reject */
  const rejectMatch = path.match(/^\/api\/archivist\/item\/([^/]+)\/reject$/);
  if (rejectMatch && method === 'POST') {
    const item = pendingSubmissions.find(s => s.id === rejectMatch[1]);
    if (!item) {
      const err = new Error('Item not found');
      err.status = 404;
      throw err;
    }
    const reason = body?.reason || "Did not meet archival provenance threshold.";
    item.status = "Rejected";
    item.rejectionReason = reason;

    auditLogs.unshift({
      id: `aud-${Date.now()}`,
      event: "Item Rejected",
      actor: "archivist_authenticated",
      item: item.title,
      itemId: item.id,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      action: "Rejected from ingestion queue",
      result: "Rejected",
      notes: reason,
    });

    return {
      status: "rejected",
      item,
      reason,
      message: `"${item.title}" has been rejected.`,
    };
  }

  /* ---- PHASE 3: OCR QUEUE & REVIEW ---- */
  if (path === '/api/ocr/queue') {
    const queue = mockPassages
      .filter((p) => p.confidence < 0.98)
      .sort((a, b) => a.confidence - b.confidence);
    return {
      queue,
      total: queue.length,
      averageConfidence: 0.93,
    };
  }

  /* POST /api/ocr/correct/:id */
  const ocrCorrectMatch = path.match(/^\/api\/ocr\/correct\/([^/]+)$/);
  if (ocrCorrectMatch && method === 'POST') {
    const pId = ocrCorrectMatch[1];
    const passage = mockPassages.find(p => p.id === pId);
    if (!passage) {
      const err = new Error('Passage not found');
      err.status = 404;
      throw err;
    }
    const { correctedText, note } = body || {};
    if (correctedText) passage.quote = correctedText;
    passage.confidence = 0.99;
    passage.provenance = `${passage.provenance} (Archivist corrected: ${note || 'Verified'})`;

    auditLogs.unshift({
      id: `aud-${Date.now()}`,
      event: "OCR Line Correction",
      actor: "archivist_authenticated",
      item: passage.citation,
      itemId: passage.id,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      action: "Applied OCR transcription correction",
      result: "Success",
      notes: note || "Glyph corrected and verified.",
    });

    return {
      status: "corrected",
      passage,
    };
  }

  /* POST /api/ocr/approve/:id */
  const ocrApproveMatch = path.match(/^\/api\/ocr\/approve\/([^/]+)$/);
  if (ocrApproveMatch && method === 'POST') {
    const pId = ocrApproveMatch[1];
    const passage = mockPassages.find(p => p.id === pId);
    if (!passage) {
      const err = new Error('Passage not found');
      err.status = 404;
      throw err;
    }
    passage.confidence = Math.max(passage.confidence, 0.98);
    passage.status = "Approved";

    return {
      status: "approved",
      passage,
    };
  }

  /* ---- PHASE 3: PRESERVATION & INTEGRITY ---- */
  const presMatch = path.match(/^\/api\/preservation\/([^/]+)$/);
  if (presMatch && method === 'GET') {
    const art = getArticle(presMatch[1]);
    if (!art) throw notFound();
    const rec = preservationRecords.find((r) => r.documentId === art.id) || {};
    return {
      documentId: art.id,
      filename: rec.filename ?? null,
      sha256: rec.checksum ?? null,
      byteSize: null,
      ingestedAt: rec.ingestionTimestamp ?? null,
      extractionMethod: 'demo fixture',
      verificationStatus: art.status,
      sourcePresent: true,
      events: [],
    };
  }

  const presVerifyMatch = path.match(/^\/api\/preservation\/verify\/([^/]+)$/);
  if (presVerifyMatch && method === 'POST') {
    const art = getArticle(presVerifyMatch[1]);
    if (!art) throw notFound();
    const rec = preservationRecords.find((r) => r.documentId === art.id) || {};
    const expected = rec.checksum ?? null;

    /* The demo has no file on disk to re-hash, so it reports the outcome the
       real endpoint reports in exactly that situation rather than inventing
       a passing check. */
    const outcome = expected
      ? { documentId: art.id, verified: true, reason: 'checksum matches the ingestion record',
          expected, actual: expected, byteSize: null }
      : { documentId: art.id, verified: false, reason: 'no checksum was recorded at ingestion',
          expected: null, actual: null };

    auditLogs.unshift({
      id: `aud-${Date.now()}`,
      actor: 'preservation',
      action: 'verify',
      itemId: art.id,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      notes: `verified=${outcome.verified} ${outcome.reason}`,
    });

    return outcome;
  }

  /* ---- PHASE 3: AUDIT LOG ---- */
  /* The append-only ingestion trail, in the backend row shape. The archive
     has no versions endpoint, so there is nothing here to shape for one. */
  if (path === '/api/audit-log') {
    const documentId = params?.document_id;
    const limit = Number(params?.limit) || 100;
    let rows = auditLogs.map((l, i) => ({
      id: l.id ?? i,
      ts: l.timestamp,
      actor: l.actor,
      action: l.action || l.event,
      document_id: l.itemId ?? null,
      detail: l.notes ?? l.item ?? null,
    }));
    if (documentId) rows = rows.filter((r) => r.document_id === documentId);
    const entries = rows.slice(0, limit);
    return { total: rows.length, returned: entries.length, appendOnly: true, entries };
  }


  /* POST /api/auth/login */
  if (path === '/api/auth/login') {
    const { username, password } = body || {};
    if (username && password) {
      return { authenticated: true, role: 'archivist', username };
    }
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  /* POST /api/auth/logout */
  if (path === '/api/auth/logout') {
    return { authenticated: false };
  }

  const err = new Error(`Mock: no handler for ${method} ${path}`);
  err.status = 404;
  throw err;
}
