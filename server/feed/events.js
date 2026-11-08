// Event collection. The app reports everything a viewer does (docs/EVENTS.md): impressions,
// view starts, heartbeats, pauses, loops, scene changes, how a video was left and how far it
// got, quiz timing and answers, likes, saves, "less", sheet opens, preference changes, library
// and profile use, install prompts and sessions. Events arrive in batches from
// public/telemetry.js and are folded here into the aggregates the ranking reads:
//
//   video:{id}:stats     HASH   counters per video (views, completes, watch-fraction buckets…)
//   video:{id}:scenes    HASH   how many viewers reached each scene (drop-off curve)
//   stats:format:{f}     HASH   counters per format (and stats:format:{f}:{topic})
//   user:{id}:signals    JSON   the viewer's learned tastes: per-format and per-topic
//                               engagement, watch habits, quiz speed, active hours
//   user:{id}:session    JSON   the current session: videos served, last formats, quiz streaks
//   user:{id}:progress   JSON   per-unit learning state (ranking.js applyEvent)
//   events:log           LIST   the last 20k raw events (for analysis and tuning)
//   events:day:{date}    HASH   event counts per type per day
//
// Nothing here identifies a person beyond their StudyTok user id, and nothing is sent to a
// third party. Validation is strict: unknown types and fields are dropped, numbers clamped.

import { kv } from '../core/kv.js';
import * as db from '../core/db.js';
import { applyEvent, emptyState } from './ranking.js';
import { audienceFor } from './index.js';

// ---- Taxonomy ------------------------------------------------------------------------------------
// video: the event is about a video (videoId required). fields: name -> type ('n' number 0..1e6,
// 'p' 0..1, 'b' boolean, 's' short string, 'i' small integer).
export const EVENT_SPECS = {
  // session & app
  session_start: { fields: { source: 's', entry: 's', ageBand: 's' } },
  app_hidden: { fields: {} },
  app_visible: { fields: {} },
  install: { fields: { outcome: 's' } },
  signin_click: { fields: { where: 's' } },
  load_more: { fields: { count: 'i', ms: 'n', ready: 'i', generating: 'i' } },
  end_reached: { fields: {} },
  player_error: { video: true, fields: { msg: 's' } },
  gen_wait: { video: true, fields: { ms: 'n', outcome: 's' } },
  // feed consumption
  impression: { video: true, fields: { slot: 'i', nth: 'i', status: 's', format: 's' } },
  view: { video: true, fields: { nth: 'i', format: 's', source: 's' } },
  heartbeat: { video: true, fields: { t: 'n', watched: 'n', loops: 'i' } },
  scene: { video: true, fields: { sceneId: 's', kind: 's', t: 'n' } },
  pause: { video: true, fields: { t: 'n', by: 's' } },
  resume: { video: true, fields: { t: 'n' } },
  loop: { video: true, fields: { loops: 'i' } },
  complete: { video: true, fields: {} },
  leave: { video: true, fields: { t: 'n', watched: 'n', maxT: 'n', pct: 'p', loops: 'i', dir: 's', early: 'b', watchedSec: 'n' } },
  skip: { video: true, fields: {} }, // legacy: an early leave
  rewatch: { video: true, fields: {} },
  // reactions
  like: { video: true, fields: { t: 'n', by: 's' } },
  unlike: { video: true, fields: {} },
  save: { video: true, fields: { t: 'n' } },
  unsave: { video: true, fields: {} },
  less: { video: true, fields: { t: 'n' } },
  why_open: { video: true, fields: {} },
  // quiz
  quiz_shown: { video: true, fields: { t: 'n' } },
  quiz_hold: { video: true, fields: { t: 'n' } },
  quiz_answer: { video: true, fields: { choice: 'i', correct: 'b', ms: 'n' } },
  quiz_skip: { video: true, fields: { ms: 'n' } },
  // personalisation & navigation
  tune_open: { fields: {} },
  pref_change: { fields: { key: 's', value: 's' } },
  interest_toggle: { fields: { topic: 's', on: 'b' } },
  custom_add: { fields: { title: 's' } },
  custom_remove: { fields: { unitId: 's' } },
  unit_toggle: { fields: { unitId: 's', on: 'b' } },
  library_open: { fields: { tab: 's' } },
  profile_open: { fields: {} },
  studies_edit: { fields: {} },
};
export const EVENT_TYPES = new Set(Object.keys(EVENT_SPECS));

