// The JSON API, shared by the local Node server (server/index.js) and the Vercel function
// (api/index.js). Long work (video generation) is handed to waitUntil(), which keeps a Vercel
// function alive after the response and is a no-op on a normal long-running server.

import { waitUntil } from '@vercel/functions';
import { PACKS, publicPack } from './curriculum/packs.js';
import { config } from './core/config.js';
import { INTEREST_TOPICS } from './curriculum/topics.js';
import { LEVELS } from './curriculum/levels.js';
import { catalogNames } from './curriculum/catalog.js';
import { usingRedis, redisSource, redisLikeVarNames } from './core/kv.js';
import * as db from './core/db.js';
import { saveProfile, editProfile, prefetch, nextItems, publicVideo, library, topUpLibrary, cleanProfile, linkVidmoat, recordReferral, resetStudent, notesOf } from './feed/index.js';
import { extraMoments, setExtraMoments } from './feed/moments.js';
import { resolveProgram, getProgram, getUnit, customUnitId } from './curriculum/index.js';
import { getPlan } from './lessons/plan.js';
import { lessonKey } from './lessons/index.js';
import { queueStats } from './video/generator.js';
import { getMe, getMeAs } from './core/vidmoat.js';
import { connectOwnAccount, disconnectOwnAccount, setMode, billingStatus } from './core/billing.js';
import { signInEnabled, signInRequired, startSignIn, finishSignIn } from './core/auth.js';
import { FORMATS, FORMAT_IDS } from './video/formats.js';
import { ingest, stats as eventStats, studentStats } from './feed/events.js';
import { syncUser, syncDaily, syncCalibration, resyncAll, enabled as sheetEnabled } from './core/sheet.js';
import { getSignals } from './feed/events.js';
import { learningProfile, insightOf } from './feed/learning.js';
import { gameFor, noteGame, GAME_TYPES } from './feed/games.js';
import { calibrationReport } from './feed/calibration.js';
import { mastery } from './feed/ranking.js';
import { getProgress, audienceFor } from './feed/index.js';
import { kv } from './core/kv.js';
import * as push from './core/push.js';
import { originOf } from './core/auth.js';
import { publicLesson, watchPage, notFoundPage, refOf, SITE_URL } from './core/watch.js';
import { sitemapXml, SITEMAP_LIMIT } from './core/sitemap.js';
import { profilePage } from './core/profile.js';
import * as channels from './feed/channels.js';
import { noteProfileVisit } from './feed/index.js';


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

/** Grid tiles for a course profile: [{ id, at }] → [{ id, title, poster, duration, format, unit, at }]. */
async function lessonTiles(ids) {
  const vids = await Promise.all(ids.map(({ id }) => db.getVideo(id)));
  return vids.map((v, i) => (v?.status === 'ready' ? { id: v.id, title: v.lesson?.title || null, poster: v.poster || null, duration: v.duration || null, format: FORMATS[v.format || 'explain']?.tag || null, unit: v.unitTitle || null, at: ids[i].at } : null)).filter(Boolean);
}

/**
 * The site's public origin for canonical links and share images: STUDYTOK_SITE_URL, or
 * study-graph.com in production, or whatever host served the request (local, previews).
 */
const siteOrigin = (req) => ((process.env.STUDYTOK_SITE_URL || process.env.VERCEL_ENV === 'production') ? SITE_URL : originOf(req));

