/* ---------------------------------------------------------------------- *
 * DAIC ARCHIVE — API client
 *
 * Requests go to the real backend by default. In development Vite proxies
 * /api to the FastAPI service; in production FastAPI serves this bundle,
 * so the same relative paths work untouched.
 *
 * The demo layer is OPT-IN. It used to be the default whenever no API base
 * was configured, which meant the archive silently showed fabricated data
 * and nobody could tell. It now switches on only when explicitly asked
 * for, and when it is on the interface says so.
 * ---------------------------------------------------------------------- */

const API_BASE = import.meta.env.VITE_API_BASE || '';

const flag = import.meta.env.VITE_USE_MOCK;
const explicitlyOn = flag === 'true' || flag === '1';
const explicitlyOff = flag === 'false' || flag === '0';

/* Tests need deterministic data and never have a server, so they use the
   demo layer unless a test opts out. Nothing else defaults to it. */
export const IS_MOCK =
  explicitlyOn || (!explicitlyOff && import.meta.env.MODE === 'test');

/** True when the interface should warn that it is not showing the archive. */
export const SHOW_MOCK_NOTICE = IS_MOCK && import.meta.env.MODE !== 'test';

let mockModule = null;
async function getMock() {
  if (!mockModule) mockModule = await import('./mock.js');
  return mockModule;
}

/**
 * An error that carries enough for a screen to explain itself: a status,
 * the backend's own `detail` where there is one, and a message safe to
 * show a visitor.
 */
export class ApiError extends Error {
  constructor(message, { status = 0, detail = null, path = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.path = path;
  }

  /** Wording for the reader, never a raw status line. */
  get userMessage() {
    if (this.status === 0) return 'The archive service is not reachable from this device.';
    if (this.status === 404) return 'That item is not in the archive.';
    if (this.status === 409) return this.detail?.detail || 'That action conflicts with the archive’s current state.';
    if (this.status === 422) return 'That request was not valid.';
    if (this.status === 503) return this.detail?.detail || 'That part of the archive is unavailable right now.';
    if (this.status >= 500) return 'The archive service had a problem completing that request.';
    return this.detail?.detail || this.message;
  }
}

async function request(method, path, { params, body, signal } = {}) {
  if (IS_MOCK) {
    const mock = await getMock();
    return mock.handleRequest(method, path, { params, body });
  }

  const url = new URL(path, API_BASE || window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') url.searchParams.set(k, v);
    }
  }

  const opts = { method, headers: { 'Content-Type': 'application/json' }, signal };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url.toString(), opts);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    // Offline, refused connection, DNS — the archive simply is not there.
    throw new ApiError('Network request failed', { status: 0, path });
  }

  if (!res.ok) {
    let detail = null;
    try { detail = await res.json(); } catch { /* no body */ }
    throw new ApiError(`API ${method} ${path}: ${res.status}`, {
      status: res.status, detail, path,
    });
  }

  if (res.status === 204) return null;
  return res.json();
}

export const get = (path, params, opts) => request('GET', path, { params, ...opts });
export const post = (path, body, opts) => request('POST', path, { body, ...opts });
export const patch = (path, body, opts) => request('PATCH', path, { body, ...opts });
export const del = (path, opts) => request('DELETE', path, opts);