const clampNum = (v, max = 1e6) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Number(v))) : 0);
const str = (v, n = 80) => String(v ?? '').slice(0, n);

/** Validates one raw event into a clean one (or null). */
export function cleanEvent(raw) {
  const spec = raw && EVENT_SPECS[raw.type];
  if (!spec) return null;
  if (spec.video && !/^[0-9a-f-]{36}$/.test(String(raw.videoId || ''))) return null;
  const out = { type: raw.type, at: clampNum(raw.at, 4102444800000) || Date.now() };
  if (spec.video) out.videoId = raw.videoId;
  for (const [k, kind] of Object.entries(spec.fields)) {
    if (raw[k] === undefined || raw[k] === null) continue;
    out[k] = kind === 'n' ? clampNum(raw[k]) : kind === 'p' ? clampNum(raw[k], 1) : kind === 'i' ? Math.round(clampNum(raw[k], 1e5))
      : kind === 'b' ? raw[k] === true : str(raw[k]);
  }
  return out;
}

export function cleanContext(ctx = {}) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  return {
    sid: str(c.sid, 40), vw: Math.round(clampNum(c.vw, 10000)), vh: Math.round(clampNum(c.vh, 10000)), dpr: clampNum(c.dpr, 10),
    standalone: c.standalone === true, conn: str(c.conn, 12), tz: str(c.tz, 48), lang: str(c.lang, 12), platform: str(c.platform, 24),
  };
}

// ---- Aggregation ----------------------------------------------------------------------------------
const WATCH_BUCKET = (pct) => `wf${Math.min(4, Math.floor(pct * 5))}`; // wf0: <20% … wf4: ≥80%
const hourOf = (at, tz) => { try { return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz || 'UTC' }).format(new Date(at))) % 24; } catch { return new Date(at).getUTCHours(); } };
const day = (at) => new Date(at).toISOString().slice(0, 10);

export const emptySignals = () => ({ formats: {}, topics: {}, watch: { n: 0, pctSum: 0, completes: 0, early: 0 }, quiz: { n: 0, right: 0, msSum: 0, skips: 0 }, hours: Array(24).fill(0), sessions: 0, lastSeenAt: 0, prefs: {}, days: {} });
export const emptySession = () => ({ sid: '', startedAt: 0, lastAt: 0, served: 0, viewed: 0, lastFormats: [], lastTopics: [], wrongStreak: 0, rightStreak: 0, earlyStreak: 0 });
const SESSION_GAP_MS = 30 * 60 * 1000;

const bump = (obj, key, field, by = 1) => { obj[key] ||= {}; obj[key][field] = (obj[key][field] || 0) + by; };

/**
 * Folds a batch of events for one viewer into every aggregate. Returns how many were accepted.
 * @param {string} userId
 * @param {{ ctx?: object, events: object[] }} batch
 */