const isHttps = (req) => (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || Boolean(process.env.VERCEL);

async function cookieUser(req) {
  const m = /(?:^|;\s*)st_uid=([0-9a-f-]{36})/.exec(req.headers.cookie || '');
  return m && (await db.getUser(m[1])) ? m[1] : null;
}
const signedIn = async (userId) => Boolean(userId && (await db.getUser(userId))?.vidmoat);
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
      signInRequired: signInRequired(),
      freeVideos: config.billing.freeVideos,
      billingUrl: config.billing.billingUrl,
      formats: Object.entries(FORMATS).map(([id, f]) => ({ id, name: f.name, tag: f.tag, blurb: f.blurb })),
      levels: LEVELS.map(({ id, label, emoji }) => ({ id, label, emoji })),
      topics: INTEREST_TOPICS.map(({ id, label, emoji, accent }) => ({ id, label, emoji, accent })),
    });
  }

  if (key === 'GET /api/catalog') {
    return send(res, 200, { programs: catalogNames(url.searchParams.get('level') || 'high-school') });
  }

  // Anonymous aggregates: how the formats perform, event volumes per day, generation waits.
  if (key === 'GET /api/stats') return send(res, 200, await eventStats({ formats: FORMAT_IDS }), { 'Cache-Control': 'public, max-age=60' });

  // Funnel steps that happen before there is a session (landing seen, sign-in tapped, install):
  // one counter per day, nothing personal. The later steps are counted where they happen.
  if (key === 'POST /api/funnel') {
    const body = await readJson(req, 2048);
    const step = ['landing', 'signin_click', 'install_prompt', 'installed', 'profile_share'].includes(body.step) ? body.step : null;
    if (step) await kv.hincrby(`events:day:${new Date().toISOString().slice(0, 10)}`, `funnel_${step}`, 1);
    if (step === 'landing' && Number.isInteger(Number(body.ref)) && Number(body.ref) > 0) await kv.hincrby(`events:day:${new Date().toISOString().slice(0, 10)}`, 'funnel_landing_ref', 1);
    return send(res, 200, { ok: Boolean(step) });
  }

  // ---- Public lesson pages: no session, no sign-in (see core/watch.js) ----
  // /v/:id is rewritten by vercel.json to ?__path=v/:id, so it arrives here as /api/v/:id; the
  // local server (server/index.js) forwards the bare path.
  const watchMatch = /^\/(?:api\/)?v\/([0-9a-f-]{36})$/.exec(path);
  if (req.method === 'GET' && watchMatch) {
    const ref = refOf(url.searchParams.get('ref'));
    const site = siteOrigin(req);
    const pageUrl = `${site}/v/${watchMatch[1]}`;
    const v = await db.getVideo(watchMatch[1]);
    const html = { 'Content-Type': 'text/html; charset=utf-8' };
    if (!v || v.status !== 'ready') return send(res, 404, notFoundPage({ url: pageUrl, ref }), { ...html, 'Cache-Control': 'no-store' });
    // Views of shared pages: one counter per day for the sheet, one per video for ranking.
    waitUntil(Promise.allSettled([kv.hincrby(`events:day:${new Date().toISOString().slice(0, 10)}`, 'share_page_view', 1), db.incrStat(v.id, 'shareViews')]));
    return send(res, 200, watchPage(v, { url: pageUrl, ref, playerOrigin: config.vidmoat.playerOrigin, notes: notesOf(v), ogImage: `${site}/og/v/${v.id}.png` }), { ...html, 'Cache-Control': 'public, max-age=300' });
  }

  // Share image for one lesson (core/og.js). Rendered once, then cached by the CDN for a week.
  // satori/resvg load only here, so the rest of the API never pays for them.
  const ogMatch = /^\/(?:api\/)?og\/v\/([0-9a-f-]{36})(?:\.png)?$/.exec(path);
  if (req.method === 'GET' && ogMatch) {
    const v = await db.getVideo(ogMatch[1]);
    if (!v || v.status !== 'ready') return redirect(res, '/og.png');
    try {
      const { lessonCard } = await import('./core/og.js');
      const png = await lessonCard(v, { site: new URL(siteOrigin(req)).host });
      return send(res, 200, png, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400' });
    } catch (err) {
      console.warn('[og]', err.message);
      return redirect(res, '/og.png');
    }
  }

  // ---- Course profiles (feed/channels.js): public pages, share cards and the JSON the app reads ----
  const profileMatch = /^\/(?:api\/)?(?:c\/|@)([a-z0-9._-]{3,40})$/.exec(path);
  if (req.method === 'GET' && profileMatch) {
    const ch = await channels.getChannel(profileMatch[1]);
    const html = { 'Content-Type': 'text/html; charset=utf-8' };
    const site = siteOrigin(req);
    if (!ch) return send(res, 404, notFoundPage({ url: `${site}/@${profileMatch[1]}` }).replace("This lesson isn't here.", "This course isn't here."), { ...html, 'Cache-Control': 'no-store' });
    const [pub, ids] = await Promise.all([channels.publicChannel(ch, { withUnits: true }), channels.channelLessonIds(ch, { limit: 30 })]);
    const lessons = await lessonTiles(ids);
    waitUntil(Promise.allSettled([channels.statOf(ch.handle, 'pageViews'), kv.hincrby(`events:day:${new Date().toISOString().slice(0, 10)}`, 'profile_page_view', 1)]));
    return send(res, 200, profilePage(pub, lessons, { url: `${site}/@${ch.handle}`, site, image: `${site}/og/c/${ch.handle}.png` }), { ...html, 'Cache-Control': 'public, max-age=120, s-maxage=300' });
  }
  const ogChannelMatch = /^\/(?:api\/)?og\/c\/([a-z0-9._-]{3,40}?)(?:\.png)?$/.exec(path); // lazy: handles may contain dots
  if (req.method === 'GET' && ogChannelMatch) {
    const ch = await channels.getChannel(ogChannelMatch[1]);
    if (!ch) return redirect(res, '/og.png');
    try {
      const { channelCard } = await import('./core/og.js');
      const png = await channelCard(await channels.publicChannel(ch), { site: new URL(siteOrigin(req)).host });
      return send(res, 200, png, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400' });
    } catch (err) {
      console.warn('[og]', err.message);
      return redirect(res, '/og.png');
    }
  }
  // Search (?q=) or the most followed; a handle check; the profile for a course ref.
  if (key === 'GET /api/channels') {
    const q = (url.searchParams.get('q') || '').slice(0, 80);
    const viewer = await cookieUser(req);
    const found = q ? await channels.searchChannels(q, 12) : await channels.topChannels(20);
    const list = (await Promise.all(found.map(async ({ handle }) => { const ch = await channels.getChannel(handle); return ch ? channels.publicChannel(ch, { userId: viewer }) : null; }))).filter(Boolean);
    return send(res, 200, { channels: list });
  }
  if (key === 'GET /api/channels/check') {
    const raw = url.searchParams.get('handle') || '';
    const r = await channels.handleAvailable(raw);
    return send(res, 200, { ...r, suggestion: r.ok ? undefined : await channels.freeHandleNear(channels.cleanHandle(raw) || 'course') });
  }
  if (key === 'GET /api/channels/for') {
    const ref = String(url.searchParams.get('ref') || '').slice(0, 60);
    const title = String(url.searchParams.get('title') || '').slice(0, 60);
    // A custom topic is identified by its title (curriculum customUnit hashes it the same way).
    const cuRef = title ? customUnitId(title) : null;
    const ch = await channels.channelForRef(ref || cuRef || '');
    const viewer = await cookieUser(req);
    if (ch) return send(res, 200, { channel: await channels.publicChannel(ch, { userId: viewer }) });
    const src = ref ? await channels.sourceOf(ref) : null;
    return send(res, 200, { channel: null, suggestion: await channels.freeHandleNear(src?.suggest || channels.slugHandle(title || src?.name || 'course')) });
  }
  const channelApiMatch = /^\/api\/channels\/([a-z0-9._-]{3,40})(\/lessons)?$/.exec(path);
  if (req.method === 'GET' && channelApiMatch) {
    const ch = await channels.getChannel(channelApiMatch[1]);
    if (!ch) return send(res, 404, { error: 'No such course profile' });
    const viewer = await cookieUser(req);
    const before = Number(url.searchParams.get('before')) || null;
    const ids = await channels.channelLessonIds(ch, { limit: 30, before });
    const lessons = await lessonTiles(ids);
    if (channelApiMatch[2]) return send(res, 200, { lessons, more: ids.length === 30 });
    // Opening a profile leans this viewer's feed towards it for a while (feed/index.js profileIntent).
    if (viewer) waitUntil(noteProfileVisit(viewer, ch));
    return send(res, 200, { channel: await channels.publicChannel(ch, { userId: viewer, withUnits: true }), lessons, more: ids.length === 30 });
  }

  // Sitemap: the home page plus every ready lesson page, newest first.
  if (req.method === 'GET' && /^\/(?:api\/)?sitemap\.xml$/.test(path)) {
    const flat = await kv.zrange('ready:any', 0, SITEMAP_LIMIT - 1, { rev: true, withScores: true });
    const lessons = [];
    for (let i = 0; i + 1 < flat.length; i += 2) lessons.push({ id: flat[i], at: Number(flat[i + 1]) });
    const profiles = (await channels.topChannels(5000)).map((c) => c.handle);
    return send(res, 200, sitemapXml(siteOrigin(req), lessons, profiles), { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=3600' });
  }
  const publicVideoMatch = /^\/api\/public\/videos\/([0-9a-f-]{36})$/.exec(path);
  if (req.method === 'GET' && publicVideoMatch) {
    const v = await db.getVideo(publicVideoMatch[1]);
    if (!v || v.status !== 'ready') return send(res, 404, { error: 'Not found' });
    return send(res, 200, { item: publicLesson(v, await db.getDocument(v.id)) }, { 'Cache-Control': 'public, max-age=300' });
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
    waitUntil(syncDaily());
    waitUntil(syncCalibration().catch((err) => console.warn('[calibration]', err.message)));
    waitUntil(push.remindDue().catch((err) => console.warn('[push]', err.message)));
    return send(res, 200, { started: pending.length });
  }
  // Cron reminders (same secret): one Web Push per student at most, see core/push.js remindDue.
  if (key === 'GET /api/cron/remind') {
    if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return send(res, 401, { error: 'Unauthorized' });
    return send(res, 200, await push.remindDue());
  }
  // Community packs (content/): public, so a pack page can be linked before sign-in.
  if (key === 'GET /api/packs') return send(res, 200, { packs: PACKS.map(publicPack) }, { 'Cache-Control': 'public, max-age=300' });
  // The VAPID public key the browser subscribes with (public by design; { enabled: false } when unset).
  if (key === 'GET /api/push/key') return send(res, 200, { enabled: push.enabled(), publicKey: push.publicKey() });
  // Admin: the extra moments (offers, news) shown between lessons; GET lists them, POST replaces
  // the list (Authorization: Bearer $STUDYTOK_SHEET_SECRET; see docs/ALGORITHM.md "Moments").
  // Admin: the calibration report (the same numbers as the sheet's Calibration tab).
  if (key === 'GET /api/admin/calibration') {
    if (!config.sheet.secret || req.headers.authorization !== `Bearer ${config.sheet.secret}`) return send(res, 401, { error: 'Unauthorized' });
    return send(res, 200, await calibrationReport());
  }
  if (key === 'GET /api/admin/moments' || key === 'POST /api/admin/moments') {
    if (!config.sheet.secret || req.headers.authorization !== `Bearer ${config.sheet.secret}`) return send(res, 401, { error: 'Unauthorized' });
    if (req.method === 'POST') return send(res, 200, { moments: await setExtraMoments((await readJson(req)).moments) });
    return send(res, 200, { moments: await extraMoments() });
  }
  // Admin: rebuild the Google Sheet from every student (Authorization: Bearer $STUDYTOK_SHEET_SECRET).
  if (key === 'POST /api/admin/sheet/resync') {
    if (!sheetEnabled() || req.headers.authorization !== `Bearer ${config.sheet.secret}`) return send(res, 401, { error: 'Unauthorized' });
    return send(res, 200, await resyncAll());
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
    if (!signInEnabled()) return redirect(res, '/?auth=unavailable');
    try {
      const { url: to, state } = await startSignIn(req);
      return redirect(res, to, [stateCookie(req, state)]);
    } catch (err) {
      console.error('[auth] start failed:', err.message);
      return redirect(res, '/?auth=error');
    }
  }
  // "Use my Vidmoat account": the same flow with the generation scopes (core/billing.js).
  if (key === 'GET /api/auth/vidmoat/connect') {
    if (!signInEnabled()) return redirect(res, '/?auth=unavailable');
    if (!(await signedIn(await cookieUser(req)))) return redirect(res, '/?auth=error');
    try {
      const { url: to, state } = await startSignIn(req, { purpose: 'generate' });
      return redirect(res, to, [stateCookie(req, state)]);
    } catch (err) {
      console.error('[auth] connect failed:', err.message);
      return redirect(res, '/?auth=error#profile');
    }
  }
  if (key === 'GET /api/auth/vidmoat/callback') {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (url.searchParams.get('error') || !code) return redirect(res, '/?auth=cancelled', [clearCookie(req, 'st_oauth')]);
    if (!state || state !== cookieValue(req, 'st_oauth')) return redirect(res, '/?auth=error', [clearCookie(req, 'st_oauth')]);
    try {
      const result = await finishSignIn({ code, state });
      const current = await cookieUser(req);
      if (result.purpose === 'generate') {
        // Connecting an account: it must be the one this student signed in with.
        const user = current && (await db.getUser(current));
        if (!user?.vidmoat || user.vidmoat.id !== result.id) return redirect(res, '/?auth=mismatch#profile', [clearCookie(req, 'st_oauth')]);
        if (result.missingScopes.length) return redirect(res, '/?auth=scopes#profile', [clearCookie(req, 'st_oauth')]);
        await connectOwnAccount(user.id, result.tokens);
        waitUntil(syncUser(user.id, { event: 'connected own account' }));
        return redirect(res, '/?auth=connected#profile', [clearCookie(req, 'st_oauth')]);
      }
      const { user, restored } = await linkVidmoat(current, result);
      const isNew = Date.now() - Date.parse(user.createdAt) < 60_000;
      const today = new Date().toISOString().slice(0, 10);
      waitUntil(kv.hincrby(`events:day:${today}`, isNew ? 'funnel_joined' : 'funnel_signed_in', 1));
      // The invite the visitor arrived with (the app keeps it in a cookie across the OAuth round trip).
      const ref = cookieValue(req, 'st_ref');
      const inviter = isNew && ref ? await recordReferral(user, ref) : null;
      waitUntil(syncUser(user.id, { event: isNew ? 'joined' : restored ? 'signed in again' : null, detail: [result.email || '', inviter ? `invited by #${inviter}` : ''].filter(Boolean).join(' · ') }));
      return redirect(res, `/?auth=${restored ? 'restored' : 'linked'}`, [userCookie(req, user.id), clearCookie(req, 'st_oauth')]);
    } catch (err) {
      console.error('[auth]', err.message);
      return redirect(res, '/?auth=error', [clearCookie(req, 'st_oauth')]);
    }
  }
  if (key === 'POST /api/auth/signout') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req, 'st_uid') });
  }

  // Create or update the viewer's profile (sets the session cookie). With sign-in required, only
  // a viewer who has signed in with Vidmoat (the callback created their user) can set one up.
  if (key === 'POST /api/profile' || key === 'POST /api/session') {
    const body = await readJson(req);
    if (key === 'POST /api/session' && !body.profile) body.profile = { level: 'lifelong' };
    const current = await cookieUser(req);
    if (signInRequired() && !(await signedIn(current))) return send(res, 401, { error: 'Sign in with Vidmoat to start', signin: true });
    let user;
    let before;
    try { before = current ? await db.getUser(current) : null; user = await saveProfile(current, body); } catch (err) { if (err.status === 400) return send(res, 400, { error: err.message, code: err.code }); throw err; }
    if (user.setupDone && !before?.setupDone) waitUntil(kv.hincrby(`events:day:${new Date().toISOString().slice(0, 10)}`, 'funnel_setup', 1));
    // Every course the student picked gets its profile (named by them when it is new) and is followed.
    const handles = body.handles && typeof body.handles === 'object' ? Object.fromEntries(Object.entries(body.handles).slice(0, 12).map(([k, v]) => [String(k).slice(0, 60), String(v).slice(0, 64)])) : {};
    const made = body.draft ? [] : await channels.syncOwnChannels(user, { handles }).catch((err) => { console.warn('[channels]', err.message); return []; });
    if (made.length) { user.channelsSig = made.map((m) => m.ref).sort().join(','); await db.saveUser(user); }
    waitUntil(syncUser(user.id, { event: user.setupDone && !before?.setupDone ? 'set up' : null, detail: user.profile?.program || (user.profile?.level || ''), force: true }));
    // Start the first videos now, so the feed opens without a wait.
    waitUntil(prefetch(user.id).then((pending) => Promise.allSettled(pending)).catch((err) => console.warn('[prefetch]', err.message)));
    return send(res, 200, { user, channels: made }, { 'Set-Cookie': userCookie(req, user.id) });
  }

  const userId = await cookieUser(req);
  if (!userId) return send(res, 401, { error: 'No session. Sign in with Vidmoat first.', signin: true });
  if (signInRequired() && !(await signedIn(userId))) return send(res, 401, { error: 'Sign in with Vidmoat to continue', signin: true });

  if (key === 'GET /api/me') {
    const [u, seen, liked] = await Promise.all([db.getUser(userId).then(db.ensureMemberNo), db.countSet(userId, 'seen'), db.countSet(userId, 'liked')]);
    // Courses without a profile yet (research that finished later, students from before profiles): make and follow them.
    if (u.setupDone && channels.ownRefs(u).sort().join(',') !== (u.channelsSig || '')) {
      const made = await channels.syncOwnChannels(u).catch(() => null);
      if (made) { u.channelsSig = made.map((m) => m.ref).sort().join(','); await db.saveUser(u); }
    }
    const following = await channels.followingOf(userId);
    // Legacy profiles (before setupDone existed) count as set up when they have content.
    const setupDone = u.setupDone ?? Boolean(u.units?.length || u.interests?.length);
    const [billing, stats] = await Promise.all([billingStatus(u, { fetchMe: getMeAs }), studentStats(userId, { watched: seen, progress: await getProgress(userId), masteryOf: mastery })]);
    const { vidmoatTokens, ...safe } = u; // sealed tokens never leave the server
    waitUntil(syncUser(userId)); // keeps the admin sheet's row fresh (throttled)
    const invites = u.memberNo ? await db.referralCount(u.memberNo) : 0;
    const learning = learningProfile(await getSignals(userId), u.styles);
    return send(res, 200, { user: { ...safe, setupDone, seen, liked, billing, stats, invites, following, learning: { ...learning, insight: insightOf(learning) } } });
  }

  // Credits: switch between the free allowance and the student's own account, or disconnect it.
  if (key === 'POST /api/billing/mode') {
    const body = await readJson(req);
    const user = await setMode(userId, body.mode);
    return send(res, 200, { billing: await billingStatus(user) });
  }
  if (key === 'POST /api/billing/disconnect') {
    const user = await disconnectOwnAccount(userId);
    waitUntil(syncUser(userId, { event: 'disconnected own account' }));
    return send(res, 200, { billing: await billingStatus(user) });
  }

  if (key === 'GET /api/library') return send(res, 200, await library(userId));
  // A mini game on demand, from the student's recently watched lessons (?type=match|order|sort|truefalse|fillgap).
  if (key === 'GET /api/games/next') {
    const type = url.searchParams.get('type');
    const item = await gameFor(userId, { type: GAME_TYPES.includes(type) ? type : null });
    if (!item) return send(res, 404, { error: 'Watch a few more lessons first: games are made from what you have watched.' });
    await noteGame(userId, item, {});
    return send(res, 200, { item });
  }
  // The study plan StudyGraph follows for one of the student's units (what's in it, what is covered).
  const planMatch = /^\/api\/units\/([A-Za-z0-9:_.-]{1,80})\/plan$/.exec(path);
  if (req.method === 'GET' && planMatch) {
    const [user, unit] = await Promise.all([db.getUser(userId), getUnit(planMatch[1])]);
    if (!unit) return send(res, 404, { error: 'No such unit' });
    const lk = lessonKey(unit.id, audienceFor(user));
    const [plan, covered] = await Promise.all([getPlan(lk), kv.lrange(`covered:${lk}`, 0, 199)]);
    const done = new Set((covered || []).map((c) => String(c).toLowerCase()));
    return send(res, 200, { unit: { id: unit.id, title: unit.title, summary: unit.summary || '' }, plan: plan ? { ...plan, concepts: plan.concepts.map((c) => ({ ...c, covered: [...done].some((d) => d.includes(c.title.toLowerCase().slice(0, 18)) || c.title.toLowerCase().includes(d.slice(0, 18))) })) } : null, covered: covered || [] });
  }

  // Web Push reminders (public/push.js): register / drop this device, or send a test to the caller.
  if (key === 'POST /api/push/subscribe') {
    if (!push.enabled()) return send(res, 200, { enabled: false });
    const body = await readJson(req, 8 * 1024);
    const list = await push.subscribe(userId, body.subscription);
    return send(res, 200, { enabled: true, devices: list.length });
  }
  if (key === 'POST /api/push/unsubscribe') {
    const body = await readJson(req, 8 * 1024);
    const list = await push.unsubscribe(userId, body.endpoint);
    return send(res, 200, { enabled: push.enabled(), devices: list.length });
  }
  if (key === 'POST /api/push/test') {
    if (!push.enabled()) return send(res, 200, { enabled: false, sent: 0 });
    const sent = await push.sendTo(userId, { title: 'StudyGraph', body: 'Reminders are on. We will nudge you when a streak or a review is at stake.', url: '/#feed', tag: 'studygraph-reminder' });
    return send(res, 200, { enabled: true, sent });
  }

  // Edit units, interests, preferences; add a custom topic (optionally into a course); remove a unit.
  if (key === 'PATCH /api/me') {
    const body = await readJson(req);
    const { user, added } = await editProfile(userId, body);
    waitUntil(prefetch(userId).then((pending) => Promise.allSettled(pending)).catch(() => {}));
    return send(res, 200, { user, added });
  }

  // Follow / unfollow a course profile. Unfollowing a course the student studies takes it off their course too.
  const followMatch = /^\/api\/channels\/([a-z0-9._-]{3,40})\/follow$/.exec(path);
  if (followMatch && (req.method === 'POST' || req.method === 'DELETE')) {
    const user = await db.getUser(userId);
    if (req.method === 'POST') {
      const r = await channels.follow(userId, followMatch[1]);
      if (user.unfollowed?.includes(r.channel.handle)) { user.unfollowed = user.unfollowed.filter((h) => h !== r.channel.handle); await db.saveUser(user); }
      waitUntil(prefetch(userId).then((pending) => Promise.allSettled(pending)).catch(() => {}));
      return send(res, 200, { following: true, followers: r.followers });
    }
    const r = await channels.unfollow(userId, followMatch[1]);
    const left = channels.ownRefs(user).includes(r.channel.ref) && channels.leaveCourse(user, r.channel);
    if (!left) user.unfollowed = [...new Set([...(user.unfollowed || []), r.channel.handle])].slice(-100);
    user.channelsSig = channels.ownRefs(user).sort().join(',');
    await db.saveUser(user);
    return send(res, 200, { following: false, followers: r.followers, left, user: left ? user : undefined });
  }
  if (key === 'GET /api/me/following') {
    const handles = await channels.followingOf(userId);
    const list = (await Promise.all(handles.slice(0, 100).map(async (h) => { const ch = await channels.getChannel(h); return ch ? channels.publicChannel(ch, { userId }) : null; }))).filter(Boolean);
    return send(res, 200, { channels: list.sort((a, b) => Number(b.mine) - Number(a.mine) || b.followers - a.followers) });
  }

  // Start over: { scope: 'feed' | 'everything' } (see resetStudent).
  if (key === 'POST /api/me/reset') {
    const body = await readJson(req);
    const scope = body.scope === 'everything' ? 'everything' : 'feed';
    const user = await resetStudent(userId, scope);
    if (!user) return send(res, 404, { error: 'No profile' });
    waitUntil(kv.hincrby(`events:day:${new Date().toISOString().slice(0, 10)}`, `reset_${scope}`, 1));
    waitUntil(syncUser(userId, { event: scope === 'everything' ? 'reset everything' : 'reset feed', force: true }));
    if (scope === 'feed') waitUntil(prefetch(userId).then((pending) => Promise.allSettled(pending)).catch(() => {}));
    return send(res, 200, { ok: true, scope });
  }

  if (key === 'GET /api/feed') {
    const count = Math.min(5, Math.max(1, Number(url.searchParams.get('count')) || 3));
    const { items, pending, credits } = await nextItems(userId, count);
    // Keep generating after the response (serverless) / let it run (long-lived server).
    if (pending.length) waitUntil(Promise.allSettled(pending));
    return send(res, 200, { items: await Promise.all(items.map((x) => (x.moment ? x.moment : publicVideo(x.video, userId, { why: x.why, pos: x.pos, queuedFor: x.queuedFor })))), credits: credits || undefined });
  }

  const videoMatch = /^\/api\/videos\/([0-9a-f-]{36})$/.exec(path);
  if (req.method === 'GET' && videoMatch) {
    const v = await db.getVideo(videoMatch[1]);
    return v ? send(res, 200, { item: await publicVideo(v, userId) }) : send(res, 404, { error: 'Not found' });
  }

  // Engagement events: a batch { ctx, events: [...] } from telemetry.js, or one event { type, videoId, ... }.
  if (key === 'POST /api/events') {
    const body = await readJson(req, 256 * 1024);
    const batch = Array.isArray(body.events) ? body : { events: [body] };
    const { accepted, levelUps } = await ingest(userId, batch);
    if (accepted) waitUntil(syncUser(userId, levelUps?.length ? { event: 'level up', detail: levelUps.map((l) => l.title).join(', ') } : {}));
    return send(res, 200, { ok: true, accepted, levelUps });
  }

  return send(res, 404, { error: 'Not found' });
}
