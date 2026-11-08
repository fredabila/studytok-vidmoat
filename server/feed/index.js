// The "For You" feed: profiles, picking units with the algorithm (ranking.js), choosing the
// best ready video of each for this student right now (or generating one), keeping a few
// videos generating ahead of the viewer, and the Library. Engagement events are folded into
// progress and tastes by events.js.

import { randomUUID } from 'node:crypto';
import { config } from '../core/config.js';
import { INTEREST_TOPICS, TOPIC_BY_ID } from '../curriculum/topics.js';
import { format as formatOf } from '../video/formats.js';
import { level as levelOf, LEVEL_BY_ID } from '../curriculum/levels.js';
import { getUnit, getProgram, interestUnit, customUnit } from '../curriculum/index.js';
import { lessonKey } from '../lessons/index.js';
import { startVideo, readyKeyFor } from '../video/generator.js';
import { pickUnits, mastery, scoreVideo, exploreRate, applyEvent, emptyState } from './ranking.js';
import { ingest, getSignals, getSession, noteServed, noteBreather } from './events.js';
import { needsBreather, pickBreather, isBreatherUnit, BREATHER_REASONS } from './breathers.js';
import { credentialFor } from '../core/billing.js';
import { kv } from '../core/kv.js';
import * as db from '../core/db.js';

