// Course profiles ("channels"): every course on StudyGraph has one public profile with a unique
// handle (@hs-biology, @legon-cs101, @ashanti-empire). Students follow and unfollow them like
// TikTok accounts. A profile shows the course's lessons as a grid and a feed, can be shared as
// study-graph.com/@handle, and is how two students who want the same course end up sharing
// one course (and its videos) instead of making a duplicate.
//
// A channel points at one course source, its `ref`:
//   cat:<id>      a catalog program (official, handle = catalog id)
//   res:<hash>    a researched program (named by the student who first researched it)
//   pack:<slug>   a community pack (official, handle = slug)
//   cu:<hash>     a custom topic (named by the student who first added it)
// One ref has at most one channel (`channel:ref:<ref>`), so the second student to research the
// same course, or type the same topic, finds the existing profile and follows it.
//
// Storage:
//   channel:<handle>          JSON  the channel
//   channel:ref:<ref>         handle
//   channel:unit:<unitId>     handle (first channel that claimed the unit; for lesson → profile)
//   channel:<handle>:fans     SET   follower user ids
//   channel:<handle>:stats    HASH  views, follows, unfollows, shares, opens (all-time counters)
//   channels                  ZSET  handle → follower count (discovery, search ranking)
//   channels:names            HASH  handle → lower-case name (search)
//   user:<id>:following       SET   handles
//   ready:unit:<unitId>       ZSET  ready video ids by creation time (db.markReady)

import { createHash } from 'node:crypto';
import { kv } from '../core/kv.js';
import * as db from '../core/db.js';
import { CATALOG } from '../curriculum/catalog.js';
import { PACK_BY_SLUG, PACKS } from '../curriculum/packs.js';
import { getProgram, getUnit } from '../curriculum/index.js';
import { TOPIC_BY_ID } from '../curriculum/topics.js';
import { level as levelOf, LEVEL_BY_ID } from '../curriculum/levels.js';

export const HANDLE = /^[a-z0-9](?:[a-z0-9._-]{1,38}[a-z0-9])$/;
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 40;
// Paths and words a handle must not take: app routes, and names that would mislead.
export const RESERVED = new Set(['api', 'v', 'og', 'c', 'admin', 'administrator', 'root', 'studygraph', 'study-graph', 'studytok', 'vidmoat', 'official',
  'support', 'help', 'about', 'explore', 'library', 'profile', 'settings', 'login', 'logout', 'signin', 'signup', 'me', 'you', 'feed', 'home',
  'sitemap', 'robots', 'privacy', 'terms', 'faq', 'news', 'team', 'staff', 'moderator', 'mod', 'null', 'undefined', 'anonymous', 'everyone']);
const FOLLOW_UNITS_PER_CHANNEL = 16; // a followed course adds at most this many units to the feed
const FOLLOW_CHANNELS_MAX = 12;      // and at most this many followed courses are read per page
export const INTENT_MS = 20 * 60 * 1000; // a profile visit leans the feed towards that course for 20 minutes

/** Lower-cases, drops a leading @ and surrounding space. */
export const cleanHandle = (s) => String(s ?? '').trim().replace(/^@+/, '').toLowerCase().slice(0, 64);

/** { ok, reason } for a handle a student typed. */
export function checkHandle(raw) {
  const h = cleanHandle(raw);
  if (h.length < HANDLE_MIN) return { ok: false, handle: h, reason: `At least ${HANDLE_MIN} characters.` };
  if (h.length > HANDLE_MAX) return { ok: false, handle: h, reason: `At most ${HANDLE_MAX} characters.` };
  if (!HANDLE.test(h)) return { ok: false, handle: h, reason: 'Letters, numbers, dots, dashes and underscores; start and end with a letter or number.' };
  if (/[._-]{2}/.test(h)) return { ok: false, handle: h, reason: 'No two dots, dashes or underscores in a row.' };
  if (RESERVED.has(h)) return { ok: false, handle: h, reason: 'That handle is reserved.' };
  return { ok: true, handle: h };
}

/** A handle made from a course name: "Computer Science 101 (Legon)" → "computer-science-101-legon". */
export function slugHandle(name) {
  const s = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, HANDLE_MAX).replace(/-+$/, '');
  return s.length >= HANDLE_MIN ? s : `${s || 'course'}-${createHash('sha1').update(String(name)).digest('hex').slice(0, 4)}`;
}

/** The channel ref a unit belongs to, or null (interest topics and breathers have no profile). */
export function refOfUnit(unit) {
  if (!unit) return null;
  if (unit.programKey) return unit.programKey;
  if (unit.pack) return `pack:${unit.pack}`;
  if (unit.custom || String(unit.id).startsWith('cu:')) return unit.id;
  return null;
}

