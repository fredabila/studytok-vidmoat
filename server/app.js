// The JSON API, shared by the local Node server (server/index.js) and the Vercel function
// (api/index.js). Long work (video generation) is handed to waitUntil(), which keeps a Vercel
// function alive after the response and is a no-op on a normal long-running server.

import { waitUntil } from '@vercel/functions';
import { config } from './config.js';
import { TOPICS } from './topics.js';
import { usingRedis } from './kv.js';
import * as db from './db.js';
import { createUser, setInterests, nextItems, recordEvent, publicVideo } from './feed.js';
import { queueStats } from './generator.js';
import { getMe } from './vidmoat.js';

const EVENT_TYPES = new Set(['view', 'complete', 'like', 'unlike', 'skip', 'less', 'leave', 'quiz_correct']);

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    `frame-src ${config.vidmoat.playerOrigin}`,
    "img-src 'self' https: data:",
    "style-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

export function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } : {}),
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readJson(req, limit = 64 * 1024) {
  // Vercel's Node runtime parses the body for us (req.body); a plain Node server does not.
  if (process.env.VERCEL && req.body !== undefined) {
    const b = req.body;
    if (typeof b === 'string') { try { return JSON.parse(b || '{}'); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); } }
    return b && typeof b === 'object' ? b : {};
  }
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

const isHttps = (req) => (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || Boolean(process.env.VERCEL);

async function cookieUser(req) {
  const m = /(?:^|;\s*)st_uid=([0-9a-f-]{36})/.exec(req.headers.cookie || '');
  return m && (await db.getUser(m[1])) ? m[1] : null;
}
const userCookie = (req, id) => `st_uid=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${isHttps(req) ? '; Secure' : ''}`;

/** Handles every /api/* route. */
export async function handleApi(req, res) {
  const url = apiUrl(req);
  try {
    await route(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Internal error' });
  }
}

/**
 * The request URL as the browser sent it. On Vercel every /api/* path is rewritten to the one
 * function at /api/index with the original path in ?__path= (see vercel.json); depending on the
 * platform, req.url shows either the original or the rewritten URL, so accept both.
 */
export function apiUrl(req) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const forwarded = url.searchParams.get('__path');
  url.searchParams.delete('__path');
  if (url.pathname === '/api/index' || url.pathname === '/api/index.js') {
    if (forwarded) url.pathname = `/api/${forwarded.replace(/^\/+/, '')}`;
  }
  return url;
}

async function route(req, res, url) {
  const path = url.pathname;
  const key = `${req.method} ${path}`;

  // Same-origin only for writes (the API is not meant to be called cross-site).
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
    return send(res, 403, { error: 'Cross-origin requests are not allowed' });
  }

  if (key === 'GET /api/config') {
    return send(res, 200, { playerOrigin: config.vidmoat.playerOrigin, topics: TOPICS.map(({ id, label, emoji, accent }) => ({ id, label, emoji, accent })) });
  }

  if (key === 'GET /api/health') {
    try {
      const me = await getMe();
      return send(res, 200, {
        ok: true, plan: me.account.plan.id, environment: me.credential.environment, credits: me.account.credits.remaining,
        lessons: config.anthropic.enabled ? 'claude' : 'bank', storage: usingRedis ? 'redis' : 'local',
        queue: queueStats(), library: await db.readyCount(TOPICS.map((t) => t.id)),
      });
    } catch (err) {
      return send(res, 503, { ok: false, storage: usingRedis ? 'redis' : 'local', error: err.code || err.message });
    }
  }

  if (key === 'POST /api/session') {
    const body = await readJson(req);
    const interests = Array.isArray(body.interests) ? body.interests.map(String) : [];
    const existing = await cookieUser(req);
    const user = existing ? await setInterests(existing, interests) : await createUser(interests);
    return send(res, 200, { user: { id: user.id, interests: user.interests } }, { 'Set-Cookie': userCookie(req, user.id) });
  }

  const userId = await cookieUser(req);
  if (!userId) return send(res, 401, { error: 'No session. POST /api/session first.' });

  if (key === 'GET /api/me') {
    const [u, seen, liked] = await Promise.all([db.getUser(userId), db.countSet(userId, 'seen'), db.countSet(userId, 'liked')]);
    return send(res, 200, { user: { id: u.id, interests: u.interests, seen, liked } });
  }

  if (key === 'GET /api/feed') {
    const count = Math.min(5, Math.max(1, Number(url.searchParams.get('count')) || 3));
    const { items, pending } = await nextItems(userId, count);
    // Keep generating after the response (serverless) / let it run (long-lived server).
    if (pending.length) waitUntil(Promise.allSettled(pending));
    return send(res, 200, { items: await Promise.all(items.map((v) => publicVideo(v, userId))) });
  }

  const videoMatch = /^\/api\/videos\/([0-9a-f-]{36})$/.exec(path);
  if (req.method === 'GET' && videoMatch) {
    const v = await db.getVideo(videoMatch[1]);
    return v ? send(res, 200, { item: await publicVideo(v, userId) }) : send(res, 404, { error: 'Not found' });
  }

  if (key === 'POST /api/events') {
    const body = await readJson(req);
    if (!EVENT_TYPES.has(body.type) || typeof body.videoId !== 'string') return send(res, 400, { error: 'Bad event' });
    const ok = await recordEvent(userId, { videoId: body.videoId, type: body.type, watchedSec: Number(body.watchedSec) || 0 });
    return ok ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Unknown video' });
  }

  return send(res, 404, { error: 'Not found' });
}
