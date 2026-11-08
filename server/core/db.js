// StudyTok's data model on top of kv.js. All functions are async and safe to call from
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
export async function getStats(id) {
  const h = (await kv.hgetall(`video:${id}:stats`)) || {};
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
export const saveUser = (u) => kv.set(`user:${u.id}`, u);

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
