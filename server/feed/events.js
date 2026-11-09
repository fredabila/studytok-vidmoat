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
import { recordMiss, recordRecall, getMisses } from './recall.js';
import * as db from '../core/db.js';
import { applyEvent, emptyState, mastery } from './ranking.js';
import { audienceFor } from './index.js';
import { isBreatherUnit } from './breathers.js';
import { FORMAT_IDS } from '../video/formats.js';

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
  heartbeat: { video: true, fields: { t: 'n', watched: 'n', loops: 'i', posture: 's' } },
  scene: { video: true, fields: { sceneId: 's', kind: 's', t: 'n' } },
  pause: { video: true, fields: { t: 'n', by: 's' } },
  resume: { video: true, fields: { t: 'n' } },
  loop: { video: true, fields: { loops: 'i' } },
  complete: { video: true, fields: {} },
  leave: { video: true, fields: { t: 'n', watched: 'n', maxT: 'n', pct: 'p', loops: 'i', dir: 's', early: 'b', watchedSec: 'n', posture: 's' } },
  drop: { fields: { videoId: 's', t: 'n' } },
  sensors: { fields: { motion: 'b', permission: 's' } },
  sound_unlock: { video: true, fields: { t: 'n' } },
  player_retry: { video: true, fields: { n: 'i' } },
  lesson_share: { video: true, fields: { by: 's' } },
  moment_view: { fields: { id: 's', kind: 's' } },
  moment_cta: { fields: { id: 's', action: 's' } },
  recall_view: { fields: { id: 's' } },
  recall_answer: { fields: { id: 's', correct: 'b', ms: 'n' } },
  recall_skip: { fields: { id: 's' } },
  reset: { fields: { scope: 's' } },
  play_pref: { fields: { key: 's', value: 's' } },
  gaps_on: { video: true, fields: { auto: 'b' } },
  gaps_reveal: { video: true, fields: { t: 'n' } },
  chapter_seek: { video: true, fields: { from: 'n', to: 'n' } },
  quiz_stamp: { video: true, fields: {} },
  pack_add: { fields: { slug: 's', by: 's' } },
  pack_remove: { fields: { slug: 's' } },
  pack_link: { fields: { slug: 's' } },
  library_search: { fields: { q: 's' } },
  explore_open: { fields: {} },
  notes_open: { video: true, fields: {} },
  notes_copy: { video: true, fields: {} },
  plan_open: { fields: { unitId: 's' } },
  explore_search: { fields: { q: 's' } },
  invite_share: { fields: {} },
  refresh: { fields: { where: 's' } },
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
  level_up: { fields: { unitId: 's' } },
  recap_share: { fields: { week: 's' } },
  levelup_share: { fields: { unitId: 's' } },
  profile_share: { fields: {} },
  // reminders (public/push.js)
  push_enabled: { fields: {} },
  push_disabled: { fields: {} },
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
    orientation: str(c.orientation, 12), posture: str(c.posture, 12), battery: str(c.battery, 8), charging: c.charging === true,
  };
}

// ---- Aggregation ----------------------------------------------------------------------------------
const WATCH_BUCKET = (pct) => `wf${Math.min(4, Math.floor(pct * 5))}`; // wf0: <20% … wf4: ≥80%
/** Hour of the day (0..23) at `at` in the viewer's time zone, UTC when unknown or invalid. */
export const hourOf = (at, tz) => { try { return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz || 'UTC' }).format(new Date(at))) % 24; } catch { return new Date(at).getUTCHours(); } };
export const day = (at) => new Date(at).toISOString().slice(0, 10);

