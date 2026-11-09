// StudyGraph's data model on top of kv.js. All functions are async and safe to call from
// separate serverless instances: counters use HINCRBY, memberships use sets.
//
// Keys
//   video:{id}            JSON  video record (no document)
//   video:{id}:doc        JSON  the Vidmoat edit document (~100 KB), fetched only for playback
//   video:{id}:stats      HASH  views, completes, likes, skips, watchSec
//   ready:{unit|level|exam} ZSET ready video ids for a unit at a level, scored by creation time
//   covered:{topic}       LIST  recent lesson titles/subtopics (to keep lessons varied)
//   user:{id}             JSON  { id, createdAt, interests }
//   user:{id}:seen|served|liked   SET
//   users                 ZSET  every user id scored by join time; users:active scored by last activity
//   media:{url}           JSON  imported stock media, keyed by stock download URL

import { kv } from './kv.js';

const STALE_GENERATING_MS = 6 * 60 * 1000; // a generation that ran longer than this was cut off

// ---------------------------------------------------------------- videos
export async function getVideo(id) {
  const v = await kv.get(`video:${id}`);
  if (!v) return null;
  if (v.status === 'generating' && Date.now() - Date.parse(v.createdAt) > STALE_GENERATING_MS) {
    return { ...v, status: 'failed', error: 'Generation timed out' };
  }
  return v;
}

export const saveVideo = (v) => kv.set(`video:${v.id}`, v);

export async function updateVideo(id, patch) {
  const v = (await kv.get(`video:${id}`)) || { id };
  const next = { ...v, ...patch };
  await kv.set(`video:${id}`, next);
  return next;
}

export const getDocument = (id) => kv.get(`video:${id}:doc`);
export const setDocument = (id, doc) => kv.set(`video:${id}:doc`, doc);

export async function markReady(v) {
  const entry = { score: Date.parse(v.createdAt), member: v.id };
  if (v.level) await kv.zadd(`ready:any:${v.level}`, entry);
  await kv.zadd('ready:any', entry);
  if (v.unitId) await kv.zadd(`ready:unit:${v.unitId}`, entry); // course profiles list lessons by unit (feed/channels.js)
  if (v._poolOnly) return; // backfill: already filed under its unit and counted
  await kv.zadd(`ready:${v.readyKey}`, entry);
  await kv.hincrby('stats:library', 'ready', 1);
}

/** Newest ready videos for a level (any unit), then for any level: instant starters. */
export async function anyReadyIds(level, limit = 40) {
  const mine = await kv.zrange(`ready:any:${level}`, 0, limit - 1, { rev: true });
  if (mine.length >= limit) return mine;
  const all = await kv.zrange('ready:any', 0, limit - 1, { rev: true });
  return [...mine, ...all.filter((id) => !mine.includes(id))];
}

/** Newest ready video ids for a unit+level key (lessons/index.js lessonKey). */
export const readyIds = (readyKey, limit = 60) => kv.zrange(`ready:${readyKey}`, 0, limit - 1, { rev: true });

export async function readyCount() {
  return Number((await kv.hgetall('stats:library'))?.ready) || 0;
}