const clean = (s, n = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------------------------------------------------------------- profiles
export function cleanProfile(p = {}) {
  const age = Number.isInteger(Number(p.age)) && Number(p.age) >= 5 && Number(p.age) <= 120 ? Number(p.age) : null;
  return {
    level: LEVEL_BY_ID[p.level] ? p.level : 'lifelong',
    country: clean(p.country, 60),
    institution: clean(p.institution, 120),
    program: clean(p.program, 120),
    exam: clean(p.exam, 60),
    // Age and who manages the profile. Vidmoat accounts are for adults, so anyone under 18 is set
    // up by a parent or guardian on the adult's account ('guardian'), with their consent recorded.
    age,
    managedBy: p.managedBy === 'guardian' ? 'guardian' : 'self',
  };
}

/** Throws (status 400) when a profile breaks the age rules. */
export function checkAgeRules(profile, { guardianConsent = false, existing = null } = {}) {
  if (profile.age == null) return;
  if (profile.age < 18 && profile.managedBy !== 'guardian') {
    throw Object.assign(new Error('Vidmoat accounts are for adults (18+). A parent or guardian signs in and sets StudyTok up for anyone under 18.'), { status: 400, code: 'minor' });
  }
  if (profile.managedBy === 'guardian' && !guardianConsent && !existing?.guardianConsentAt) {
    throw Object.assign(new Error('Please confirm you are the parent or guardian.'), { status: 400, code: 'consent' });
  }
}

export const DEFAULT_PREFS = { voice: 'on', length: 'standard', visuals: 'mixed', difficulty: 'standard' };
const PREF_VALUES = { voice: ['on', 'off'], length: ['quick', 'standard', 'deep'], visuals: ['mixed', 'diagrams', 'footage'], difficulty: ['easier', 'standard', 'harder'] };
export function cleanPrefs(p = {}, base = DEFAULT_PREFS) {
  const out = { ...base };
  for (const [k, allowed] of Object.entries(PREF_VALUES)) if (allowed.includes(p[k])) out[k] = p[k];
  return out;
}

/**
 * Invite links: ?ref=<member number>. Recorded once, on the first profile save, never for the
 * student's own number; the inviter's count goes up. Returns the inviter's member number or null.
 */
export async function recordReferral(user, ref) {
  const no = Number(ref);
  if (!user || user.referredBy || !Number.isInteger(no) || no <= 0 || no === user.memberNo) return null;
  const inviterId = await db.userIdByMemberNo(no);
  if (!inviterId || inviterId === user.id) return null;
  user.referredBy = no;
  user.referredAt = new Date().toISOString();
  await db.saveUser(user);
  await kv.hincrby('referrals', String(no), 1);
  await kv.hincrby(`events:day:${new Date().toISOString().slice(0, 10)}`, 'referred', 1);
  return no;
}

/** body: { profile, programKeys?, units?: string[], interests?: string[], prefs?, ref? } */
export async function saveProfile(userId, body) {
  const existing = userId ? await db.getUser(userId) : null;
  const profile = cleanProfile(body.profile || existing?.profile);
  checkAgeRules(profile, { guardianConsent: body.guardianConsent === true, existing });
  const user = {
    id: existing?.id || randomUUID(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    memberNo: existing?.memberNo || (await db.nextMemberNo()),
    profile,
    guardianConsentAt: profile.managedBy === 'guardian' ? existing?.guardianConsentAt || new Date().toISOString() : null,
    // One or more courses (e.g. several high-school subjects).
    programKeys: Array.isArray(body.programKeys) ? body.programKeys.map((k) => String(k).slice(0, 40)).slice(0, 8)
      : typeof body.programKey === 'string' ? [body.programKey.slice(0, 40)] : existing?.programKeys || [],
    units: Array.isArray(body.units) ? body.units.map(String).slice(0, 40) : existing?.units || [],
    interests: Array.isArray(body.interests) ? body.interests.filter((t) => TOPIC_BY_ID[t]).slice(0, 14) : existing?.interests || [],
    prefs: cleanPrefs(body.prefs || {}, existing?.prefs || DEFAULT_PREFS),
    // Custom units a student added inside a course: unitId -> programKey.
    unitGroups: existing?.unitGroups || {},
    vidmoat: existing?.vidmoat || null,
    // A draft is saved while the student is still reading their syllabus, so the first videos
    // can start generating before they press "Start learning".
    setupDone: body.draft ? Boolean(existing?.setupDone) : true,
  };
  // A student needs something to watch: with nothing chosen, fall back to all interest topics.
  if (!user.units.length && !user.interests.length) user.interests = INTEREST_TOPICS.map((t) => t.id);
  if (existing?.referredBy) { user.referredBy = existing.referredBy; user.referredAt = existing.referredAt; }
  await db.saveUser(user);
  await db.indexMember(user);
  if (body.ref != null && !user.referredBy) await recordReferral(user, body.ref);
  return user;
}

export function audienceFor(user) {
  const p = user.profile || cleanProfile();
  const lvl = levelOf(p.level);
  const prefs = cleanPrefs(user.prefs || {});
  // Only non-default lesson preferences change the lesson key, so defaults stay shared.
  const lessonStyle = ['length', 'visuals', 'difficulty'].filter((k) => prefs[k] !== DEFAULT_PREFS[k]).map((k) => `|${k[0]}:${prefs[k]}`).join('');
  // Young children get their own lessons (simpler language, gentler formats): part of the lesson key.
  const child = p.age != null && p.age < 13;
  return { level: lvl.id, levelLabel: lvl.label, audience: lvl.audience, country: p.country, institution: p.institution, exam: p.exam, prefs, lessonStyle: lessonStyle + (child ? '|age:child' : ''), age: p.age ?? null, minor: p.age != null && p.age < 18, child };
}

/**
 * Edits from the app: toggle units, add custom topics, change interests or preferences.
 * body: { units?: string[], interests?: string[], prefs?: object, addCustom?: { title, programKey? }, removeUnit?: string }
 */
export async function editProfile(userId, body) {
  const user = await db.getUser(userId);
  if (Array.isArray(body.units)) user.units = body.units.map(String).slice(0, 60);
  if (Array.isArray(body.interests)) user.interests = body.interests.filter((t) => TOPIC_BY_ID[t]).slice(0, 14);
  if (body.prefs) user.prefs = cleanPrefs(body.prefs, user.prefs || DEFAULT_PREFS);
  user.unitGroups ||= {};
  let added = null;
  if (body.addCustom?.title) {
    added = await customUnit(body.addCustom.title);
    if (added) {
      if (!user.units.includes(added.id)) user.units.push(added.id);
      const programKey = typeof body.addCustom.programKey === 'string' && (user.programKeys || []).includes(body.addCustom.programKey) ? body.addCustom.programKey : null;
      if (programKey) user.unitGroups[added.id] = programKey; else delete user.unitGroups[added.id];
    }
  }
  if (typeof body.removeUnit === 'string') {
    user.units = user.units.filter((id) => id !== body.removeUnit);
    delete user.unitGroups[body.removeUnit];
  }
  if (!user.units.length && !user.interests.length) user.interests = INTEREST_TOPICS.map((t) => t.id);
  await db.saveUser(user);
  return { user, added };
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
  const groupOf = (u) => u.programKey || user.unitGroups?.[u.id] || (u.custom ? 'custom' : 'course');
  const sizes = {};
  for (const u of course) sizes[groupOf(u)] = (sizes[groupOf(u)] || 0) + 1;
  const seen = {};
  course.forEach((unit, order) => {
    const group = groupOf(unit);
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
/**
 * Best ready video for this unit+level the viewer has not seen or been served, scored for this
 * student right now (ranking.js scoreVideo: quality × taste × diversity × fatigue × difficulty).
 * @returns {Promise<null | { video, parts }>}
 */
async function reusable(userId, readyKey, taken, { signals, session } = {}) {
  const ids = (await db.readyIds(readyKey, 60)).filter((id) => !taken.has(id));
  if (!ids.length) return null;
  const blocked = await db.inAnySet(userId, ['seen', 'served'], ids);
  const candidates = ids.filter((_, i) => !blocked[i]).slice(0, 12);
  if (!candidates.length) return null;
  const videos = (await Promise.all(candidates.map((id) => db.getVideo(id)))).filter((v) => v?.status === 'ready');
  const stats = await Promise.all(videos.map((v) => db.getStats(v.id)));
  let best = null;
  videos.forEach((v, i) => {
    const r = scoreVideo(v, stats[i], signals, session);
    if (!best || r.score > best.score) best = { video: v, ...r };
  });
  return best;
}

/** Videos this viewer already has generating (so prefetch does not pile up). */
async function generatingFor(userId) {
  const ids = await kv.lrange(`user:${userId}:generating`, 0, 20);
  const vids = await Promise.all(ids.map((id) => db.getVideo(id)));
  return vids.filter((v) => v?.status === 'generating');
}

/**
 * Starts a video for this student on whoever's Vidmoat account pays for it (core/billing.js).
 * @returns {Promise<{ video } | { blocked: 'allowance'|'exhausted'|'plan'|'reconnect' }>}
 */
async function startFor(userId, unit, audience, pending, { onTheHouse = false } = {}) {
  // A breather is StudyTok's idea, not the student's: it is never charged to them or to their free allowance.
  const credential = onTheHouse ? { mode: 'house' } : await credentialFor(userId);
  if (credential.mode === 'exhausted') return { blocked: credential.reason };
  const started = await startVideo(unit, audience, { requestedBy: userId, credential });
  pending.push(started.done);
  await kv.lpush(`user:${userId}:generating`, started.video.id);
  return { video: started.video };
}

/** Any ready, unseen video for this level (then any level): an instant starter while the student's own units generate. */
async function starter(userId, level, taken) {
  const ids = (await db.anyReadyIds(level, 40)).filter((id) => !taken.has(id));
  if (!ids.length) return null;
  const blocked = await db.inAnySet(userId, ['seen', 'served'], ids);
  const id = ids.find((_, i) => !blocked[i]);
  return id ? db.getVideo(id) : null;
}

/**
 * Returns `count` feed items plus the promises of generation work started (pass them to
 * waitUntil on serverless). Ready-first: a ready, unseen library video for any of the student's
 * likely units is served before a video that still has to be made, so the feed almost never
 * shows a waiting slide; the units that need generating are started in the background and
 * appear once ready. A brand-new library falls back to any ready starter for the level.
 */
export async function nextItems(userId, count = 3) {
  const user = await db.getUser(userId);
  const audience = audienceFor(user);
  const { candidates, hasCourse } = await candidatesFor(user);
  const [states, signals, session] = await Promise.all([getProgress(userId), getSignals(userId), getSession(userId)]);
  const recent = (await kv.lrange(`user:${userId}:recentUnits`, 0, 9)) || [];

  // No exploration for a new student's first videos (start at the beginning of the syllabus);
  // then a share that decays as the algorithm learns the student.
  const servedSoFar = Object.values(states).reduce((n, s) => n + (s.served || 0), 0);
  const picks = pickUnits(candidates, states, recent, Math.min(candidates.length, count + 4), { hasCourse, explore: exploreRate(servedSoFar) });
  const pending = [];
  const taken = new Set();
  const inFlight = await generatingFor(userId); // videos already being made for this student (prefetch, earlier pages)
  let generating = inFlight.length;

  const ready = [];
  const unready = [];
  // As videos are chosen for this page, treat them as the session's most recent for diversity.
  const pageSession = { ...session, lastFormats: [...(session.lastFormats || [])], lastTopics: [...(session.lastTopics || [])] };
  for (const pick of picks) {
    const best = await reusable(userId, readyKeyFor(pick.unit.id, audience), taken, { signals, session: pageSession });
    if (best) {
      taken.add(best.video.id);
      ready.push({ pick, video: best.video, videoParts: best.parts });
      pageSession.lastFormats.unshift(best.video.format || 'explain');
      pageSession.lastTopics.unshift(best.video.topic);
      pageSession.viewed = (pageSession.viewed || 0) + 1;
    } else unready.push(pick);
  }

  const items = ready.slice(0, count).map(({ pick, video, videoParts }) => ({ video, unit: pick.unit, why: { ...pick.parts, kind: pick.kind, video: videoParts }, pos: pick.pos || null }));

  // A breather: when the session says the student is about to drop off, the next slot is one
  // short, fun video from next door to their subject (feed/breathers.js), then back to the units.
  const breatherMark = (await kv.get(`user:${userId}:breather`)) || {};
  const breatherReason = needsBreather({ ...session, lastBreatherAt: breatherMark.at || 0 }, signals);
  if (breatherReason) {
    const topics = [...new Set(candidates.map((c) => c.unit.topic))];
    const unit = pickBreather({ topics, lastTopic: session.lastTopics?.[0] || null, recentUnits: recent });
    const best = await reusable(userId, readyKeyFor(unit.id, audience), taken, { signals, session: pageSession });
    let video = best?.video || null;
    if (!video) {
      const existing = inFlight.find((v) => v.readyKey === readyKeyFor(unit.id, audience) && !taken.has(v.id));
      // Nothing ready: make one on the house, unless the student is on their own account (then only library breathers).
      const ownAccount = user.billing?.mode === 'own' && Boolean(user.vidmoatTokens);
      const result = existing ? { video: existing } : ownAccount ? {} : await startFor(userId, unit, audience, pending, { onTheHouse: true });
      video = result.video || null;
      if (video && !existing) generating++;
    }
    if (video) {
      taken.add(video.id);
      items.unshift({ video, unit, why: { kind: 'breather', reason: breatherReason, video: best?.parts }, pos: null });
      await noteBreather(userId, session.viewed || 0);
    }
  }

  // Start what is missing: the most important missing unit always, enough to fill this page,
  // plus a few ahead (bounded per viewer). When nobody can pay for a new video (allowance used
  // up, own account empty), the page is filled from the shared library instead and the app is
  // told why, so it can ask the student to connect or top up their Vidmoat account.
  let started = 0;
  let credits = null;
  for (const pick of unready) {
    const needed = items.length < count;
    if (!needed && started > 0 && generating >= config.generation.readyAhead) break;
    // A video for this unit may already be on its way (prefetch): show that rather than start another.
    const existing = inFlight.find((v) => v.readyKey === readyKeyFor(pick.unit.id, audience) && !taken.has(v.id));
    const result = existing ? { video: existing, existing: true } : credits ? { blocked: credits.reason } : await startFor(userId, pick.unit, audience, pending);
    if (result.blocked) {
      credits ||= { needed: true, reason: result.blocked, unit: pick.unit.title };
      if (needed) {
        const fill = await starter(userId, audience.level, taken);
        if (fill) { taken.add(fill.id); items.push({ video: fill, unit: null, why: { starter: true, credits: result.blocked }, pos: null }); }
      }
      continue;
    }
    if (!result.existing) { started++; generating++; }
    taken.add(result.video.id);
    if (needed) {
      // While it generates, show a starter from the library instead of a waiting slide.
      const fill = await starter(userId, audience.level, taken);
      if (fill) { taken.add(fill.id); items.push({ video: fill, unit: null, why: { starter: true }, pos: null, queuedFor: pick.unit.title }); }
      items.push({ video: result.video, unit: pick.unit, why: { ...pick.parts, kind: pick.kind }, pos: pick.pos || null });
    }
  }
  // Keep the page to `count` ready-or-generating items, generating ones last (a ready breather first).
  items.sort((a, b) => Number(a.video.status !== 'ready') - Number(b.video.status !== 'ready') || Number(b.why?.kind === 'breather') - Number(a.why?.kind === 'breather'));
  const page = items.slice(0, count + 1);

  await kv.ltrim(`user:${userId}:generating`, 0, 19);
  await db.addToSet(userId, 'served', ...page.map((x) => x.video.id));
  for (const x of page) {
    if (!x.unit) continue;
    await kv.lpush(`user:${userId}:recentUnits`, x.unit.id);
    if (!isBreatherUnit(x.unit.id)) await updateProgress(userId, x.unit.id, 'served');
  }
  await kv.ltrim(`user:${userId}:recentUnits`, 0, 19);
  await noteServed(userId, page.map((x) => x.video));
  return { items: page, pending, credits };
}

/** Right after setup: start generating the student's first units so the feed opens without a wait. */
export async function prefetch(userId) {
  const user = await db.getUser(userId);
  const audience = audienceFor(user);
  const { candidates, hasCourse } = await candidatesFor(user);
  const picks = pickUnits(candidates, await getProgress(userId), [], Math.min(candidates.length, config.generation.readyAhead), { hasCourse, explore: 0 });
  const pending = [];
  let generating = (await generatingFor(userId)).length;
  for (const pick of picks) {
    if (generating >= config.generation.readyAhead) break;
    const have = (await db.readyIds(readyKeyFor(pick.unit.id, audience), 1)).length;
    if (have) continue;
    const result = await startFor(userId, pick.unit, audience, pending);
    if (result.blocked) break;
    generating++;
  }
  await kv.ltrim(`user:${userId}:generating`, 0, 19);
  return pending;
}

// ---------------------------------------------------------------- events
/** One event (the batch API is events.js ingest). Returns false when the video is unknown. */
export async function recordEvent(userId, event) {
  if (event.videoId && !(await db.getVideo(event.videoId))) return false;
  await ingest(userId, { events: [{ at: Date.now(), ...event }] });
  return true;
}

// ---------------------------------------------------------------- views for the browser
/** What the browser gets. The Vidmoat document is included only once the video is ready. */
/** Spot-the-mistake quizzes ask "which step is wrong?": name the steps, since the slip may cover the video. */
function quizWithStepText(quiz, lesson) {
  const steps = lesson?.exam?.steps;
  if (!Array.isArray(steps) || !quiz.options?.every((o) => /^Step \d$/.test(o))) return quiz;
  const short = (t) => { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > 64 ? `${s.slice(0, 62).trim()}…` : s; };
  return { ...quiz, options: quiz.options.map((o, i) => (steps[i] ? `${o} · ${short(steps[i])}` : o)) };
}

export async function publicVideo(v, userId, { withDocument = true, why, pos, queuedFor } = {}) {
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
    error: v.status === 'failed' ? (v.errorCode === 'exhausted' ? 'Your Vidmoat account is out of credits.' : v.errorCode === 'plan' ? 'Your Vidmoat plan does not include this yet.' : v.errorCode === 'reconnect' ? 'Please reconnect your Vidmoat account.' : 'This video could not be generated.') : undefined,
    errorCode: v.status === 'failed' ? v.errorCode || null : undefined,
    topic: { id: look.id, label: look.label, emoji: look.emoji, accent: look.accent },
    format: { id: v.format || 'explain', tag: formatOf(v.format).tag, name: formatOf(v.format).name },
    unit: v.unitId ? { id: v.unitId, title: v.unitTitle || null } : null,
    title: v.lesson?.title || null,
    hook: v.lesson?.hook || null,
    subtopic: v.lesson?.subtopic || null,
    duration: v.duration || null,
    poster: v.poster || null,
    narrated: Boolean(v.narrated),
    // Videos made before the hold existed: their think pause started 3 s before the reveal.
    quiz: ready && v.quiz ? quizWithStepText({ ...v.quiz, hold: v.quiz.hold ?? (v.quiz.reveal != null ? Math.max(v.quiz.from ?? 0, +(v.quiz.reveal - 3).toFixed(2)) : null) }, v.lesson) : null,
    scenes: ready ? v.scenes || [] : [],
    credits: v.credits || [],
    liked, saved,
    likes: stats.likes,
    why: why || undefined,
    breather: why?.kind === 'breather' ? { reason: why.reason, text: BREATHER_REASONS[why.reason] || BREATHER_REASONS.default } : undefined,
    position: pos || undefined,
    starter: why?.starter ? true : undefined,
    queuedFor: queuedFor || undefined,
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
  const active = new Set(user.units);
  const row = (u, programKey) => {
    const s = states[u.id];
    return { id: u.id, title: u.title, topic: u.topic, programKey, custom: Boolean(u.custom), active: active.has(u.id), mastery: mastery(s), views: s?.views || 0, dueForReview: Boolean(s?.due && s.due <= Date.now() && s.lastSeen) };
  };
  const units = [];
  for (const p of programs) {
    for (const u of p.units) units.push(row(u, p.key));
  }
  // Custom units: filed under the course the student added them to, else a "My topics" group.
  for (const id of user.units) {
    if (units.some((u) => u.id === id)) continue;
    const u = await getUnit(id);
    if (u) units.push(row(u, user.unitGroups?.[id] || (u.custom ? 'custom' : null)));
  }
  return {
    profile: user.profile,
    prefs: cleanPrefs(user.prefs || {}),
    programs: programs.map((p) => ({ key: p.key, name: p.name, basis: p.basis, sources: p.sources || [] })),
    units, interests: user.interests, saved, history,
  };
}

/**
 * Cron top-up: keep at least `min` ready videos for the most-watched units, so popular units
 * never make a student wait. Returns the generation promises (for waitUntil).
 */
export async function topUpLibrary({ units = 8, min = 4 } = {}) {
  const keys = await kv.zrange('popular:units', 0, units - 1, { rev: true });
  const pending = [];
  // Backfill the starter pool from units people watch (idempotent; covers videos made before the pool existed).
  for (const key of keys) {
    for (const id of await db.readyIds(key, 10)) {
      const v = await db.getVideo(id);
      if (v?.status === 'ready') await db.markReady({ ...v, _poolOnly: true });
    }
  }
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
    : { id: randomUUID(), createdAt: new Date().toISOString(), memberNo: await db.nextMemberNo(), profile: cleanProfile(), programKeys: [], units: [], interests: [], vidmoat, setupDone: false };
  await db.saveUser(user);
  await db.indexMember(user);
  await kv.set(`vidmoat:${identity.id}`, user.id);
  return { user, restored: false };
}