export const emptySignals = () => ({ formats: {}, topics: {}, watch: { n: 0, pctSum: 0, completes: 0, early: 0 }, quiz: { n: 0, right: 0, msSum: 0, skips: 0 }, hours: Array(24).fill(0), sessions: 0, lastSeenAt: 0, prefs: {}, days: {}, weeks: {} });
/** Monday of the week containing `at`, as YYYY-MM-DD (UTC): the key of a weekly recap. */
export function weekKey(at) {
  const d = new Date(at);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
const emptyWeek = () => ({ watched: 0, completes: 0, watchSec: 0, quizN: 0, quizRight: 0, units: {}, formats: {}, days: {}, mastered: [] });
export const emptySession = () => ({ sid: '', startedAt: 0, lastAt: 0, served: 0, viewed: 0, quizN: 0, quizRight: 0, lastFormats: [], lastTopics: [], wrongStreak: 0, rightStreak: 0, earlyStreak: 0, posture: 'unknown', hour: null, night: false });
const POSTURES = new Set(['hand', 'flat', 'moving', 'unknown']);
/** The scene a timeline time falls in (for drop-off curves), by kind. */
const sceneKindAt = (video, t) => { const s = (video?.scenes || []).findLast((x) => t >= x.start); return s?.kind || null; };
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
  const levelUps = [];
  let accepted = 0;

  for (const e of events) {
    // Session boundaries: a new session after 30 quiet minutes or a new page load.
    if ((ctx.sid && session.sid !== ctx.sid) || (session.lastAt && e.at - session.lastAt > SESSION_GAP_MS)) {
      session = { ...emptySession(), sid: ctx.sid, startedAt: e.at };
      signals.sessions++;
    }
    session.lastAt = Math.max(session.lastAt, e.at);
    signals.lastSeenAt = Math.max(signals.lastSeenAt, e.at);
    const hour = hourOf(e.at, ctx.tz);
    signals.hours[hour]++;
    // Context the ranking reads: how the phone is held right now, and whether it is late.
    const posture = POSTURES.has(e.posture) ? e.posture : POSTURES.has(ctx.posture) ? ctx.posture : null;
    if (posture && posture !== 'unknown') session.posture = posture;
    session.hour = hour; session.night = hour >= 22 || hour < 5;
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
    const unitEvent = (type, extra) => {
      if (!unitId || isBreatherUnit(unitId)) return; // breathers are a detour, not the syllabus
      const before = mastery(progress[unitId]);
      progress[unitId] = applyEvent(progress[unitId] || emptyState(), type, { ...extra, now: e.at });
      // Crossing the mastery line is a level-up: told to the app for its burst, kept in the week's recap.
      if (before < 0.7 && mastery(progress[unitId]) >= 0.7) {
        const title = v?.unitTitle || unitId;
        levelUps.push({ unitId, title });
        if (!week.mastered.includes(title)) week.mastered.push(title);
      }
    };
    // Weekly recap counters.
    signals.weeks ||= {};
    const wk = weekKey(e.at);
    const week = signals.weeks[wk] ||= emptyWeek();
    if (v && ['view', 'complete', 'leave', 'quiz_answer'].includes(e.type)) {
      week.days[day(e.at)] = 1;
      if (e.type === 'view') { week.watched++; if (unitId) week.units[unitId] = v.unitTitle || unitId; week.formats[format] = (week.formats[format] || 0) + 1; }
      if (e.type === 'complete') week.completes++;
      if (e.type === 'leave') week.watchSec += Math.round(Math.min(600, e.watched ?? e.watchedSec ?? 0));
      if (e.type === 'quiz_answer' && !(await db.inSet(userId, 'answered', v.id))) { week.quizN++; if (e.correct) week.quizRight++; }
    }
    writes.push(kv.hincrby(`events:day:${day(e.at)}`, e.type, 1));
    if (e.type === 'quiz_answer') writes.push(kv.hincrby(`events:day:${day(e.at)}`, e.correct ? 'quiz_answer_right' : 'quiz_answer_wrong', 1));
    if (e.type.endsWith('_share')) signals.shares = (signals.shares || 0) + 1;
    log.push(JSON.stringify({ u: userId.slice(0, 8), ...e, f: v ? format : undefined, tp: v ? topic : undefined }));

    switch (e.type) {
      case 'impression': writes.push(stat(v.id, 'impressions')); break;
      case 'view': {
        if (await db.inSet(userId, 'seen', v.id)) break; // once per viewer
        writes.push(db.addToSet(userId, 'seen', v.id), stat(v.id, 'views'), fstat(v, 'views'));
        bump(signals.formats, format, 'views'); bump(signals.topics, topic, 'views');
        session.viewed++;
        signals.today = signals.today?.date === day(e.at) ? { date: day(e.at), n: signals.today.n + 1 } : { date: day(e.at), n: 1 }; // the daily goal
        if (v.readyKey) {
          writes.push(kv.zincrby('popular:units', 1, v.readyKey));
          const user = await db.getUser(userId);
          if (user) writes.push(kv.set(`popular:audience:${v.readyKey}`, { unitId: v.unitId, audience: audienceFor(user) }));
        }
        writes.push(kv.lpush(`user:${userId}:history`, `${v.id}|${e.at}`), kv.ltrim(`user:${userId}:history`, 0, 199));
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
        if (isBreatherUnit(v.unitId)) { signals.breathers ||= { n: 0, pctSum: 0, less: 0 }; signals.breathers.n++; signals.breathers.pctSum += pct; writes.push(kv.hincrby(`events:day:${day(e.at)}`, 'breather_view', 1)); }
        session.lastFormats = [format, ...session.lastFormats].slice(0, 6);
        session.lastTopics = [topic, ...session.lastTopics].slice(0, 6);
        if (e.dir) writes.push(stat(v.id, `dir_${e.dir.replace(/[^a-z]/g, '').slice(0, 8)}`));
        // Where in the video people leave (by scene kind), per format: the drop-off curve.
        const leftIn = pct < 0.95 ? sceneKindAt(v, e.t ?? e.maxT ?? 0) : 'end';
        if (leftIn) writes.push(kv.hincrby(`stats:format:${format}:leaveAt`, leftIn, 1));
        // Sound: how each narrator voice and music mood holds attention; hooks: which opening styles do.
        if (v.voice?.voiceId) writes.push(kv.hincrby(`stats:voice:${v.voice.voiceId}`, 'n', 1), kv.hincrby(`stats:voice:${v.voice.voiceId}`, 'pctSum', Math.round(pct * 100)));
        if (v.musicMood) writes.push(kv.hincrby(`stats:music:${v.musicMood}`, 'n', 1), kv.hincrby(`stats:music:${v.musicMood}`, 'pctSum', Math.round(pct * 100)));
        if (v.lesson?.hookStyle) {
          const hk = `stats:hook:${v.lesson.hookStyle}`;
          writes.push(kv.hincrby(hk, 'n', 1), kv.hincrby(hk, 'pctSum', Math.round(pct * 100)), kv.hincrby(`${hk}:${topic}`, 'n', 1), kv.hincrby(`${hk}:${topic}`, 'pctSum', Math.round(pct * 100)));
          if (early) writes.push(kv.hincrby(hk, 'early', 1), kv.hincrby(`${hk}:${topic}`, 'early', 1));
          bump(signals.hooks ||= {}, v.lesson.hookStyle, 'n'); bump(signals.hooks, v.lesson.hookStyle, 'pctSum', pct); if (early) bump(signals.hooks, v.lesson.hookStyle, 'early');
        }
        if (e.posture && POSTURES.has(e.posture)) { bump(signals.postures ||= {}, e.posture, 'n'); bump(signals.postures, e.posture, 'pctSum', pct); }
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
        writes.push(kv.get(`user:${userId}:savedAt`).then((m) => kv.set(`user:${userId}:savedAt`, { ...(m || {}), [v.id]: e.at })));
        bump(signals.formats, format, 'saves'); bump(signals.topics, topic, 'saves');
        break;
      }
      case 'unsave': {
        if (!(await db.inSet(userId, 'saved', v.id))) break;
        writes.push(db.removeFromSet(userId, 'saved', v.id), stat(v.id, 'saves', -1), fstat(v, 'saves', -1));
        break;
      }
      case 'less': writes.push(stat(v.id, 'less'), fstat(v, 'less')); bump(signals.formats, format, 'less'); bump(signals.topics, topic, 'less'); if (isBreatherUnit(v.unitId)) { signals.breathers ||= { n: 0, pctSum: 0, less: 0 }; signals.breathers.less++; } unitEvent('less'); break;
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
        session.quizN = (session.quizN || 0) + 1; if (e.correct) session.quizRight = (session.quizRight || 0) + 1;
        if (!e.correct) writes.push(recordMiss(userId, v, e.at)); // comes back as a recall card
        if (e.correct) { session.rightStreak++; session.wrongStreak = 0; } else { session.wrongStreak++; session.rightStreak = 0; }
        unitEvent('quiz_answer', { correct: Boolean(e.correct) });
        break;
      }
      case 'quiz_skip': writes.push(stat(v.id, 'quizSkips'), fstat(v, 'quizSkips')); signals.quiz.skips++; bump(signals.formats, format, 'quizSkips'); break;
      case 'recall_answer': {
        signals.recall ||= { n: 0, right: 0, retired: 0 };
        signals.recall.n++; if (e.correct) signals.recall.right++;
        writes.push(recordRecall(userId, e.id, Boolean(e.correct), e.at).then((o) => { if (o === 'retired') writes.push(kv.hincrby(`events:day:${day(e.at)}`, 'recall_retired', 1)); }));
        if (e.correct) { session.rightStreak++; session.wrongStreak = 0; } else { session.wrongStreak++; session.rightStreak = 0; }
        break;
      }
      case 'player_error': writes.push(stat(v.id, 'errors')); break;
      case 'drop': writes.push(kv.hincrby('stats:device', 'drops', 1)); break;
      case 'sensors': writes.push(kv.hincrby('stats:device', e.motion ? 'motionOn' : 'motionOff', 1), kv.hincrby('stats:device', `perm_${(e.permission || 'unknown').replace(/[^a-z-]/g, '')}`, 1)); break;
      case 'gen_wait': writes.push(kv.hincrby('stats:generation', e.outcome === 'ready' ? 'waitedReady' : 'waitedGaveUp', 1), kv.hincrby('stats:generation', 'waitMs', Math.round(e.ms || 0))); break;
      case 'pref_change': if (e.key) signals.prefs[e.key.slice(0, 16)] = e.value; break;
      case 'session_start': session.served = session.served || 0; break;
      default: break;
    }
  }

  // The device the student last used (for the admin sheet; the ranking does not read it).
  if (ctx.platform || ctx.tz) signals.device = { platform: ctx.platform, standalone: ctx.standalone, tz: ctx.tz, lang: ctx.lang };
  writes.push(kv.zadd('users:active', { score: signals.lastSeenAt || Date.now(), member: userId }));
  // Keep the last 8 weeks of recaps.
  for (const k of Object.keys(signals.weeks || {}).sort().slice(0, -8)) delete signals.weeks[k];
  writes.push(
    kv.set(`user:${userId}:signals`, signals),
    kv.set(`user:${userId}:session`, session),
    kv.set(`user:${userId}:progress`, progress),
    kv.lpush('events:log', ...log), kv.ltrim('events:log', 0, 19999),
  );
  await Promise.all(writes.flat());
  return { accepted, levelUps };
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