const STAT_FIELDS = ['views', 'completes', 'likes', 'skips', 'watchSec', 'quizRight', 'quizWrong', 'saves', 'leaves', 'pctSum', 'loops', 'less', 'impressions', 'rewatches'];
// Evidence decays: counters are also kept per month (`<key>:m<YYYYMM>`), and a read blends this
// month and last at full weight with everything older at OLD_WEIGHT, so a video that did well
// with its first viewers a season ago does not keep that score forever.
export const OLD_WEIGHT = 0.35;
export const monthOf = (at = Date.now()) => new Date(at).toISOString().slice(0, 7).replace('-', '');
const prevMonth = (m) => { const y = Number(m.slice(0, 4)), mo = Number(m.slice(4)); return mo === 1 ? `${y - 1}12` : `${y}${String(mo - 1).padStart(2, '0')}`; };
/** A hash's counters with older evidence shrunk: recent (this month + last) + OLD_WEIGHT × the rest. */
export async function blendedHash(key, { now = Date.now(), fields = null } = {}) {
  const m0 = monthOf(now), m1 = prevMonth(m0);
  const [total, a, b] = await Promise.all([kv.hgetall(key), kv.hgetall(`${key}:m${m0}`), kv.hgetall(`${key}:m${m1}`)]);
  if (!total) return null;
  const out = {};
  for (const f of fields || Object.keys(total)) {
    const all = Number(total[f]) || 0, recent = (Number(a?.[f]) || 0) + (Number(b?.[f]) || 0);
    out[f] = Math.round((recent + OLD_WEIGHT * Math.max(0, all - recent)) * 100) / 100;
  }
  return out;
}
export async function getStats(id, { now = Date.now() } = {}) {
  const h = (await blendedHash(`video:${id}:stats`, { now, fields: STAT_FIELDS })) || {};
  return Object.fromEntries(STAT_FIELDS.map((f) => [f, Number(h[f]) || 0]));
}
export const incrStat = (id, field, by = 1) => kv.hincrby(`video:${id}:stats`, field, by);

export async function addCovered(topic, ...titles) {
  const items = titles.filter(Boolean);
  if (!items.length) return;
  await kv.lpush(`covered:${topic}`, ...items);
  await kv.ltrim(`covered:${topic}`, 0, 199);
}
export const getCovered = (topic) => kv.lrange(`covered:${topic}`, 0, 199);

// ---------------------------------------------------------------- users
export const getUser = (id) => kv.get(`user:${id}`);
/** The next member number (#1 was the first student to join). Atomic across instances. */
export const nextMemberNo = () => kv.hincrby('members', 'count', 1);
/** member number -> user id, so invite links (?ref=12) resolve. */
export const indexMember = (user) => (user?.memberNo ? kv.set(`member:${user.memberNo}`, user.id) : null);
export const userIdByMemberNo = (no) => (Number.isInteger(no) && no > 0 ? kv.get(`member:${no}`) : null);
/** Referrals: who invited whom, and how many each member has brought in. */
export const referralCount = async (memberNo) => Number((await kv.hgetall('referrals'))?.[String(memberNo)]) || 0;
/** Gives a user without a number the next one (students from before numbers existed, in order of their next visit). */
export async function ensureMemberNo(user) {
  if (!user || user.memberNo) return user;
  const memberNo = await nextMemberNo();
  const fresh = (await kv.get(`user:${user.id}`)) || user;
  if (fresh.memberNo) return fresh;
  const next = { ...fresh, memberNo };
  await kv.set(`user:${user.id}`, next);
  await indexMember(next);
  return next;
}
export const saveUser = (u) => kv.set(`user:${u.id}`, u);
/** Lists a user in the `users` index (scored by join time) so admin jobs can walk every student. */
export const indexUser = (u) => kv.zadd('users', { score: Date.parse(u.createdAt) || Date.now(), member: u.id });

export const addToSet = (userId, set, ...ids) => (ids.length ? kv.sadd(`user:${userId}:${set}`, ...ids) : 0);
export const removeFromSet = (userId, set, ...ids) => (ids.length ? kv.srem(`user:${userId}:${set}`, ...ids) : 0);
export const countSet = (userId, set) => kv.scard(`user:${userId}:${set}`);
export const inSet = async (userId, set, id) => (await kv.sismember(`user:${userId}:${set}`, id)) === 1;

/** For each id, whether it is in any of the given user sets. */
export async function inAnySet(userId, sets, ids) {
  if (!ids.length) return [];
  const results = await Promise.all(sets.map((s) => kv.smismember(`user:${userId}:${s}`, ids)));
  return ids.map((_, i) => results.some((r) => Number(r[i]) === 1));
}

// ---------------------------------------------------------------- media cache
export const getMedia = (url) => kv.get(`media:${url}`);
export const setMedia = (url, entry) => kv.set(`media:${url}`, entry);