export async function ingest(userId, batch) {
  const ctx = cleanContext(batch.ctx);
  const events = (Array.isArray(batch.events) ? batch.events : []).map(cleanEvent).filter(Boolean).slice(0, 200);
  if (!events.length) return { accepted: 0 };

  const [signals0, session0, progress0] = await Promise.all([kv.get(`user:${userId}:signals`), kv.get(`user:${userId}:session`), kv.get(`user:${userId}:progress`)]);
  const signals = { ...emptySignals(), ...(signals0 || {}) };
  let session = { ...emptySession(), ...(session0 || {}) };
  const progress = progress0 || {};
  const videos = new Map();
  const videoOf = async (id) => { if (!videos.has(id)) videos.set(id, await db.getVideo(id)); return videos.get(id); };
  const stat = (id, field, by = 1) => kv.hincrby(`video:${id}:stats`, field, by);
  const fstat = (v, field, by = 1) => {
    const f = v.format || 'explain';
    return Promise.all([kv.hincrby(`stats:format:${f}`, field, by), v.topic ? kv.hincrby(`stats:format:${f}:${v.topic}`, field, by) : null]);
  };
  const writes = [];
  const log = [];
  let accepted = 0;

  for (const e of events) {
    // Session boundaries: a new session after 30 quiet minutes or a new page load.
    if ((ctx.sid && session.sid !== ctx.sid) || (session.lastAt && e.at - session.lastAt > SESSION_GAP_MS)) {
      session = { ...emptySession(), sid: ctx.sid, startedAt: e.at };
      signals.sessions++;
    }
    session.lastAt = Math.max(session.lastAt, e.at);
    signals.lastSeenAt = Math.max(signals.lastSeenAt, e.at);
    signals.hours[hourOf(e.at, ctx.tz)]++;
    if (['view', 'complete', 'quiz_answer', 'heartbeat'].includes(e.type)) {
      signals.days ||= {};
      signals.days[day(e.at)] = 1;
      const keys = Object.keys(signals.days).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - 90))) delete signals.days[k];
    }

    const v = e.videoId ? await videoOf(e.videoId) : null;
    if (e.videoId && !v) continue;
    accepted++;
    const unitId = v ? v.unitId || (v.topic ? `topic:${v.topic}` : null) : null;
    const format = v?.format || 'explain';
    const topic = v?.topic || 'general';
    const unitEvent = (type, extra) => { if (unitId) progress[unitId] = applyEvent(progress[unitId] || emptyState(), type, { ...extra, now: e.at }); };
    writes.push(kv.hincrby(`events:day:${day(e.at)}`, e.type, 1));
    log.push(JSON.stringify({ u: userId.slice(0, 8), ...e, f: v ? format : undefined, tp: v ? topic : undefined }));

    switch (e.type) {
      case 'impression': writes.push(stat(v.id, 'impressions')); break;
      case 'view': {
        if (await db.inSet(userId, 'seen', v.id)) break; // once per viewer
        writes.push(db.addToSet(userId, 'seen', v.id), stat(v.id, 'views'), fstat(v, 'views'));
        bump(signals.formats, format, 'views'); bump(signals.topics, topic, 'views');
        session.viewed++;
        if (v.readyKey) {
          writes.push(kv.zincrby('popular:units', 1, v.readyKey));
          const user = await db.getUser(userId);
          if (user) writes.push(kv.set(`popular:audience:${v.readyKey}`, { unitId: v.unitId, audience: audienceFor(user) }));
        }
        writes.push(kv.lpush(`user:${userId}:history`, v.id), kv.ltrim(`user:${userId}:history`, 0, 199));
        unitEvent('view');
        break;
      }
      case 'heartbeat': writes.push(stat(v.id, 'heartbeats')); break;
      case 'scene': if (e.sceneId) writes.push(kv.hincrby(`video:${v.id}:scenes`, e.sceneId.slice(0, 24), 1)); break;
      case 'pause': writes.push(stat(v.id, 'pauses')); break;
      case 'loop': writes.push(stat(v.id, 'loops'), fstat(v, 'loops')); bump(signals.formats, format, 'loops'); break;
      case 'complete': {
        writes.push(stat(v.id, 'completes'), fstat(v, 'completes'));
        bump(signals.formats, format, 'completes'); bump(signals.topics, topic, 'completes');
        signals.watch.completes++;
        unitEvent('complete');
        break;
      }
      case 'leave': {
        const pct = e.pct ?? (v.duration ? Math.min(1, (e.maxT ?? e.watched ?? 0) / v.duration) : 0);
        const early = e.early ?? ((e.watched ?? e.watchedSec ?? 0) < 2);
        writes.push(stat(v.id, 'leaves'), stat(v.id, 'watchSec', Math.round(Math.min(600, e.watched ?? e.watchedSec ?? 0))), stat(v.id, 'pctSum', Math.round(pct * 100)), stat(v.id, WATCH_BUCKET(pct)));
        writes.push(fstat(v, 'leaves'), fstat(v, 'pctSum', Math.round(pct * 100)));
        bump(signals.formats, format, 'n'); bump(signals.formats, format, 'pctSum', pct);
        bump(signals.topics, topic, 'n'); bump(signals.topics, topic, 'pctSum', pct);
        signals.watch.n++; signals.watch.pctSum += pct;
        session.lastFormats = [format, ...session.lastFormats].slice(0, 6);
        session.lastTopics = [topic, ...session.lastTopics].slice(0, 6);
        if (e.dir) writes.push(stat(v.id, `dir_${e.dir.replace(/[^a-z]/g, '').slice(0, 8)}`));
        unitEvent('leave', { pct });
        if (early) {
          writes.push(stat(v.id, 'skips'), fstat(v, 'skips'));
          bump(signals.formats, format, 'skips'); bump(signals.topics, topic, 'skips');
          signals.watch.early++; session.earlyStreak++;
          unitEvent('skip');
        } else session.earlyStreak = 0;
        break;
      }
      case 'skip': writes.push(stat(v.id, 'skips'), fstat(v, 'skips')); bump(signals.formats, format, 'skips'); unitEvent('skip'); break;
      case 'rewatch': writes.push(stat(v.id, 'rewatches'), fstat(v, 'rewatches')); bump(signals.formats, format, 'rewatches'); break;
      case 'like': {
        if (await db.inSet(userId, 'liked', v.id)) break;
        writes.push(db.addToSet(userId, 'liked', v.id), stat(v.id, 'likes'), fstat(v, 'likes'));
        bump(signals.formats, format, 'likes'); bump(signals.topics, topic, 'likes');
        unitEvent('like');
        break;
      }
      case 'unlike': {
        if (!(await db.inSet(userId, 'liked', v.id))) break;
        writes.push(db.removeFromSet(userId, 'liked', v.id), stat(v.id, 'likes', -1), fstat(v, 'likes', -1));
        bump(signals.formats, format, 'likes', -1);
        unitEvent('unlike');
        break;
      }
      case 'save': {
        if (await db.inSet(userId, 'saved', v.id)) break;
        writes.push(db.addToSet(userId, 'saved', v.id), stat(v.id, 'saves'), fstat(v, 'saves'));
        bump(signals.formats, format, 'saves'); bump(signals.topics, topic, 'saves');
        break;
      }
      case 'unsave': {
        if (!(await db.inSet(userId, 'saved', v.id))) break;
        writes.push(db.removeFromSet(userId, 'saved', v.id), stat(v.id, 'saves', -1), fstat(v, 'saves', -1));
        break;
      }
      case 'less': writes.push(stat(v.id, 'less'), fstat(v, 'less')); bump(signals.formats, format, 'less'); bump(signals.topics, topic, 'less'); unitEvent('less'); break;
      case 'why_open': writes.push(stat(v.id, 'whyOpens')); break;
      case 'quiz_shown': writes.push(stat(v.id, 'quizShown')); break;
      case 'quiz_hold': writes.push(stat(v.id, 'quizHeld')); break;
      case 'quiz_answer': {
        if (await db.inSet(userId, 'answered', v.id)) break;
        writes.push(db.addToSet(userId, 'answered', v.id), stat(v.id, e.correct ? 'quizRight' : 'quizWrong'), fstat(v, e.correct ? 'quizRight' : 'quizWrong'));
        if (e.ms) writes.push(stat(v.id, 'answerMs', Math.round(Math.min(120000, e.ms))));
        if (Number.isInteger(e.choice)) writes.push(stat(v.id, `choice${Math.min(2, e.choice)}`));
        bump(signals.formats, format, e.correct ? 'right' : 'wrong'); bump(signals.topics, topic, e.correct ? 'right' : 'wrong');
        signals.quiz.n++; signals.quiz.msSum += Math.min(120000, e.ms || 0); if (e.correct) signals.quiz.right++;
        if (e.correct) { session.rightStreak++; session.wrongStreak = 0; } else { session.wrongStreak++; session.rightStreak = 0; }
        unitEvent('quiz_answer', { correct: Boolean(e.correct) });
        break;
      }
      case 'quiz_skip': writes.push(stat(v.id, 'quizSkips'), fstat(v, 'quizSkips')); signals.quiz.skips++; bump(signals.formats, format, 'quizSkips'); break;
      case 'player_error': writes.push(stat(v.id, 'errors')); break;
      case 'gen_wait': writes.push(kv.hincrby('stats:generation', e.outcome === 'ready' ? 'waitedReady' : 'waitedGaveUp', 1), kv.hincrby('stats:generation', 'waitMs', Math.round(e.ms || 0))); break;
      case 'pref_change': if (e.key) signals.prefs[e.key.slice(0, 16)] = e.value; break;
      case 'session_start': session.served = session.served || 0; break;
      default: break;
    }
  }

  writes.push(
    kv.set(`user:${userId}:signals`, signals),
    kv.set(`user:${userId}:session`, session),
    kv.set(`user:${userId}:progress`, progress),
    kv.lpush('events:log', ...log), kv.ltrim('events:log', 0, 19999),
  );
  await Promise.all(writes.flat());
  return { accepted };
}