/** One week's recap, shaped for the sticker card (null when nothing happened). */
export function recapOf(signals, key) {
  const w = signals?.weeks?.[key];
  if (!w || !w.watched) return null;
  const topFormat = Object.entries(w.formats).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return {
    week: key, watched: w.watched, completes: w.completes, minutes: Math.round(w.watchSec / 60), quizN: w.quizN, quizRight: w.quizRight,
    units: Object.values(w.units).slice(0, 6), unitCount: Object.keys(w.units).length, days: Object.keys(w.days).length,
    topFormat, formats: Object.keys(w.formats).length, mastered: w.mastered || [],
  };
}

export const DAILY_GOAL = 3;

/**
 * Quiz difficulty on a topic, for the writer: when nearly everyone gets the quick checks right the
 * questions are too easy; when most get them wrong they are unclear. Null until there is evidence.
 */
export async function quizGuidance(topic, { minAnswers = 20 } = {}) {
  let right = 0, wrong = 0;
  for (const f of FORMAT_IDS) {
    const h = await kv.hgetall(`stats:format:${f}:${topic}`);
    right += Number(h?.quizRight) || 0; wrong += Number(h?.quizWrong) || 0;
  }
  if (right + wrong < minAnswers) return null;
  const acc = right / (right + wrong);
  if (acc >= 0.88) return `Quick checks on this topic are answered right ${Math.round(acc * 100)}% of the time: make them harder. Distractors should be real misconceptions, and the question should apply the idea rather than restate it.`;
  if (acc <= 0.45) return `Quick checks on this topic are answered wrong ${Math.round((1 - acc) * 100)}% of the time: make them clearer. Ask about the main idea in plain words, and make sure the video states the answer plainly before the question.`;
  return null;
}

