// Minimal Vidmoat REST client (https://developer.vidmoat.com/developer/docs/api).
// Only the documented v1 routes StudyTok needs. The API key never leaves the server.

import { config } from './config.js';

export class VidmoatError extends Error {
  constructor(status, body) {
    const err = body?.error || {};
    super(err.message || `Vidmoat HTTP ${status}`);
    this.name = 'VidmoatError';
    this.status = status;
    this.code = err.code || `http_${status}`;
    this.details = err;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Low-level request. Retries only what the docs mark as safe to retry:
 * 429 rate_limited and 503 unavailable (both carry Retry-After), and 502 provider_error on reads.
 * POSTs are never retried after a timeout or a lost response: the API has no idempotency key,
 * and a resent commands batch would add its clips twice.
 */
export async function vidmoat(method, path, { body, query, retries = 3, timeoutMs = 120_000 } = {}) {
  if (!config.vidmoat.apiKey) throw new Error('VIDMOAT_API_KEY is not set. Copy .env.example to .env.');
  const url = new URL(config.vidmoat.baseUrl + path);
  for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, String(v));

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.vidmoat.apiKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json() : await res.arrayBuffer();
    if (res.ok) return data;

    const retryable = res.status === 429 || res.status === 503 || (res.status === 502 && method === 'GET');
    if (retryable && attempt < retries) {
      const after = Number(res.headers.get('retry-after')) || data?.error?.retryAfterSec || 2 ** attempt;
      await sleep(Math.min(after, 30) * 1000);
      continue;
    }
    throw new VidmoatError(res.status, data);
  }
}

// ---- Typed helpers -------------------------------------------------------------------------

export const getMe = () => vidmoat('GET', '/v1/me');

/** Create a project and apply a first batch of commands in the same call. */
export const createProject = (name, commands) =>
  vidmoat('POST', '/v1/projects', { body: { name: name.slice(0, 80), commands }, retries: 0 });

export const applyCommands = (id, commands, { dryRun = false } = {}) =>
  vidmoat('POST', `/v1/projects/${encodeURIComponent(id)}/commands`, { body: { commands, dryRun }, retries: 0 });

/** The full edit document: exactly what the editor, the renderer and the embed player read. */
export const getDocument = async (id) =>
  (await vidmoat('GET', `/v1/projects/${encodeURIComponent(id)}`, { query: { view: 'document' } })).project.document;

export const deleteProject = (id) => vidmoat('DELETE', `/v1/projects/${encodeURIComponent(id)}`, { retries: 1 });

export const fileProject = (id, workspaceId) =>
  vidmoat('PUT', `/v1/projects/${encodeURIComponent(id)}/workspace`, { body: { workspaceId } });

/** Free. type: video | image | audio. */
export const searchStock = async (query, type = 'video', limit = 12) =>
  (await vidmoat('GET', '/v1/stock/search', { query: { query, type, limit } })).data || [];

/** Copies a public URL into the account's media store; the returned media.url is a valid clip src. */
export const importMedia = async (url) =>
  (await vidmoat('POST', '/v1/media/import', { body: { url }, retries: 0, timeoutMs: 180_000 })).media;

/** One exact frame (JPEG bytes). Limited to 10 a minute per key, so use for debugging/QA only. */
export const previewFrame = async (id, at) =>
  Buffer.from(await vidmoat('GET', `/v1/projects/${encodeURIComponent(id)}/preview`, { query: { format: 'image', at } }));

/** AI narration. Grok: 8 credits up to 1,000 characters. Returns { url, credits, route, truncated? }. */
export const createSpeech = ({ text, provider, voiceId, maxCredits, instructions, quoteOnly }) =>
  vidmoat('POST', '/v1/ai/speech', {
    body: { text, provider, maxCredits, ...(voiceId ? { voiceId } : {}), ...(instructions ? { instructions } : {}), ...(quoteOnly ? { quoteOnly } : {}) },
    retries: 0, timeoutMs: 180_000,
  });

/** Word timings. With `src`: billed per 5 minutes of media. With `script` + `duration`: free. */
export const transcribe = (body) => vidmoat('POST', '/v1/ai/transcriptions', { body, retries: 0, timeoutMs: 180_000 });