/** What a ref is: name, units, level, topic, bio. Null when the source does not exist (yet). */
export async function sourceOf(ref) {
  if (typeof ref !== 'string') return null;
  if (ref.startsWith('cat:')) {
    const p = CATALOG.find((c) => `cat:${c.id}` === ref);
    return p ? { kind: 'course', official: true, name: p.name, units: p.units.map((u) => u.id), level: p.levels.length === 1 ? p.levels[0] : null, topic: p.topic, bio: `The core ${p.name} units, in the order they are usually studied.`, suggest: p.id } : null;
  }
  if (ref.startsWith('pack:')) {
    const p = PACK_BY_SLUG[ref.slice(5)];
    return p ? { kind: 'pack', official: true, name: p.title, units: p.units.map((u) => u.id), level: p.level, topic: p.topic, bio: p.about, by: p.by, suggest: p.slug } : null;
  }
  if (ref.startsWith('res:')) {
    const p = await getProgram(ref);
    if (!p || p.status !== 'ready' || !p.units?.length) return null;
    const where = [p.institution, p.country].filter(Boolean).join(', ');
    return { kind: 'course', official: false, name: p.name, units: p.units.map((u) => u.id), level: p.level, topic: p.units[0]?.topic || null,
      bio: [p.basis, where && !String(p.basis || '').includes(where) ? where : '', p.exam ? `Exam: ${p.exam}` : ''].filter(Boolean).join(' · '), suggest: slugHandle([p.institution, p.name].filter(Boolean).join(' ')) };
  }
  if (ref.startsWith('cu:')) {
    const u = await getUnit(ref);
    return u ? { kind: 'topic', official: false, name: u.title, units: [u.id], level: null, topic: u.topic || null, bio: `Lessons on ${u.title}, a topic added by a StudyGraph student.`, suggest: slugHandle(u.title) } : null;
  }
  return null;
}

/** A channel with its units refreshed for sources that can change (catalog, packs). */
export async function getChannel(handle) {
  const h = cleanHandle(handle);
  if (!HANDLE.test(h)) return null;
  let ch = await kv.get(`channel:${h}`);
  // Official courses have a profile from the start: made on first visit under their official handle.
  if (!ch) {
    const officialRef = CATALOG.some((p) => p.id === h) ? `cat:${h}` : PACK_BY_SLUG[h] ? `pack:${h}` : null;
    if (!officialRef) return null;
    const made = await ensureChannel(officialRef);
    if (!made || made.channel.handle !== h) return null;
    ch = made.channel;
  }
  if (ch.ref.startsWith('cat:') || ch.ref.startsWith('pack:')) {
    const src = await sourceOf(ch.ref);
    if (src) return { ...ch, units: src.units, name: src.name, bio: ch.bio || src.bio };
  }
  return ch;
}

export async function channelForRef(ref) {
  const h = await kv.get(`channel:ref:${ref}`);
  return h ? getChannel(h) : null;
}

/** Is this handle free to take? { ok, handle, reason?, taken? } */
export async function handleAvailable(raw) {
  const c = checkHandle(raw);
  if (!c.ok) return c;
  if (await kv.get(`channel:${c.handle}`)) return { ok: false, handle: c.handle, taken: true, reason: `@${c.handle} is taken.` };
  return c;
}

/** A free handle near `base`: base, base-2, base-3… */
export async function freeHandleNear(base) {
  const root = checkHandle(base).ok ? cleanHandle(base) : slugHandle(base);
  for (let i = 1; i < 60; i++) {
    const h = i === 1 ? root : `${root.slice(0, HANDLE_MAX - String(i).length - 1).replace(/[._-]+$/, '')}-${i}`;
    if ((await handleAvailable(h)).ok) return h;
  }
  return `${root.slice(0, 30)}-${createHash('sha1').update(`${root}${Date.now()}`).digest('hex').slice(0, 6)}`;
}

/**
 * The channel for a course: the existing one, or a new one under the requested handle (when
 * valid and free), else a free handle near the suggestion.
 * @returns {Promise<null | { channel, existed: boolean, requested?: string, gotRequested?: boolean }>}
 */
