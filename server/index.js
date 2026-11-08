// StudyTok HTTP server: static frontend + a small JSON API. No framework, Node 22+.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { config } from './config.js';
import { TOPICS } from './topics.js';
import { users, videos, flushAll } from './store.js';
import { createUser, setInterests, nextItems, recordEvent, publicVideo } from './feed.js';
import { queueStats } from './generator.js';
import { getMe } from './vidmoat.js';

const PUBLIC = new URL('../public/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const EVENT_TYPES = new Set(['view', 'complete', 'like', 'unlike', 'skip', 'less', 'leave', 'quiz_correct']);

const SECURITY_HEADERS = {
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

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } : {}),
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readJson(req, limit = 64 * 1024) {
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

const cookieUser = (req) => {
  const m = /(?:^|;\s*)st_uid=([0-9a-f-]{36})/.exec(req.headers.cookie || '');
  return m && users.get(m[1]) ? m[1] : null;
};
const userCookie = (id) => `st_uid=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  // Same-origin only for writes (the API is not meant to be called cross-site).
  if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) {
    return send(res, 403, { error: 'Cross-origin requests are not allowed' });
  }

  if (route === 'GET /api/config') {
    return send(res, 200, { playerOrigin: config.vidmoat.playerOrigin, topics: TOPICS.map(({ id, label, emoji, accent }) => ({ id, label, emoji, accent })) });
  }

  if (route === 'GET /api/health') {
    try {
      const me = await getMe();
      return send(res, 200, { ok: true, plan: me.account.plan.id, environment: me.credential.environment, credits: me.account.credits.remaining, lessons: config.anthropic.enabled ? 'claude' : 'bank', queue: queueStats(), library: videos.all().filter((v) => v.status === 'ready').length });
    } catch (err) {
      return send(res, 503, { ok: false, error: err.code || err.message });
    }
  }

  if (route === 'POST /api/session') {
    const body = await readJson(req);
    const interests = Array.isArray(body.interests) ? body.interests.map(String) : [];
    let id = cookieUser(req);
    if (id) setInterests(id, interests); else id = createUser(interests).id;
    const u = users.get(id);
    return send(res, 200, { user: { id: u.id, interests: u.interests } }, { 'Set-Cookie': userCookie(id) });
  }

  const userId = cookieUser(req);
  if (!userId) return send(res, 401, { error: 'No session. POST /api/session first.' });

  if (route === 'GET /api/me') {
    const u = users.get(userId);
    return send(res, 200, { user: { id: u.id, interests: u.interests, seen: u.seen.length, liked: u.liked.length } });
  }

  if (route === 'GET /api/feed') {
    const count = Math.min(5, Math.max(1, Number(url.searchParams.get('count')) || 3));
    return send(res, 200, { items: nextItems(userId, count).map((v) => publicVideo(v, userId)) });
  }

  const videoMatch = /^\/api\/videos\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (req.method === 'GET' && videoMatch) {
    const v = videos.get(videoMatch[1]);
    return v ? send(res, 200, { item: publicVideo(v, userId) }) : send(res, 404, { error: 'Not found' });
  }

  if (route === 'POST /api/events') {
    const body = await readJson(req);
    if (!EVENT_TYPES.has(body.type) || typeof body.videoId !== 'string') return send(res, 400, { error: 'Bad event' });
    const u = recordEvent(userId, { videoId: body.videoId, type: body.type, watchedSec: Number(body.watchedSec) || 0 });
    return u ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Unknown video' });
  }

  return send(res, 404, { error: 'Not found' });
}

async function serveStatic(req, res, url) {
  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/index.html';
  const file = normalize(join(PUBLIC, path));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  try {
    const data = await readFile(file);
    send(res, 200, data, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  } catch {
    send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Internal error' });
  }
});

// Videos left "generating" by a previous run will never finish: mark them failed on boot.
for (const v of videos.all()) if (v.status === 'generating') videos.set(v.id, { ...v, status: 'failed', error: 'Interrupted by restart' });

server.listen(config.port, config.host, () => {
  console.log(`StudyTok on http://${config.host}:${config.port}`);
  console.log(`  lessons: ${config.anthropic.enabled ? `Claude (${config.anthropic.model})` : 'offline bank (set ANTHROPIC_API_KEY for unlimited lessons)'}`);
  if (!config.vidmoat.apiKey) console.warn('  VIDMOAT_API_KEY is not set: video generation will fail. Copy .env.example to .env.');
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flushAll(); process.exit(0); });