/** Consecutive active days ending today or yesterday (UTC days). */
export function streakOf(signals, now = Date.now()) {
  const days = signals?.days || {};
  let streak = 0;
  let t = now;
  if (!days[day(t)]) t -= 86400000; // a streak survives until the end of the next day
  while (days[day(t)]) { streak++; t -= 86400000; }
  return streak;
}

/** Headline numbers for the Profile and Library (stickers, tiles, the buddy's line). */
export async function studentStats(userId, { watched = 0, progress = {}, masteryOf = () => 0 } = {}) {
  const s = await getSignals(userId);
  return {
    watched, streak: streakOf(s), sessions: s.sessions || 0,
    quizN: s.quiz?.n || 0, quizRight: s.quiz?.right || 0,
    mastered: Object.values(progress).filter((st) => masteryOf(st) >= 0.7).length,
  };
}

/** Marks videos as served in the viewer's session (called by the feed, not by the app). */
export async function noteServed(userId, videos) {
  const session = { ...emptySession(), ...((await kv.get(`user:${userId}:session`)) || {}) };
  session.served += videos.length;
  session.lastAt = Math.max(session.lastAt, Date.now());
  await kv.set(`user:${userId}:session`, session);
}

export const getSignals = async (userId) => ({ ...emptySignals(), ...((await kv.get(`user:${userId}:signals`)) || {}) });
export async function getSession(userId) {
  const s = { ...emptySession(), ...((await kv.get(`user:${userId}:session`)) || {}) };
  return s.lastAt && Date.now() - s.lastAt > SESSION_GAP_MS ? { ...emptySession(), sid: s.sid } : s;
}

