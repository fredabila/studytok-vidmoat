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
import { PACK_BY_SLUG, PACKS, packOfUnit, publicPack, SLUG as PACK_SLUG } from '../curriculum/packs.js';
import { lessonKey, regionOf, neutralAudience } from '../lessons/index.js';
import { startVideo, readyKeyFor } from '../video/generator.js';
import { pickUnits, mastery, scoreVideo, exploreRate, applyEvent, emptyState, examUrgency } from './ranking.js';
import { pickRecall, noteRecall, recallItem, getMisses } from './recall.js';
import { noteDecision, getWeights } from './calibration.js';
import { settingsFor } from './experiments.js';
import { pickGame, noteGame, playable, materialOf, watchedVideos } from './games.js';
import { learningProfile, styleFit, cleanStyles } from './learning.js';
import { ingest, getSignals, getSession, noteServed, noteBreather, studentStats, emptySignals } from './events.js';
import { needsBreather, pickBreather, isBreatherUnit, BREATHER_REASONS } from './breathers.js';
import { pickMoment, noteMoment, momentContext, momentItem } from './moments.js';
import * as push from '../core/push.js';
import { followCandidates, channelOfUnit, isFollowing, ensureChannel, follow as followChannel } from './channels.js';
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
    examDate: /^\d{4}-\d{2}-\d{2}$/.test(p.examDate || '') && !Number.isNaN(Date.parse(p.examDate)) ? p.examDate : null,
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
    throw Object.assign(new Error('Vidmoat accounts are for adults (18+). A parent or guardian signs in and sets StudyGraph up for anyone under 18.'), { status: 400, code: 'minor' });
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
    packs: existing?.packs || [],
    // How the student says they like to learn (StudyGraph's questionnaire); only a starting point for the measured profile.
    styles: Array.isArray(body.styles) ? cleanStyles(body.styles) : existing?.styles || [],
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
  if (typeof body.pack === 'string' && PACK_BY_SLUG[body.pack]) { addPack(user, body.pack); await db.saveUser(user); }
  return user;
}