/** Headline numbers for the Profile and Library (stickers, tiles, the buddy's line). */
export async function studentStats(userId, { watched = 0, progress = {}, masteryOf = () => 0, now = Date.now() } = {}) {
  const s = await getSignals(userId);
  const thisWeek = weekKey(now);
  const lastWeek = weekKey(now - 7 * 86400000);
  return {
    watched, streak: streakOf(s), sessions: s.sessions || 0,
    quizN: s.quiz?.n || 0, quizRight: s.quiz?.right || 0,
    mastered: Object.values(progress).filter((st) => masteryOf(st) >= 0.7).length,
    // The daily goal (lessons watched today) and what spaced repetition says is due right now.
    today: s.today?.date === day(now) ? s.today.n : 0, goal: DAILY_GOAL,
    due: Object.values(progress).filter((st) => st.lastSeen && st.due && st.due <= now && !(masteryOf(st) >= 0.7 && st.box >= 3)).length,
    misses: (await getMisses(userId)).length, // quick checks got wrong, waiting to come back
    recallN: s.recall?.n || 0, recallRight: s.recall?.right || 0,
    week: recapOf(s, thisWeek), lastWeek: recapOf(s, lastWeek),
  };
}

/**
 * Records that a breather was just served at `viewed` videos into the session, so the next one
 * waits a few videos (feed/breathers.js). Kept in its own key: the session object is rewritten by
 * every events batch and a concurrent one would lose the marker.
 */
