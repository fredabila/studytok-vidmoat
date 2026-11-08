// The "For You" feed: profiles, picking units with the algorithm (recommend.js), choosing or
// generating a video for each, keeping a few videos generating ahead of the viewer, and
// turning engagement into per-unit progress.

import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { INTEREST_TOPICS, TOPIC_BY_ID } from './topics.js';
import { level as levelOf, LEVEL_BY_ID } from './levels.js';
import { getUnit, getProgram, interestUnit } from './curriculum.js';
import { lessonKey } from './lessons/index.js';
import { startVideo } from './generator.js';
import { pickUnits, applyEvent, emptyState, mastery, videoQuality } from './recommend.js';
import { kv } from './kv.js';
import * as db from './db.js';

const clean = (s, n = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------------------------------------------------------------- profiles
export function cleanProfile(p = {}) {
  return {
    level: LEVEL_BY_ID[p.level] ? p.level : 'lifelong',
    country: clean(p.country, 60),
    institution: clean(p.institution, 120),
    program: clean(p.program, 120),
    exam: clean(p.exam, 60),
  };
}

/** body: { profile, programKey?, units?: string[], interests?: string[] } */
export async function saveProfile(userId, body) {
  const existing = userId ? await db.getUser(userId) : null;
  const user = {
    id: existing?.id || randomUUID(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    profile: cleanProfile(body.profile || existing?.profile),
    // One or more courses (e.g. several high-school subjects).
    programKeys: Array.isArray(body.programKeys) ? body.programKeys.map((k) => String(k).slice(0, 40)).slice(0, 8)
      : typeof body.programKey === 'string' ? [body.programKey.slice(0, 40)] : existing?.programKeys || [],
    units: Array.isArray(body.units) ? body.units.map(String).slice(0, 40) : existing?.units || [],
    interests: Array.isArray(body.interests) ? body.interests.filter((t) => TOPIC_BY_ID[t]).slice(0, 14) : existing?.interests || [],
    vidmoat: existing?.vidmoat || null,
    setupDone: true,
  };
  // A student needs something to watch: with nothing chosen, fall back to all interest topics.
  if (!user.units.length && !user.interests.length) user.interests = INTEREST_TOPICS.map((t) => t.id);
  await db.saveUser(user);
  return user;
}

export function audienceFor(user) {
  const p = user.profile || cleanProfile();
  const lvl = levelOf(p.level);
  return { level: lvl.id, levelLabel: lvl.label, audience: lvl.audience, country: p.country, institution: p.institution, exam: p.exam };
}

// ---------------------------------------------------------------- progress
const progressKey = (userId) => `user:${userId}:progress`;
export const getProgress = async (userId) => (await kv.get(progressKey(userId))) || {};
async function updateProgress(userId, unitId, type, extra) {
  const all = await getProgress(userId);
  all[unitId] = applyEvent(all[unitId] || emptyState(), type, extra);
  await kv.set(progressKey(userId), all);
  return all[unitId];
}

async function candidatesFor(user) {
  const out = [];
  const course = (await Promise.all(user.units.map((id) => getUnit(id)))).filter(Boolean);
  const sizes = {};
  for (const u of course) sizes[u.programKey || 'course'] = (sizes[u.programKey || 'course'] || 0) + 1;
  const seen = {};
  course.forEach((unit, order) => {
    const group = unit.programKey || 'course';
    seen[group] = (seen[group] || 0) + 1;
    out.push({ unit, kind: 'course', order, group, pos: { index: seen[group], total: sizes[group] } });
  });
  for (const t of user.interests) {
    const unit = interestUnit(t);
    if (unit && !out.some((c) => c.unit.id === unit.id)) out.push({ unit, kind: 'interest' });
  }
  return { candidates: out, hasCourse: course.length > 0 };
}

// ---------------------------------------------------------------- choosing videos
/** Best ready video for this unit+level the viewer has not seen or been served. */
async function reusable(userId, readyKey, taken) {
  const ids = (await db.readyIds(readyKey, 60)).filter((id) => !taken.has(id));
  if (!ids.length) return null;
  const blocked = await db.inAnySet(userId, ['seen', 'served'], ids);
  const candidates = ids.filter((_, i) => !blocked[i]).slice(0, 12);
  if (!candidates.length) return null;
  const stats = await Promise.all(candidates.map((id) => db.getStats(id)));
  let best = 0;
  for (let i = 1; i < candidates.length; i++) if (videoQuality(stats[i]) > videoQuality(stats[best])) best = i;
  return db.getVideo(candidates[best]);
}

/** Videos this viewer already has generating (so prefetch does not pile up). */
async function generatingFor(userId) {
  const ids = await kv.lrange(`user:${userId}:generating`, 0, 20);
  const vids = await Promise.all(ids.map((id) => db.getVideo(id)));
  return vids.filter((v) => v?.status === 'generating');
}

/**
 * Returns `count` feed items plus the promises of generation work started (pass them to
 * waitUntil on serverless). Ready, unseen library videos are served first; units without one
 * get a new video started. A few more are started ahead for the units likely to come next.
 */
export async function nextItems(userId, count = 3) {
  const user = await db.getUser(userId);
  const audience = audienceFor(user);
  const { candidates, hasCourse } = await candidatesFor(user);
  const states = await getProgress(userId);
  const recent = (await kv.lrange(`user:${userId}:recentUnits`, 0, 9)) || [];

  // No exploration for a new student's first videos: start them at the beginning of the syllabus.
  const servedSoFar = Object.values(states).reduce((n, s) => n + (s.served || 0), 0);
  const picks = pickUnits(candidates, states, recent, count + 2, { hasCourse, explore: servedSoFar < 8 ? 0 : 0.1 });
  const items = [];
  const pending = [];
  const taken = new Set();
  let generating = (await generatingFor(userId)).length;

  for (const [i, pick] of picks.entries()) {
    const key = lessonKey(pick.unit.id, audience);
    const ready = await reusable(userId, key, taken);
    if (i < count) {
      let video = ready;
      if (!video) {
        const started = await startVideo(pick.unit, audience, { requestedBy: userId });
        video = started.video;
        pending.push(started.done);
        generating++;
        await kv.lpush(`user:${userId}:generating`, video.id);
      }
      taken.add(video.id);
      items.push({ video, unit: pick.unit, why: { ...pick.parts, kind: pick.kind }, pos: pick.pos || null });
    } else if (!ready && generating < config.generation.readyAhead) {
      // Prefetch: start the likely next units now so they are ready when the viewer gets there.
      const started = await startVideo(pick.unit, audience, { requestedBy: userId });
      pending.push(started.done);
      generating++;
      await kv.lpush(`user:${userId}:generating`, started.video.id);
    }
  }
  await kv.ltrim(`user:${userId}:generating`, 0, 19);
  await db.addToSet(userId, 'served', ...items.map((x) => x.video.id));
  for (const x of items) {
    await kv.lpush(`user:${userId}:recentUnits`, x.unit.id);
    await updateProgress(userId, x.unit.id, 'served');
  }
  await kv.ltrim(`user:${userId}:recentUnits`, 0, 19);
  return { items, pending };
}

// ---------------------------------------------------------------- events
const STAT_FOR = { view: 'views', complete: 'completes', like: 'likes', skip: 'skips', save: 'saves' };

export async function recordEvent(userId, { videoId, type, watchedSec = 0, correct }) {
  const video = await db.getVideo(videoId);
  if (!video) return false;
  const unitId = video.unitId || (video.topic ? `topic:${video.topic}` : null);

  // Once-per-viewer events.
  const onceSets = { view: 'seen', like: 'liked', save: 'saved', quiz_answer: 'answered' };
  if (onceSets[type]) {
    if (await db.inSet(userId, onceSets[type], videoId)) return true;
    await db.addToSet(userId, onceSets[type], videoId);
  }
  if (type === 'unlike' || type === 'unsave') {
    const set = type === 'unlike' ? 'liked' : 'saved';
    if (!(await db.inSet(userId, set, videoId))) return true;
    await db.removeFromSet(userId, set, videoId);
    await db.incrStat(videoId, type === 'unlike' ? 'likes' : 'saves', -1);
  }
  if (type === 'view') {
    if (video.readyKey) {
      await kv.zincrby('popular:units', 1, video.readyKey);
      const user = await db.getUser(userId);
      await kv.set(`popular:audience:${video.readyKey}`, { unitId: video.unitId, audience: audienceFor(user) });
    }
    await kv.lpush(`user:${userId}:history`, videoId);
    await kv.ltrim(`user:${userId}:history`, 0, 199);
  }
  if (STAT_FOR[type]) await db.incrStat(videoId, STAT_FOR[type], 1);
  if (type === 'quiz_answer') await db.incrStat(videoId, correct ? 'quizRight' : 'quizWrong', 1);
  if (type === 'leave' && watchedSec > 0) await db.incrStat(videoId, 'watchSec', Math.min(Math.round(watchedSec), 600));

  if (unitId && ['view', 'complete', 'skip', 'like', 'unlike', 'less', 'quiz_answer'].includes(type)) {
    await updateProgress(userId, unitId, type, { correct: Boolean(correct) });
  }
  return true;
}

// ---------------------------------------------------------------- views for the browser
/** What the browser gets. The Vidmoat document is included only once the video is ready. */
export async function publicVideo(v, userId, { withDocument = true, why, pos } = {}) {
  const look = TOPIC_BY_ID[v.topic] || TOPIC_BY_ID.biology;
  const ready = v.status === 'ready';
  const [stats, liked, saved, document] = await Promise.all([
    db.getStats(v.id),
    userId ? db.inSet(userId, 'liked', v.id) : false,
    userId ? db.inSet(userId, 'saved', v.id) : false,
    ready && withDocument ? db.getDocument(v.id) : undefined,
  ]);
  return {
    id: v.id,
    status: v.status,
    error: v.status === 'failed' ? 'This video could not be generated.' : undefined,
    topic: { id: look.id, label: look.label, emoji: look.emoji, accent: look.accent },
    unit: v.unitId ? { id: v.unitId, title: v.unitTitle || null } : null,
    title: v.lesson?.title || null,
    hook: v.lesson?.hook || null,
    subtopic: v.lesson?.subtopic || null,
    duration: v.duration || null,
    poster: v.poster || null,
    narrated: Boolean(v.narrated),
    quiz: ready ? v.quiz || null : null,
    credits: v.credits || [],
    liked, saved,
    likes: stats.likes,
    why: why || undefined,
    position: pos || undefined,
    document: document || undefined,
  };
}

/** Saved videos, watch history and course progress for the Library screen. */
export async function library(userId) {
  const user = await db.getUser(userId);
  const [savedIds, historyIds, states] = await Promise.all([
    kv.smembers(`user:${userId}:saved`),
    kv.lrange(`user:${userId}:history`, 0, 59),
    getProgress(userId),
  ]);
  const summarize = async (id) => {
    const v = await db.getVideo(id);
    return v && v.status === 'ready' ? { id: v.id, title: v.lesson?.title, unit: v.unitTitle, topic: v.topic, poster: v.poster, duration: v.duration } : null;
  };
  const saved = (await Promise.all((savedIds || []).map(summarize))).filter(Boolean);
  const history = (await Promise.all([...new Set(historyIds)].map(summarize))).filter(Boolean);
  const programs = (await Promise.all((user.programKeys || []).map((k) => getProgram(k)))).filter(Boolean);
  const units = await Promise.all(user.units.map(async (id) => {
    const u = await getUnit(id);
    const s = states[id];
    return u ? { id, title: u.title, topic: u.topic, programKey: u.programKey || null, mastery: mastery(s), views: s?.views || 0, dueForReview: Boolean(s?.due && s.due <= Date.now() && s.lastSeen) } : null;
  }));
  return {
    profile: user.profile,
    programs: programs.map((p) => ({ key: p.key, name: p.name, basis: p.basis, sources: p.sources || [] })),
    units: units.filter(Boolean), interests: user.interests, saved, history,
  };
}

/**
 * Cron top-up: keep at least `min` ready videos for the most-watched units, so popular units
 * never make a student wait. Returns the generation promises (for waitUntil).
 */
export async function topUpLibrary({ units = 8, min = 4 } = {}) {
  const keys = await kv.zrange('popular:units', 0, units - 1, { rev: true });
  const pending = [];
  for (const key of keys) {
    const ready = (await db.readyIds(key, min)).length;
    if (ready >= min) continue;
    const info = await kv.get(`popular:audience:${key}`);
    const unit = info && (await getUnit(info.unitId));
    if (!unit) continue;
    const started = await startVideo(unit, info.audience, { requestedBy: 'cron' });
    pending.push(started.done);
  }
  return pending;
}

/**
 * Links a Vidmoat identity to a StudyTok profile (Sign in with Vidmoat).
 *  - identity already linked to a profile  -> that profile is restored on this device
 *  - otherwise                            -> the current guest profile (or a new one) is linked
 * Only { id, name, email } is kept: no tokens, nothing that can spend credits.
 */
export async function linkVidmoat(currentUserId, identity) {
  const linkedId = await kv.get(`vidmoat:${identity.id}`);
  const vidmoat = { id: identity.id, name: identity.name, email: identity.email, linkedAt: new Date().toISOString() };
  if (linkedId) {
    const linked = await db.getUser(linkedId);
    if (linked) {
      const user = { ...linked, vidmoat: { ...linked.vidmoat, ...vidmoat } };
      await db.saveUser(user);
      return { user, restored: linkedId !== currentUserId };
    }
  }
  const current = currentUserId ? await db.getUser(currentUserId) : null;
  const user = current
    ? { ...current, vidmoat }
    : { id: randomUUID(), createdAt: new Date().toISOString(), profile: cleanProfile(), programKeys: [], units: [], interests: [], vidmoat, setupDone: false };
  await db.saveUser(user);
  await kv.set(`vidmoat:${identity.id}`, user.id);
  return { user, restored: false };
}
