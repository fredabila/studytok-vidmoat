// The JSON API, shared by the local Node server (server/index.js) and the Vercel function
// (api/index.js). Long work (video generation) is handed to waitUntil(), which keeps a Vercel
// function alive after the response and is a no-op on a normal long-running server.

import { waitUntil } from '@vercel/functions';
import { config } from './config.js';
import { INTEREST_TOPICS } from './topics.js';
import { LEVELS } from './levels.js';
import { catalogNames } from './catalog.js';
import { usingRedis, redisSource, redisLikeVarNames } from './kv.js';
import * as db from './db.js';
import { saveProfile, nextItems, recordEvent, publicVideo, library, topUpLibrary, cleanProfile, linkVidmoat } from './feed.js';
import { resolveProgram, getProgram } from './curriculum.js';
import { queueStats } from './generator.js';
import { getMe } from './vidmoat.js';
import { signInEnabled, startSignIn, finishSignIn } from './auth.js';
import { kv } from './kv.js';

const EVENT_TYPES = new Set(['view', 'complete', 'like', 'unlike', 'save', 'unsave', 'skip', 'less', 'leave', 'quiz_answer']);

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    `frame-src ${config.vidmoat.playerOrigin}`,
    "img-src 'self' https: data:",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
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
const clearCookie = (req, name) => `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;
const stateCookie = (req, v) => `st_oauth=${v}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600${isHttps(req) ? '; Secure' : ''}`;
const cookieValue = (req, name) => new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || '')?.[1] || null;
const redirect = (res, location, cookies = []) => { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) }); res.end(); };

// Storage status for /api/health. Only variable NAMES are reported, never values.
function storageInfo() {
  if (usingRedis) return { storage: 'redis', storageVar: redisSource };
  return {
    storage: 'local',
    storageWarning: process.env.VERCEL ? 'Upstash Redis not found: data is per-instance and will be lost. Connect Upstash for Redis to this project and redeploy.' : undefined,
    redisLikeVars: redisLikeVarNames(),
  };
}

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
    return send(res, 200, {
      playerOrigin: config.vidmoat.playerOrigin,
      research: config.anthropic.enabled,
      vidmoatSignIn: signInEnabled(),
      levels: LEVELS.map(({ id, label, emoji }) => ({ id, label, emoji })),
      topics: INTEREST_TOPICS.map(({ id, label, emoji, accent }) => ({ id, label, emoji, accent })),
    });
  }

  if (key === 'GET /api/catalog') {
    return send(res, 200, { programs: catalogNames(url.searchParams.get('level') || 'high-school') });
  }

  if (key === 'GET /api/health') {
    try {
      const me = await getMe();
      return send(res, 200, {
        ok: true, plan: me.account.plan.id, environment: me.credential.environment, credits: me.account.credits.remaining,
        lessons: config.anthropic.enabled ? 'claude' : 'bank', voice: config.voice.enabled ? config.voice.timing : 'off', ...storageInfo(),
        queue: queueStats(), library: await db.readyCount(),
      });
    } catch (err) {
      return send(res, 503, { ok: false, ...storageInfo(), error: err.code || err.message });
    }
  }

  // Cron top-up (Vercel Cron sends Authorization: Bearer $CRON_SECRET).
  if (key === 'GET /api/cron/topup') {
    if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return send(res, 401, { error: 'Unauthorized' });
    const pending = await topUpLibrary();
    if (pending.length) waitUntil(Promise.allSettled(pending));
    return send(res, 200, { started: pending.length });
  }

  // Course lookup: catalog match, or start/poll research of the student's institution/course.
  if (key === 'POST /api/programs/resolve') {
    const body = await readJson(req);
    const { program, pending, researchUnavailable } = await resolveProgram(cleanProfile(body.profile), { tailor: Boolean(body.tailor) });
    if (pending) waitUntil(pending);
    return send(res, 200, { program, researchUnavailable: Boolean(researchUnavailable) });
  }
  const programMatch = /^\/api\/programs\/((?:cat|res):[a-z0-9-]{1,40})$/.exec(path);
  if (req.method === 'GET' && programMatch) {
    const program = await getProgram(programMatch[1]);
    return program ? send(res, 200, { program }) : send(res, 404, { error: 'Not found' });
  }

  // ---- Sign in with Vidmoat (identity only; see server/auth.js) ----
  if (key === 'GET /api/auth/vidmoat/start') {
    if (!signInEnabled()) return redirect(res, '/?auth=unavailable#profile');
    try {
      const { url: to, state } = await startSignIn(req);
      return redirect(res, to, [stateCookie(req, state)]);
    } catch (err) {
      console.error('[auth] start failed:', err.message);
      return redirect(res, '/?auth=error#profile');
    }
  }
  if (key === 'GET /api/auth/vidmoat/callback') {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (url.searchParams.get('error') || !code) return redirect(res, '/?auth=cancelled#profile', [clearCookie(req, 'st_oauth')]);
    if (!state || state !== cookieValue(req, 'st_oauth')) return redirect(res, '/?auth=error#profile', [clearCookie(req, 'st_oauth')]);
    try {
      const identity = await finishSignIn({ code, state });
      const { user, restored } = await linkVidmoat(await cookieUser(req), identity);
      return redirect(res, `/?auth=${restored ? 'restored' : 'linked'}#profile`, [userCookie(req, user.id), clearCookie(req, 'st_oauth')]);
    } catch (err) {
      console.error('[auth]', err.message);
      return redirect(res, '/?auth=error#profile', [clearCookie(req, 'st_oauth')]);
    }
  }
  if (key === 'POST /api/auth/signout') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req, 'st_uid') });
  }

  // Create or update the viewer's profile (sets the session cookie).
  if (key === 'POST /api/profile' || key === 'POST /api/session') {
    const body = await readJson(req);
    if (key === 'POST /api/session' && !body.profile) body.profile = { level: 'lifelong' };
    const user = await saveProfile(await cookieUser(req), body);
    return send(res, 200, { user }, { 'Set-Cookie': userCookie(req, user.id) });
  }

  const userId = await cookieUser(req);
  if (!userId) return send(res, 401, { error: 'No session. POST /api/profile first.' });

  if (key === 'GET /api/me') {
    const [u, seen, liked] = await Promise.all([db.getUser(userId), db.countSet(userId, 'seen'), db.countSet(userId, 'liked')]);
    // Legacy profiles (before setupDone existed) count as set up when they have content.
    const setupDone = u.setupDone ?? Boolean(u.units?.length || u.interests?.length);
    return send(res, 200, { user: { ...u, setupDone, seen, liked } });
  }

  if (key === 'GET /api/library') return send(res, 200, await library(userId));

  if (key === 'GET /api/feed') {
    const count = Math.min(5, Math.max(1, Number(url.searchParams.get('count')) || 3));
    const { items, pending } = await nextItems(userId, count);
    // Keep generating after the response (serverless) / let it run (long-lived server).
    if (pending.length) waitUntil(Promise.allSettled(pending));
    return send(res, 200, { items: await Promise.all(items.map((x) => publicVideo(x.video, userId, { why: x.why, pos: x.pos }))) });
  }

  const videoMatch = /^\/api\/videos\/([0-9a-f-]{36})$/.exec(path);
  if (req.method === 'GET' && videoMatch) {
    const v = await db.getVideo(videoMatch[1]);
    return v ? send(res, 200, { item: await publicVideo(v, userId) }) : send(res, 404, { error: 'Not found' });
  }

  if (key === 'POST /api/events') {
    const body = await readJson(req);
    if (!EVENT_TYPES.has(body.type) || typeof body.videoId !== 'string') return send(res, 400, { error: 'Bad event' });
    const ok = await recordEvent(userId, { videoId: body.videoId, type: body.type, watchedSec: Number(body.watchedSec) || 0, correct: body.correct === true });
    return ok ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Unknown video' });
  }

  return send(res, 404, { error: 'Not found' });
}