// ---- Public, anonymous aggregates (GET /api/stats) ------------------------------------------------
export async function stats({ formats = [] } = {}) {
  const num = (h, k) => Number(h?.[k]) || 0;
  const byFormat = {};
  for (const f of formats) {
    const h = await kv.hgetall(`stats:format:${f}`);
    const views = num(h, 'views'), leaves = num(h, 'leaves');
    byFormat[f] = {
      views, completes: num(h, 'completes'), likes: num(h, 'likes'), saves: num(h, 'saves'), skips: num(h, 'skips'), loops: num(h, 'loops'),
      completionRate: views ? +(num(h, 'completes') / views).toFixed(3) : null,
      meanWatch: leaves ? +(num(h, 'pctSum') / 100 / leaves).toFixed(3) : null,
      quizAccuracy: num(h, 'quizRight') + num(h, 'quizWrong') ? +(num(h, 'quizRight') / (num(h, 'quizRight') + num(h, 'quizWrong'))).toFixed(3) : null,
    };
  }
  const days = {};
  for (let i = 13; i >= 0; i--) {
    const d = day(Date.now() - i * 86400000);
    const h = await kv.hgetall(`events:day:${d}`);
    if (h) days[d] = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Number(v) || 0]));
  }
  const gen = (await kv.hgetall('stats:generation')) || {};
  return { library: await db.readyCount(), byFormat, days, generation: { waitedReady: num(gen, 'waitedReady'), waitedGaveUp: num(gen, 'waitedGaveUp'), meanWaitMs: num(gen, 'waitedReady') + num(gen, 'waitedGaveUp') ? Math.round(num(gen, 'waitMs') / (num(gen, 'waitedReady') + num(gen, 'waitedGaveUp'))) : null } };
}

/** How each format performs on a topic, as a multiplier around 1 (shrunk toward 1 with little data). */
export async function formatPerformance(topic, formats) {
  const out = {};
  for (const f of formats) {
    const h = (await kv.hgetall(`stats:format:${f}:${topic}`)) || (await kv.hgetall(`stats:format:${f}`)) || {};
    const leaves = Number(h.leaves) || 0, views = Number(h.views) || 0;
    if (!leaves && !views) { out[f] = 1; continue; }
    const meanWatch = leaves ? Number(h.pctSum) / 100 / leaves : 0.5;
    const completion = views ? (Number(h.completes) || 0) / views : 0.5;
    const skipRate = views ? (Number(h.skips) || 0) / views : 0;
    const raw = 0.5 + meanWatch * 0.6 + completion * 0.4 - skipRate * 0.5; // ≈1 for an average video
    const n = Math.max(leaves, views);
    const conf = n / (n + 20);
    out[f] = +Math.max(0.6, Math.min(1.4, 1 + conf * (raw - 1))).toFixed(3);
  }
  return out;
}