export async function noteBreather(userId, viewed = 0) {
  const mark = (await kv.get(`user:${userId}:breather`)) || { count: 0 };
  await kv.set(`user:${userId}:breather`, { at: viewed, count: (mark.count || 0) + 1, lastAt: Date.now() });
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
  // Where each format loses people, which hooks hold attention, which voices and moods do.
  const leaveAt = {};
  for (const f of formats) { const h = await kv.hgetall(`stats:format:${f}:leaveAt`); if (h) leaveAt[f] = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Number(v) || 0])); }
  const rate = (h) => ({ n: num(h, 'n'), meanWatch: num(h, 'n') ? +(num(h, 'pctSum') / 100 / num(h, 'n')).toFixed(3) : null, earlyRate: num(h, 'n') ? +(num(h, 'early') / num(h, 'n')).toFixed(3) : null });
  const hooks = {};
  for (const s of HOOK_STYLES) { const h = await kv.hgetall(`stats:hook:${s}`); if (h) hooks[s] = rate(h); }
  const voices = {};
  for (const vId of VOICES) { const h = await kv.hgetall(`stats:voice:${vId}`); if (h) voices[vId] = rate(h); }
  const gen = (await kv.hgetall('stats:generation')) || {};
  return { library: await db.readyCount(), byFormat, leaveAt, hooks, voices, device: (await kv.hgetall('stats:device')) || {}, days, generation: { waitedReady: num(gen, 'waitedReady'), waitedGaveUp: num(gen, 'waitedGaveUp'), meanWaitMs: num(gen, 'waitedReady') + num(gen, 'waitedGaveUp') ? Math.round(num(gen, 'waitMs') / (num(gen, 'waitedReady') + num(gen, 'waitedGaveUp'))) : null } };
}

export const HOOK_STYLES = ['curiosity', 'challenge', 'number', 'question', 'pain', 'claim', 'story', 'secret'];
export const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];

/**
 * Which hook styles hold attention on a topic (and for this student, when known): lists for the
 * writer. A style counts once it has 15+ views; "hold" means mean watch ≥ 55% with few early
 * leaves, "lose" means early leaves ≥ 35%.
 */
export async function hookGuidance(topic, signals = null) {
  const hold = [], lose = [];
  for (const s of HOOK_STYLES) {
    const h = (await kv.hgetall(`stats:hook:${s}:${topic}`)) || (await kv.hgetall(`stats:hook:${s}`));
    const n = Number(h?.n) || 0;
    if (n < 15) continue;
    const mean = Number(h.pctSum) / 100 / n, early = (Number(h.early) || 0) / n;
    if (early >= 0.35) lose.push(s); else if (mean >= 0.55) hold.push(s);
  }
  const mine = signals?.hooks ? Object.entries(signals.hooks).filter(([, v]) => v.n >= 4).sort((a, b) => b[1].pctSum / b[1].n - a[1].pctSum / a[1].n).map(([k]) => k) : [];
  return { hold, lose, student: mine.slice(0, 3) };
}

/** The best-performing narrator voice for a format once there is enough evidence, else null. */
export async function bestVoiceFor(candidates, { minViews = 40, margin = 0.08 } = {}) {
  let best = null;
  for (const vId of candidates) {
    const h = await kv.hgetall(`stats:voice:${vId}`);
    const n = Number(h?.n) || 0;
    if (n < minViews) continue;
    const mean = Number(h.pctSum) / 100 / n;
    if (!best || mean > best.mean) best = { voiceId: vId, mean, n };
  }
  if (!best) return null;
  const base = candidates[0] && (await kv.hgetall(`stats:voice:${candidates[0]}`));
  const baseMean = base && Number(base.n) ? Number(base.pctSum) / 100 / Number(base.n) : null;
  return baseMean == null || best.mean - baseMean >= margin ? best.voiceId : null;
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