export async function ensureChannel(ref, { handle = null, createdBy = null } = {}) {
  const existing = await channelForRef(ref);
  if (existing) return { channel: existing, existed: true };
  const src = await sourceOf(ref);
  if (!src) return null;
  // Official courses (catalog, packs) keep their official handle; students name only what they bring.
  const wanted = !src.official && handle && checkHandle(handle).ok ? cleanHandle(handle) : null;
  const tries = [...(wanted ? [wanted] : []), await freeHandleNear(src.suggest || src.name)];
  for (let attempt = 0; attempt < 4; attempt++) {
    const h = tries[attempt] || await freeHandleNear(src.suggest || src.name);
    const rec = {
      handle: h, ref, kind: src.kind, official: src.official, name: src.name, bio: src.bio || '', level: src.level || null, topic: src.topic || null,
      by: src.by || null, units: src.units, createdBy: src.official ? null : createdBy || null, createdAt: new Date().toISOString(),
    };
    if (!(await kv.set(`channel:${h}`, rec, { nx: true }))) continue; // someone took it a moment ago
    if (!(await kv.set(`channel:ref:${ref}`, h, { nx: true }))) { // another request made this course's channel first
      await kv.del(`channel:${h}`);
      const other = await channelForRef(ref);
      return other ? { channel: other, existed: true } : null;
    }
    await Promise.all([
      ...src.units.map((u) => kv.set(`channel:unit:${u}`, h, { nx: true })),
      kv.zadd('channels', { score: 0, member: h }),
      kv.hset('channels:names', { [h]: `${src.name} ${src.by || ''}`.toLowerCase().trim() }),
    ]);
    return { channel: rec, existed: false, requested: wanted || undefined, gotRequested: wanted ? h === wanted : undefined };
  }
  return null;
}

/** The channel a lesson's unit belongs to (made on first need for any course that has a source). */
export async function channelOfUnit(unitId) {
  if (!unitId) return null;
  const h = await kv.get(`channel:unit:${unitId}`);
  if (h) return getChannel(h);
  const ref = refOfUnit(await getUnit(unitId));
  return ref ? (await ensureChannel(ref))?.channel || null : null;
}

// ------------------------------------------------------------------------------ following
export const followingOf = async (userId) => (userId ? (await kv.smembers(`user:${userId}:following`)) || [] : []);
export const isFollowing = async (userId, handle) => Boolean(userId) && (await kv.sismember(`user:${userId}:following`, handle)) === 1;
export const followerCount = (handle) => kv.scard(`channel:${handle}:fans`);
export const statOf = (handle, field, by = 1) => kv.hincrby(`channel:${handle}:stats`, field, by);

/** Follows; returns { following: true, followers, added }. */
export async function follow(userId, handle, { auto = false } = {}) {
  const ch = await getChannel(handle);
  if (!ch) throw Object.assign(new Error('No such course profile'), { status: 404 });
  const added = await kv.sadd(`user:${userId}:following`, ch.handle);
  if (added) {
    await Promise.all([kv.sadd(`channel:${ch.handle}:fans`, userId), kv.zincrby('channels', 1, ch.handle), statOf(ch.handle, auto ? 'autoFollows' : 'follows'),
      kv.hincrby(`events:day:${new Date().toISOString().slice(0, 10)}`, auto ? 'channel_autofollow' : 'channel_follow_state', 1)]);
  }
  return { following: true, followers: await followerCount(ch.handle), added: Boolean(added), channel: ch };
}

/** Unfollows; returns { following: false, followers, removed }. */
export async function unfollow(userId, handle) {
  const ch = await getChannel(handle);
  if (!ch) throw Object.assign(new Error('No such course profile'), { status: 404 });
  const removed = await kv.srem(`user:${userId}:following`, ch.handle);
  if (removed) {
    await Promise.all([kv.srem(`channel:${ch.handle}:fans`, userId), kv.zincrby('channels', -1, ch.handle), statOf(ch.handle, 'unfollows'),
      kv.hincrby(`events:day:${new Date().toISOString().slice(0, 10)}`, 'channel_unfollow_state', 1)]);
  }
  return { following: false, followers: await followerCount(ch.handle), removed: Boolean(removed), channel: ch };
}

/** The refs of a student's own course: programs, packs and custom topics. */
export function ownRefs(user) {
  return [...new Set([
    ...(user.programKeys || []),
    ...(user.packs || []).map((s) => `pack:${s}`),
    ...(user.units || []).filter((id) => id.startsWith('cu:')),
  ])];
}

/**
 * Makes sure every course the student studies has a profile, and that the student follows it
 * (the creator of a course, and anyone who picks it at onboarding, follows it by default).
 * `handles`: { [ref]: wanted handle } for courses this student is naming.
 * @returns {Promise<Array<{ ref, handle, existed, gotRequested? }>>}
 */