/** Puts a community pack's units on the student's course (idempotent). */
export function addPack(user, slug) {
  const pack = PACK_BY_SLUG[slug];
  if (!pack) return false;
  user.packs = [...new Set([...(user.packs || []), slug])].slice(0, 12);
  for (const u of pack.units) if (!user.units.includes(u.id)) user.units.push(u.id);
  return true;
}
export function removePack(user, slug) {
  user.packs = (user.packs || []).filter((s) => s !== slug);
  user.units = user.units.filter((id) => !id.startsWith(`pack:${slug}:`));
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
 * body: { units?: string[], interests?: string[], prefs?: object, addCustom?: { title, programKey? }, removeUnit?: string, addPack?: slug, removePack?: slug }
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
  if (typeof body.addPack === 'string' && PACK_SLUG.test(body.addPack)) { if (addPack(user, body.addPack)) added = { pack: publicPack(PACK_BY_SLUG[body.addPack]) }; }
  // A custom topic or pack gets its course profile (named by this student when the topic is new) and is followed.
  const madeRef = added?.pack ? `pack:${added.pack.slug}` : added?.id?.startsWith?.('cu:') ? added.id : null;
  if (madeRef) {
    const made = await ensureChannel(madeRef, { handle: body.addCustom?.handle || null, createdBy: user.id }).catch(() => null);
    if (made) {
      user.unfollowed = (user.unfollowed || []).filter((x) => x !== made.channel.handle && x !== made.channel.ref);
      await followChannel(user.id, made.channel.handle, { auto: true });
      added = { ...added, channel: { handle: made.channel.handle, existed: made.existed, gotRequested: made.gotRequested } };
    }
  }
  if (typeof body.removePack === 'string') removePack(user, body.removePack);
  if (Array.isArray(body.styles)) user.styles = cleanStyles(body.styles);
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

async function candidatesFor(user, { intent = null } = {}) {
  const out = [];
  const course = (await Promise.all(user.units.map((id) => getUnit(id)))).filter(Boolean);
  const groupOf = (u) => u.programKey || user.unitGroups?.[u.id] || (u.pack ? `pack:${u.pack}` : u.custom ? 'custom' : 'course');
  const sizes = {};
  for (const u of course) sizes[groupOf(u)] = (sizes[groupOf(u)] || 0) + 1;
  const seen = {};
  course.forEach((unit, order) => {
    const group = groupOf(unit);
    seen[group] = (seen[group] || 0) + 1;
    out.push({ unit, kind: 'course', order, group, pos: { index: seen[group], total: sizes[group] } });
  });
  // Course profiles the student follows (feed/channels.js), beyond their own syllabus.
  const skip = new Set(out.map((c) => c.unit.id));
  for (const c of await followCandidates(user, { skip, intent }).catch(() => [])) {
    if (!skip.has(c.unit.id)) { skip.add(c.unit.id); out.push(c); }
  }
  // A visit to the profile of a course the student already studies leans the feed the same way.
  if (intent?.handle) for (const c of out) if (c.kind === 'course' && c.channel == null && intent.units?.includes(c.unit.id)) c.intent = intent.w;
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
/** A due unit's lessons are retrieval practice, written and filed separately from its first explanations. */
export const reviewAudience = (audience) => ({ ...audience, lessonStyle: `${audience.lessonStyle || ''}|review`, review: true });

/**
 * The ready pools a student may be served for a unit: lessons written for their country, then
 * lessons written with no country (examples familiar anywhere). Never another country's.
 */
export function poolKeys(unitId, audience) {
  const own = readyKeyFor(unitId, audience);
  return regionOf(audience.country) ? [own, readyKeyFor(unitId, neutralAudience(audience))] : [own];
}

/** Does a lesson suit this student's country? (Theirs, or one made with no country.) */
export const fitsRegion = (v, audience) => !v?.loc || v.loc === regionOf(audience?.country);

async function reusable(userId, readyKeys, taken, { signals, session, review = false, gentle = false, weights = null, fit = null } = {}) {
  const keys = Array.isArray(readyKeys) ? readyKeys : [readyKeys];
  const lists = await Promise.all(keys.map((k) => db.readyIds(k, 60)));
  const ids = [...new Set(lists.flat())].filter((id) => !taken.has(id));
  if (!ids.length) return null;
  const blocked = await db.inAnySet(userId, ['seen', 'served'], ids);
  const candidates = ids.filter((_, i) => !blocked[i]).slice(0, 12);
  if (!candidates.length) return null;
  const videos = (await Promise.all(candidates.map((id) => db.getVideo(id)))).filter((v) => v?.status === 'ready');
  const stats = await Promise.all(videos.map((v) => db.getStats(v.id)));
  let best = null;
  videos.forEach((v, i) => {
    const r = scoreVideo(v, stats[i], signals, session, { review, gentle, weights, styleFit: fit });
    if (!best || r.score > best.score) best = { video: v, ...r };
  });
  return best;
}

/**
 * Topics the student searched in the last 24 hours → intent weight (0.35, fading over the day).
 * Searches that named no clear subject count for nothing.
 */
export function searchIntent(signals, now = Date.now()) {
  const out = {};
  for (const s of signals.searches || []) {
    if (!s.topic || now - s.at > 86400000) continue;
    out[s.topic] = Math.max(out[s.topic] || 0, +(0.35 * (1 - (now - s.at) / 86400000)).toFixed(3));
  }
  return out;
}

/**
 * The course profile the student opened in the last 20 minutes, as { handle, at, units, w }
 * (w fades from 1 to 0), or null. Written by GET /api/channels/:handle (noteProfileVisit).
 */
export async function profileIntent(userId, now = Date.now()) {
  const v = await kv.get(`user:${userId}:intent`);
  if (!v?.handle || now - v.at > 20 * 60 * 1000) return null;
  return { ...v, w: +(1 - (now - v.at) / (20 * 60 * 1000)).toFixed(3) };
}
export const noteProfileVisit = (userId, channel) => kv.set(`user:${userId}:intent`, { handle: channel.handle, at: Date.now(), units: (channel.units || []).slice(0, 80) }, { ex: 20 * 60 });

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
  // A breather is StudyGraph's idea, not the student's: it is never charged to them or to their free allowance.
  const credential = onTheHouse ? { mode: 'house' } : await credentialFor(userId);
  if (credential.mode === 'exhausted') return { blocked: credential.reason };
  const started = await startVideo(unit, audience, { requestedBy: userId, credential });
  pending.push(started.done);
  await kv.lpush(`user:${userId}:generating`, started.video.id);
  return { video: started.video };
}

/**
 * Any ready, unseen video for this level (then any level) that suits the student's country: an
 * instant starter while the student's own units generate.
 */
async function starter(userId, audience, taken) {
  const ids = (await db.anyReadyIds(audience.level, 40)).filter((id) => !taken.has(id));
  if (!ids.length) return null;
  const blocked = await db.inAnySet(userId, ['seen', 'served'], ids);
  for (const id of ids.filter((_, i) => !blocked[i]).slice(0, 12)) {
    const v = await db.getVideo(id);
    if (v?.status === 'ready' && fitsRegion(v, audience)) return v;
  }
  return null;
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
  const intent = await profileIntent(userId);
  const { candidates, hasCourse } = await candidatesFor(user, { intent });
  const [states, signals, session] = await Promise.all([getProgress(userId), getSignals(userId), getSession(userId)]);
  const recent = (await kv.lrange(`user:${userId}:recentUnits`, 0, 9)) || [];

  // No exploration for a new student's first videos (start at the beginning of the syllabus);
  // then a share that decays as the algorithm learns the student.
  const servedSoFar = Object.values(states).reduce((n, s) => n + (s.served || 0), 0);
  // Exam near: review outweighs new material (ranking.js examUrgency). Back after days away: the
  // first page eases in with gentler formats.
  const urgency = examUrgency(user.profile?.examDate);
  const stale = !session.lastAt || Date.now() - session.lastAt > 12 * 3600000;
  const gentle = stale && signals.lastSeenAt > 0 && Date.now() - signals.lastSeenAt > 3 * 86400000;
  const weights = await getWeights(); // calibration: fitted shrink per rule (empty until there is evidence)
  const exp = settingsFor(userId); // experiments: this student's arm for each judgement-call threshold
  const profile = learningProfile(signals, user.styles);
  const fit = profile.confidence ? (format) => styleFit(format, profile) : null;
  // Searched in the last day: units on that subject lean in (the same `intent` term as a profile visit).
  const searched = searchIntent(signals);
  if (Object.keys(searched).length) for (const c of candidates) if (searched[c.unit.topic]) c.intent = Math.max(c.intent || 0, searched[c.unit.topic]);
  const picks = pickUnits(candidates, states, recent, Math.min(candidates.length, count + 4), { hasCourse, explore: exploreRate(servedSoFar, exp.explore), urgency });
  const pending = [];
  const taken = new Set();
  const inFlight = await generatingFor(userId); // videos already being made for this student (prefetch, earlier pages)
  let generating = inFlight.length;

  const ready = [];
  const unready = [];
  // As videos are chosen for this page, treat them as the session's most recent for diversity.
  const pageSession = { ...session, lastFormats: [...(session.lastFormats || [])], lastTopics: [...(session.lastTopics || [])] };
  for (const pick of picks) {
    // A unit due for review: its retrieval-practice pool first, else its ordinary pool scored for review.
    const review = (pick.parts?.review || 0) > 0 || (urgency >= 0.5 && Boolean(states[pick.unit.id]?.lastSeen));
    const best = (review && await reusable(userId, poolKeys(pick.unit.id, reviewAudience(audience)), taken, { signals, session: pageSession, review, gentle, weights, fit }))
      || await reusable(userId, poolKeys(pick.unit.id, audience), taken, { signals, session: pageSession, review, gentle, weights, fit });
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
  const breatherReason = needsBreather({ ...session, lastBreatherAt: breatherMark.at || 0 }, signals, exp.breather);
  if (breatherReason) {
    const topics = [...new Set(candidates.map((c) => c.unit.topic))];
    const unit = pickBreather({ topics, lastTopic: session.lastTopics?.[0] || null, recentUnits: recent });
    const best = await reusable(userId, poolKeys(unit.id, audience), taken, { signals, session: pageSession });
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
    const forUnit = (pick.parts?.review || 0) > 0 ? reviewAudience(audience) : audience; // due units get retrieval practice written
    const existing = inFlight.find((v) => (v.readyKey === readyKeyFor(pick.unit.id, forUnit) || v.readyKey === readyKeyFor(pick.unit.id, audience)) && !taken.has(v.id));
    const result = existing ? { video: existing, existing: true } : credits ? { blocked: credits.reason } : await startFor(userId, pick.unit, forUnit, pending);
    if (result.blocked) {
      credits ||= { needed: true, reason: result.blocked, unit: pick.unit.title };
      if (needed) {
        const fill = await starter(userId, audience, taken);
        if (fill) { taken.add(fill.id); items.push({ video: fill, unit: null, why: { starter: true, credits: result.blocked }, pos: null }); }
      }
      continue;
    }
    if (!result.existing) { started++; generating++; }
    taken.add(result.video.id);
    if (needed) {
      // While it generates, show a starter from the library instead of a waiting slide.
      const fill = await starter(userId, audience, taken);
      if (fill) { taken.add(fill.id); items.push({ video: fill, unit: null, why: { starter: true }, pos: null, queuedFor: pick.unit.title }); }
      items.push({ video: result.video, unit: pick.unit, why: { ...pick.parts, kind: pick.kind }, pos: pick.pos || null });
    }
  }
  // Keep the page to `count` ready-or-generating items, generating ones last (a ready breather first).
  items.sort((a, b) => Number(a.video.status !== 'ready') - Number(b.video.status !== 'ready') || Number(b.why?.kind === 'breather') - Number(a.why?.kind === 'breather'));
  const page = items.slice(0, count + 1);

  // A moment: a tip, a piece of news or an offer rendered by the app (feed/moments.js), paced so
  // the feed stays a feed. It takes the second slot of the page so a lesson always comes first.
  if (page.length) {
    // A recall card (a quick check the student got wrong, due again) takes the second slot;
    // otherwise a moment may. Openers (welcome back, last time, exam countdown) go first.
    const miss = await pickRecall(userId, { session });
    if (miss) { page.splice(1, 0, { moment: recallItem(miss) }); await noteRecall(userId, session); }
    // A mini game from lessons already watched, when no recall card took the slot.
    // Units answered wrong more often than right, or due for review, are what a game should drill.
    const weak = new Set(Object.entries(states).filter(([, st]) => (st.quizWrong || 0) > (st.quizRight || 0) || (st.lastSeen && st.due && st.due <= Date.now())).map(([id]) => id));
    const game = miss ? null : await pickGame(userId, { session, played: signals.games?.byType || {}, weak });
    if (game) { page.splice(1, 0, { moment: game }); await noteGame(userId, game, session); }
    const watched = await db.countSet(userId, 'seen');
    const ctx = momentContext({ user, signals, saved: await db.countSet(userId, 'saved'), watched,
      invites: user.memberNo ? await db.referralCount(user.memberNo) : 0, pushEnabled: push.enabled(), pushSubscribed: push.enabled() && (await push.subscriptions(userId)).length > 0 });
    const stats = await studentStats(userId, { watched, progress: states, masteryOf: mastery });
    stats.unitsTotal = candidates.filter((c) => c.kind === 'course').length || candidates.length;
    const exam = user.profile?.examDate ? { name: user.profile.exam || 'your exam', days: Math.ceil((Date.parse(user.profile.examDate) - Date.now()) / 86400000) } : null;
    const moment = miss || game ? null : await pickMoment(userId, { session, ctx, stats, exam, gap: exp.moments.gap, hasBreather: page.some((x) => x.why?.kind === 'breather') });
    if (moment) { page.splice(moment.opener ? 0 : 1, 0, { moment: momentItem(moment, ctx) }); await noteMoment(userId, moment, session.viewed || 0, Date.now(), { sid: session.sid }); }
  }

  await kv.ltrim(`user:${userId}:generating`, 0, 19);
  await db.addToSet(userId, 'served', ...page.filter((x) => x.video).map((x) => x.video.id));
  for (const x of page) {
    if (!x.unit) continue;
    await kv.lpush(`user:${userId}:recentUnits`, x.unit.id);
    if (!isBreatherUnit(x.unit.id)) await updateProgress(userId, x.unit.id, 'served');
  }
  await kv.ltrim(`user:${userId}:recentUnits`, 0, 19);
  await noteServed(userId, page.filter((x) => x.video).map((x) => x.video));
  // Calibration: keep why each video was served, so its outcome can be joined to the rules that picked it.
  for (const x of page) if (x.video && x.why?.video) await noteDecision(userId, x.video.id, x.why.video, { viewed: session.viewed || 0, unit: { kind: x.why.kind, lead: leadOf(x.why) } });
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
    const have = (await Promise.all(poolKeys(pick.unit.id, audience).map((k) => db.readyIds(k, 1)))).flat().length;
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

export async function publicVideo(v, userId, { withDocument = true, why, pos, queuedFor, unitMastery = null } = {}) {
  const look = TOPIC_BY_ID[v.topic] || TOPIC_BY_ID.biology;
  const ready = v.status === 'ready';
  // Counts shown to students are whole, all-time numbers (db.getStats blends months with decay for ranking).
  const [stats, liked, saved, document, channel] = await Promise.all([
    kv.hgetall(`video:${v.id}:stats`).then((h) => h || {}),
    userId ? db.inSet(userId, 'liked', v.id) : false,
    userId ? db.inSet(userId, 'saved', v.id) : false,
    ready && withDocument ? db.getDocument(v.id) : undefined,
    channelOfUnit(v.unitId, { by: v.requestedBy || null }).catch(() => null),
  ]);
  return {
    id: v.id,
    status: v.status,
    error: v.status === 'failed' ? (v.errorCode === 'exhausted' ? 'Your Vidmoat account is out of credits.' : v.errorCode === 'plan' ? 'Your Vidmoat plan does not include this yet.' : v.errorCode === 'reconnect' ? 'Please reconnect your Vidmoat account.' : 'This video could not be generated.') : undefined,
    errorCode: v.status === 'failed' ? v.errorCode || null : undefined,
    topic: { id: look.id, label: look.label, emoji: look.emoji, accent: look.accent },
    format: { id: v.format || 'explain', tag: formatOf(v.format).tag, name: formatOf(v.format).name },
    unit: v.unitId ? { id: v.unitId, title: v.unitTitle || null } : null,
    // The course profile this lesson belongs to (feed/channels.js), for the @handle on the slide.
    channel: channel ? { handle: channel.handle, name: channel.name, avatar: channel.avatar?.id ? `/a/${channel.avatar.id}` : null, following: await isFollowing(userId, channel.handle) } : undefined,
    pack: packOfUnit(v.unitId) ? (({ slug, title, by, link, cta, kind }) => ({ slug, title, by, link, cta, kind }))(packOfUnit(v.unitId)) : undefined,
    title: v.lesson?.title || null,
    hook: v.lesson?.hook || null,
    subtopic: v.lesson?.subtopic || null,
    duration: v.duration || null,
    poster: v.poster || null,
    narrated: Boolean(v.narrated),
    // Videos made before the hold existed: their think pause started 3 s before the reveal.
    quiz: ready && v.quiz ? quizWithStepText({ ...v.quiz, hold: v.quiz.hold ?? (v.quiz.reveal != null ? Math.max(v.quiz.from ?? 0, +(v.quiz.reveal - 3).toFixed(2)) : null) }, v.lesson) : null,
    scenes: ready ? v.scenes || [] : [],
    terms: ready ? keyTerms(v) : [],
    credits: v.credits || [],
    liked, saved,
    likes: Math.max(0, Math.round(Number(stats.likes) || 0)),
    // Real counts only (social proof is never invented): how many students watched it.
    views: Math.max(0, Math.round(Number(stats.views) || 0)),
    // The viewer's mastery of this lesson's unit before watching (0..1), for the progress shown after the quiz.
    mastery: unitMastery == null ? undefined : +unitMastery.toFixed(2),
    why: why || undefined,
    breather: why?.kind === 'breather' ? { reason: why.reason, text: BREATHER_REASONS[why.reason] || BREATHER_REASONS.default } : undefined,
    position: pos || undefined,
    starter: why?.starter ? true : undefined,
    queuedFor: queuedFor || undefined,
    notes: ready ? notesOf(v) : undefined,
    document: document || undefined,
  };
}

/**
 * Starts a student over. `scope`:
 *  - 'feed': forgets what the algorithm learned (progress, tastes, session, what was served and
 *    seen, history, missed questions, moment and breather markers). Keeps the profile, units,
 *    preferences, saved and liked lessons, member number, invites and billing.
 *  - 'everything': the above plus saved, liked, preferences, course, units and interests; the
 *    student sets up again. Identity, member number, invites and billing (the free allowance
 *    already used) always stay.
 * Returns the fresh user.
 */
export async function resetStudent(userId, scope = 'feed') {
  const user = await db.getUser(userId);
  if (!user) return null;
  const k = (name) => `user:${userId}:${name}`;
  const signals = await getSignals(userId);
  await kv.del(k('progress'), k('session'), k('recentUnits'), k('generating'), k('served'), k('seen'), k('answered'), k('history'),
    k('misses'), k('recallAt'), k('moments'), k('breather'));
  // Keep what the device told us (platform, time zone) so moments and reminders still fit; forget the rest.
  await kv.set(k('signals'), { ...emptySignalsFor(), device: signals.device || {}, lastSeenAt: 0 });
  user.resetAt = new Date().toISOString();
  user.resets = (user.resets || 0) + 1;
  if (scope === 'everything') {
    await kv.del(k('saved'), k('savedAt'), k('liked'));
    Object.assign(user, { units: [], programKeys: [], interests: [], prefs: {}, unitGroups: {}, setupDone: false });
  }
  await db.saveUser(user);
  return user;
}
const emptySignalsFor = () => emptySignals();

/**
 * The lesson's key terms, for the app's recall mode ("fill the gaps": the player hides them in
 * the on-screen text until the student taps to reveal). Beat key terms, item titles, flashcard
 * answers, the quiz answer; 3 to 28 characters, no duplicates, at most twelve.
 */
export function keyTerms(v) {
  const l = v.lesson || {};
  const raw = [
    ...(l.beats || []).map((b) => b.keyTerm),
    ...(l.items || []).map((it) => it.title),
    ...(l.cards || []).map((c) => c.a),
    v.quiz?.options?.[v.quiz.answerIndex],
    l.subtopic,
  ];
  const out = [];
  for (let t of raw) {
    t = String(t || '').replace(/^[A-C]\.\s+/, '').replace(/\s+/g, ' ').trim();
    if (t.length < 3 || t.length > 28 || /^\d+$/.test(t)) continue;
    if (!/[a-z]/i.test(t)) continue;
    if (out.some((o) => o.toLowerCase() === t.toLowerCase())) continue;
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * The lesson as a revision sheet: objective and key terms (from the unit plan), the points as
 * spoken, definitions and equations shown, the quick check with its answer, the takeaway.
 */
export function notesOf(v) {
  const l = v.lesson || {};
  const defs = [];
  const equations = [];
  for (const b of l.beats || []) {
    const vis = b.visual || {};
    if (vis.kind === 'definition' && vis.title && vis.items?.[0]) defs.push({ term: vis.title, meaning: vis.items[0] });
    if (vis.kind === 'equation' && vis.items?.length) equations.push({ lines: vis.items.slice(0, 3), meaning: vis.title || '' });
  }
  const points = [
    ...(l.beats || []).map((b) => b.text),
    ...(l.items || []).map((it) => (it.title ? `${it.title.replace('|', ' / ')}: ${it.text}` : it.text)),
    ...(l.exam?.steps || []),
  ].filter(Boolean);
  const cards = (l.cards || []).map((c) => ({ q: c.q, a: c.a }));
  const q = v.quiz || l.quiz;
  return {
    title: l.title || null,
    objective: l.concept?.objective || null,
    keyTerms: [...new Set([...(l.concept?.keyTerms || []), ...(l.beats || []).map((b) => b.keyTerm)].filter(Boolean))].slice(0, 8),
    points, definitions: defs, equations, cards,
    myth: l.myth || null, fact: l.fact || null,
    quiz: q?.question && q.options?.length ? { question: q.question, options: q.options, answerIndex: q.answerIndex ?? 0, explanation: q.explanation || '' } : null,
    takeaway: l.takeaway || null,
    reviewed: Boolean(l.reviewed),
  };
}

/** Which stage-one term chose a unit: exploration, or the largest of affinity, progress and review. */
export function leadOf(why = {}) {
  if (why.explored) return 'explored';
  if (why.kind === 'breather') return 'breather';
  if (why.kind === 'interest') return 'interest';
  if (why.intent > 0) return 'intent';   // a course profile visited just now
  if (why.kind === 'follow') return 'follow'; // a course profile the student follows
  const terms = { affinity: why.affinity || 0, progress: why.progress || 0, review: why.review || 0 };
  const [best] = Object.entries(terms).sort((a, b) => b[1] - a[1])[0] || ['progress'];
  return `${best}-led`;
}

/** Saved videos, watch history and course progress for the Library screen. */
export async function library(userId) {
  const user = await db.getUser(userId);
  const [savedIds, historyRaw, states, savedAt] = await Promise.all([
    kv.smembers(`user:${userId}:saved`),
    kv.lrange(`user:${userId}:history`, 0, 79),
    getProgress(userId),
    kv.get(`user:${userId}:savedAt`),
  ]);
  const summarize = async (id, at) => {
    const v = await db.getVideo(id);
    return v && v.status === 'ready' ? { id: v.id, title: v.lesson?.title, unit: v.unitTitle, topic: v.topic, poster: v.poster, duration: v.duration, format: v.format || 'explain', at: at || null } : null;
  };
  const saved = (await Promise.all((savedIds || []).map((id) => summarize(id, savedAt?.[id])))).filter(Boolean).sort((a, b) => (b.at || 0) - (a.at || 0));
  // History entries are "id|timestamp" (older ones are a bare id); one row per video, most recent first.
  const seenAt = new Map();
  for (const raw of historyRaw || []) { const [id, ts] = String(raw).split('|'); if (!seenAt.has(id)) seenAt.set(id, Number(ts) || null); }
  const history = (await Promise.all([...seenAt].map(([id, at]) => summarize(id, at)))).filter(Boolean);
  const programs = (await Promise.all((user.programKeys || []).map((k) => getProgram(k)))).filter(Boolean);
  const packs = (user.packs || []).map((s) => PACK_BY_SLUG[s]).filter(Boolean);
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
    if (u) units.push(row(u, user.unitGroups?.[id] || (u.pack ? `pack:${u.pack}` : u.custom ? 'custom' : null)));
  }
  return {
    profile: user.profile,
    prefs: cleanPrefs(user.prefs || {}),
    programs: [...programs.map((p) => ({ key: p.key, name: p.name, basis: p.basis, sources: p.sources || [] })),
      ...packs.map((p) => ({ key: `pack:${p.slug}`, name: p.title, basis: `A community pack by ${p.by}`, sources: [], pack: publicPack(p) }))],
    packs: PACKS.map((p) => ({ ...publicPack(p), added: (user.packs || []).includes(p.slug) })),
    units, interests: user.interests, saved, history,
    misses: (await getMisses(userId)).map(recallItem),
    games: playable(materialOf(await watchedVideos(userId))), // which mini games the student's history can make
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
 * Links a Vidmoat identity to a StudyGraph profile (Sign in with Vidmoat).
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