export async function syncOwnChannels(user, { handles = {} } = {}) {
  const out = [];
  for (const ref of ownRefs(user)) {
    const made = await ensureChannel(ref, { handle: handles[ref] || null, createdBy: user.id }).catch(() => null);
    if (!made) continue;
    if (!user.unfollowed?.includes(made.channel.handle)) await follow(user.id, made.channel.handle, { auto: true });
    out.push({ ref, handle: made.channel.handle, existed: made.existed, gotRequested: made.gotRequested });
  }
  return out;
}

/**
 * What a student's course loses when they unfollow its profile: the program, pack or custom
 * topic and its units (mutates `user`; the caller saves). Returns true when something changed.
 */
export function leaveCourse(user, channel) {
  const before = JSON.stringify([user.programKeys, user.packs, user.units]);
  const units = new Set(channel.units || []);
  user.programKeys = (user.programKeys || []).filter((k) => k !== channel.ref);
  if (channel.ref.startsWith('pack:')) user.packs = (user.packs || []).filter((s) => `pack:${s}` !== channel.ref);
  user.units = (user.units || []).filter((id) => !units.has(id) && id !== channel.ref);
  for (const id of units) delete user.unitGroups?.[id];
  // Remember the choice, so the next sync does not follow it again.
  user.unfollowed = [...new Set([...(user.unfollowed || []), channel.handle])].slice(-100);
  return JSON.stringify([user.programKeys, user.packs, user.units]) !== before;
}

/**
 * Feed candidates from the courses a student follows but does not study themselves: kind
 * 'follow', grouped per channel, at most FOLLOW_UNITS_PER_CHANNEL units each. A profile visited
 * in the last INTENT_MS gets `intent` (0..1, fading), which the ranking adds to the unit score.
 */
export async function followCandidates(user, { skip = new Set(), intent = null, now = Date.now() } = {}) {
  const handles = (await followingOf(user.id)).sort().slice(0, FOLLOW_CHANNELS_MAX);
  const lean = intent?.handle && now - (intent.at || 0) < INTENT_MS ? { handle: intent.handle, w: +(1 - (now - intent.at) / INTENT_MS).toFixed(3) } : null;
  if (lean && !handles.includes(lean.handle)) handles.push(lean.handle); // visiting a profile leans the feed even before following
  const out = [];
  for (const h of handles) {
    const ch = await getChannel(h);
    if (!ch) continue;
    const ids = (ch.units || []).filter((id) => !skip.has(id)).slice(0, FOLLOW_UNITS_PER_CHANNEL);
    const units = (await Promise.all(ids.map((id) => getUnit(id)))).filter(Boolean);
    units.forEach((unit, i) => out.push({ unit, kind: 'follow', group: `ch:${h}`, channel: h, order: i, intent: lean?.handle === h ? lean.w : 0, pos: { index: i + 1, total: (ch.units || []).length } }));
  }
  return out;
}

// ------------------------------------------------------------------------------ lessons of a channel
const MIGRATION = 'migr:readyunit:v2';

/**
 * One-off: files every ready video under ready:unit:<unitId> (new ones are filed by db.markReady),
 * and gives every course that already has lessons its profile. A custom topic's profile is
 * credited to the student whose request made its first lesson.
 */
export async function backfillUnitIndex({ force = false } = {}) {
  if (!force && await kv.get(MIGRATION)) return { skipped: true };
  if (!(await kv.set(`${MIGRATION}:lock`, 1, { nx: true, ex: 120 }))) return { busy: true };
  try {
    const ids = await kv.zrange('ready:any', 0, -1);
    let filed = 0;
    const firstBy = new Map(); // unitId → { at, by } of its earliest lesson
    for (let i = 0; i < ids.length; i += 40) {
      const vids = await Promise.all(ids.slice(i, i + 40).map((id) => db.getVideo(id)));
      await Promise.all(vids.filter((v) => v?.status === 'ready' && v.unitId).map((v) => {
        filed++;
        const at = Date.parse(v.createdAt) || Date.now();
        if (!firstBy.has(v.unitId) || at < firstBy.get(v.unitId).at) firstBy.set(v.unitId, { at, by: v.requestedBy || null });
        return kv.zadd(`ready:unit:${v.unitId}`, { score: at, member: v.id });
      }));
    }
    let profiles = 0;
    for (const [unitId, { by }] of firstBy) {
      const ref = refOfUnit(await getUnit(unitId).catch(() => null));
      if (!ref) continue;
      const made = await ensureChannel(ref, { createdBy: ref.startsWith('cu:') ? by : null }).catch(() => null);
      if (made && !made.existed) profiles++;
    }
    await kv.set(MIGRATION, { at: new Date().toISOString(), filed, profiles });
    return { filed, profiles };
  } finally {
    await kv.del(`${MIGRATION}:lock`);
  }
}

/**
 * The channel's ready lessons, newest first: [{ id, at }] merged across its units.
 * `before` (ms) pages backwards.
 */
export async function channelLessonIds(channel, { limit = 30, before = null } = {}) {
  await backfillUnitIndex();
  const per = await Promise.all((channel.units || []).slice(0, 80).map((u) => kv.zrange(`ready:unit:${u}`, 0, limit * 2 - 1, { rev: true, withScores: true })));
  const all = new Map();
  for (const flat of per) for (let i = 0; i + 1 < flat.length; i += 2) all.set(flat[i], Number(flat[i + 1]));
  return [...all].map(([id, at]) => ({ id, at })).filter((x) => before == null || x.at < before).sort((a, b) => b.at - a.at).slice(0, limit);
}

export async function lessonCount(channel) {
  const n = await Promise.all((channel.units || []).slice(0, 80).map((u) => kv.zcard(`ready:unit:${u}`)));
  return n.reduce((a, b) => a + (Number(b) || 0), 0);
}

// ------------------------------------------------------------------------------ discovery
/** Once: profiles for every catalog course and community pack, so Explore and search have them from day one. */
export async function seedOfficial({ force = false } = {}) {
  const FLAG = `migr:officialchannels:${CATALOG.length}:${PACKS.length}`;
  if (!force && await kv.get(FLAG)) return { skipped: true };
  if (!(await kv.set(`${FLAG}:lock`, 1, { nx: true, ex: 60 }))) return { busy: true };
  try {
    const refs = [...CATALOG.map((p) => `cat:${p.id}`), ...PACKS.map((p) => `pack:${p.slug}`)];
    for (let i = 0; i < refs.length; i += 10) await Promise.all(refs.slice(i, i + 10).map((r) => ensureChannel(r).catch(() => null)));
    await kv.set(FLAG, { at: new Date().toISOString(), n: refs.length });
    return { seeded: refs.length };
  } finally {
    await kv.del(`${FLAG}:lock`);
  }
}

/** Top channels by followers: [{ handle, followers }]. */
export async function topChannels(limit = 20) {
  await seedOfficial();
  await backfillUnitIndex(); // profiles for courses that already have lessons
  const flat = await kv.zrange('channels', 0, limit - 1, { rev: true, withScores: true });
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ handle: flat[i], followers: Number(flat[i + 1]) || 0 });
  return out;
}

/** Channels whose handle or name matches every word of `q`, most followed first. */
export async function searchChannels(q, limit = 12) {
  await seedOfficial();
  const words = String(q || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1).slice(0, 6);
  if (!words.length) return [];
  const names = (await kv.hgetall('channels:names')) || {};
  const hits = Object.entries(names).filter(([h, name]) => { const text = `${h} ${name}`; return words.every((w) => text.includes(w)); }).map(([h]) => h);
  if (!hits.length) return [];
  const counts = await Promise.all(hits.map((h) => followerCount(h)));
  return hits.map((h, i) => ({ handle: h, followers: Number(counts[i]) || 0 })).sort((a, b) => b.followers - a.followers).slice(0, limit);
}

// ------------------------------------------------------------------------------ public shape
export async function publicChannel(ch, { userId = null, withUnits = false } = {}) {
  const look = TOPIC_BY_ID[ch.topic] || null;
  const [followers, lessons, following, stats, user] = await Promise.all([followerCount(ch.handle), lessonCount(ch), isFollowing(userId, ch.handle), kv.hgetall(`channel:${ch.handle}:stats`), userId ? db.getUser(userId) : null]);
  let units;
  if (withUnits) units = (await Promise.all((ch.units || []).slice(0, 60).map((id) => getUnit(id)))).filter(Boolean).map((u) => ({ id: u.id, title: u.title, summary: u.summary || '' }));
  return {
    handle: ch.handle, name: ch.name, bio: ch.bio || '', kind: ch.kind, official: Boolean(ch.official), by: ch.by || null,
    level: ch.level && LEVEL_BY_ID[ch.level] ? { id: ch.level, label: levelOf(ch.level).label } : null,
    topic: look ? { id: look.id, label: look.label, emoji: look.emoji, accent: look.accent } : null,
    followers: Number(followers) || 0, lessons, views: Number(stats?.views) || 0, following,
    mine: Boolean(userId && ch.createdBy === userId), createdAt: ch.createdAt, units,
    // Part of the viewer's own course: unfollowing it takes it off their course too.
    inCourse: Boolean(user && ownRefs(user).includes(ch.ref)),
  };
}
