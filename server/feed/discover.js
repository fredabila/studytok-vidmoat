// Explore: a personalised grid of lessons outside the student's feed, courses to follow,
// typeahead search across courses, lessons, topics and packs, and trending searches.
//
// The candidate pool (the newest ready lessons with their quality) is shared and rebuilt at most
// every 10 minutes; each student's grid is scored from it with their own signals in a couple of
// reads. Only lessons that suit the student's country (or no country) are ever shown.
//
// Storage:
//   discover:pool        JSON  { at, items: [compact lessons] } (10 minutes)
//   search:lessons       HASH  video id → { s: searchable text, t, p, d, f, tp, lv, loc, u, ut }
//   search:q:<week>      ZSET  normalised query → searches that found something (trending)

import { kv } from '../core/kv.js';
import * as db from '../core/db.js';
import { TOPIC_BY_ID, TOPICS } from '../curriculum/topics.js';
import { LEVELS } from '../curriculum/levels.js';
import { PACKS, publicPack } from '../curriculum/packs.js';
import { regionOf } from '../lessons/index.js';
import { format as formatOf } from '../video/formats.js';
import { affinity, videoQuality } from './ranking.js';
import { searchChannels, topPublic, followingOf, getChannel, publicChannel } from './channels.js';
import { indexLesson } from '../core/search.js';

const POOL_SIZE = 400;
const POOL_MS = 10 * 60 * 1000;
const LEVEL_ORDER = LEVELS.map((l) => l.id);
// Never shown as a trending search, whoever typed it.
const BLOCKED = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'porn', 'sex', 'nude', 'kill', 'suicide', 'drug'];

const clean = (s, n = 80) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const normQuery = (q) => clean(q, 60).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 +#.-]/g, ' ').replace(/\s+/g, ' ').trim();
const weekOf = (at = Date.now()) => { const d = new Date(at); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

/** A lesson as the grid and search see it (short keys: the pool is stored as one JSON value). */
export function compact(v, stats = {}, handle = null) {
  return {
    id: v.id, t: v.lesson?.title || v.unitTitle || 'Lesson', p: v.poster || null, d: v.duration || null, f: v.format || 'explain', tp: v.topic || null,
    u: v.unitId || null, ut: v.unitTitle || null, lv: v.level || null, loc: v.loc || null, at: Date.parse(v.createdAt) || 0,
    q: +videoQuality({ views: 0, completes: 0, likes: 0, quizRight: 0, skips: 0, quizWrong: 0, ...Object.fromEntries(Object.entries(stats || {}).map(([k, n]) => [k, Number(n) || 0])) }).toFixed(3),
    n: Number(stats?.views) || 0, h: handle,
  };
}


/** The shared candidate pool: newest ready lessons with quality and course handle (rebuilt every 10 minutes). */
export async function discoverPool({ now = Date.now(), force = false } = {}) {
  const cached = await kv.get('discover:pool');
  if (!force && cached?.at && now - cached.at < POOL_MS) return cached.items;
  if (!(await kv.set('discover:pool:lock', 1, { nx: true, ex: 60 }))) return cached?.items || [];
  try {
    const ids = await kv.zrange('ready:any', 0, POOL_SIZE - 1, { rev: true });
    const items = [];
    const handleOf = new Map();
    const indexed = (await kv.get('migr:searchidx:v1')) ? null : [];
    for (let i = 0; i < ids.length; i += 40) {
      const vids = await Promise.all(ids.slice(i, i + 40).map((id) => db.getVideo(id)));
      const ready = vids.filter((v) => v?.status === 'ready');
      const stats = await Promise.all(ready.map((v) => kv.hgetall(`video:${v.id}:stats`)));
      for (const v of ready) if (v.unitId && !handleOf.has(v.unitId)) handleOf.set(v.unitId, kv.get(`channel:unit:${v.unitId}`));
      for (const [j, v] of ready.entries()) {
        items.push(compact(v, stats[j], await handleOf.get(v.unitId)));
        if (indexed) indexed.push(indexLesson(v));
      }
    }
    if (indexed) { await Promise.all(indexed); await kv.set('migr:searchidx:v1', { at: new Date(now).toISOString(), n: indexed.length }); }
    await kv.set('discover:pool', { at: now, items });
    return items;
  } finally {
    await kv.del('discover:pool:lock');
  }
}

const levelFit = (a, b) => {
  if (!a || !b || a === b) return 1;
  const d = Math.abs(LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b));
  return a === 'lifelong' || b === 'lifelong' ? 0.75 : d === 1 ? 0.6 : 0.3;
};

/**
 * The student's Explore grid: lessons they have not seen, from their country or none, scored by
 * quality × topic taste × level fit × novelty (courses they already study count for less: Explore
 * is for what is next door), with a little randomness, and at most 2 per unit and 4 per course.
 * @returns [{ ...compact, why }]
 */
export async function discoverFor(user, signals, { limit = 60, topic = null, rand = Math.random, now = Date.now() } = {}) {
  const pool = await discoverPool({ now });
  const loc = regionOf(user.profile?.country);
  const level = user.profile?.level || 'lifelong';
  const fits = pool.filter((x) => (!x.loc || x.loc === loc) && (!topic || x.tp === topic));
  if (!fits.length) return [];
  const [seen, following] = await Promise.all([kv.smismember(`user:${user.id}:seen`, fits.map((x) => x.id)), followingOf(user.id)]);
  const mine = new Set(user.units || []);
  const followed = new Set(following);
  const explored = signals.explore || {};
  const scored = fits.filter((_, i) => seen?.[i] !== 1).map((x) => {
    const taste = affinity(signals.topics?.[x.tp], rand); // 0.5 with no evidence
    const tapped = Math.min(0.3, 0.06 * (explored[x.tp] || 0)); // topics they open in Explore
    const novelty = mine.has(x.u) ? 0.45 : x.h && followed.has(x.h) ? 0.8 : 1;
    const fresh = now - x.at < 3 * 86400000 ? 1.1 : 1;
    const score = (0.35 + x.q) * (0.6 + taste + tapped) * levelFit(level, x.lv) * novelty * fresh * (0.85 + 0.3 * rand());
    const why = mine.has(x.u) ? 'From your course' : taste >= 0.62 || tapped >= 0.12 ? `Because you like ${TOPIC_BY_ID[x.tp]?.label || 'this'}` : x.q >= 0.5 && x.n >= 5 ? 'Students finish this one' : fresh > 1 ? 'New' : x.h ? `From @${x.h}` : null;
    return { ...x, score, why };
  }).sort((a, b) => b.score - a.score);
  const perUnit = new Map();
  const perCourse = new Map();
  const out = [];
  for (const x of scored) {
    if ((perUnit.get(x.u) || 0) >= 2 || (x.h && (perCourse.get(x.h) || 0) >= 4)) continue;
    perUnit.set(x.u, (perUnit.get(x.u) || 0) + 1);
    if (x.h) perCourse.set(x.h, (perCourse.get(x.h) || 0) + 1);
    out.push(x);
    if (out.length >= limit) break;
  }
  return out;
}

/** Courses to suggest: with lessons, not followed, close to the student's topics and level. */
export async function suggestCourses(user, signals, { limit = 10, rand = Math.random } = {}) {
  const [list, following] = await Promise.all([topPublic({ limit: 40 }), followingOf(user.id)]);
  const followed = new Set(following); // their own courses are followed too, so they are never suggested
  const topicsTheyLike = new Set([...(user.interests || []), ...Object.entries(signals.topics || {}).filter(([, s]) => (s.completes || 0) + (s.likes || 0) >= 2).map(([t]) => t)]);
  return list.filter((c) => !followed.has(c.handle)).map((c) => {
    const near = c.topic && topicsTheyLike.has(c.topic.id) ? 1.6 : 1;
    const lvl = c.level ? levelFit(user.profile?.level, c.level.id) : 0.9;
    const pop = Math.log2(2 + c.followers) * Math.log2(2 + c.lessons);
    return { ...c, score: pop * near * lvl * (0.8 + 0.4 * rand()), why: near > 1 ? `You like ${c.topic.label}` : c.followers >= 3 ? `${c.followers} students follow it` : null };
  }).sort((a, b) => b.score - a.score).slice(0, limit).map(({ score, ...c }) => ({ ...c, following: false }));
}

/** Topic chips, the student's favourites first. */
export function topicChips(user, signals) {
  const liked = (t) => (signals.topics?.[t.id]?.completes || 0) + 2 * (signals.topics?.[t.id]?.likes || 0) + ((user.interests || []).includes(t.id) ? 3 : 0) + (signals.explore?.[t.id] || 0);
  return TOPICS.map((t) => ({ id: t.id, label: t.label, emoji: t.emoji, accent: t.accent, w: liked(t) })).sort((a, b) => b.w - a.w).map(({ w, ...t }) => t);
}

// ------------------------------------------------------------------------------ search
let lessonCache = null; // { at, entries } per server instance, for a minute
async function lessonEntries(now = Date.now()) {
  if (lessonCache && now - lessonCache.at < 60000) return lessonCache.entries;
  await discoverPool({ now }); // the first build also indexes older lessons
  const h = (await kv.hgetall('search:lessons')) || {};
  const entries = Object.entries(h).map(([id, raw]) => ({ id, ...(typeof raw === 'string' ? JSON.parse(raw) : raw) }));
  lessonCache = { at: now, entries };
  return entries;
}
export const resetSearchCache = () => { lessonCache = null; };

const words = (q) => normQuery(q).split(' ').filter((w) => w.length > 1).slice(0, 6);

/** Lessons whose text has every word (prefix match on the last one, for typing), best first. */
export async function searchLessons(q, { loc = '', limit = 30 } = {}) {
  const ws = words(q);
  if (!ws.length) return [];
  const last = ws[ws.length - 1];
  const rest = ws.slice(0, -1);
  const hits = (await lessonEntries()).filter((x) => (!x.loc || x.loc === loc) && rest.every((w) => x.s.includes(w)) && new RegExp(`(^|[^a-z0-9])${last.replace(/[.+#-]/g, '\\$&')}`).test(x.s));
  const titleHit = (x) => ws.every((w) => x.t.toLowerCase().includes(w)) ? 2 : 1;
  return hits.sort((a, b) => titleHit(b) - titleHit(a) || b.at - a.at).slice(0, limit);
}

/** Searches that found something, this week and last, most common first. */
export async function trendingSearches(limit = 8) {
  const [a, b] = await Promise.all([kv.zrange(`search:q:${weekOf()}`, 0, 30, { rev: true, withScores: true }), kv.zrange(`search:q:${weekOf(Date.now() - 7 * 86400000)}`, 0, 30, { rev: true, withScores: true })]);
  const n = new Map();
  for (const flat of [a, b]) for (let i = 0; i + 1 < flat.length; i += 2) n.set(flat[i], (n.get(flat[i]) || 0) + Number(flat[i + 1]));
  return [...n].filter(([q, c]) => c >= 2 && !BLOCKED.some((w) => q.includes(w))).sort((x, y) => y[1] - x[1]).slice(0, limit).map(([q]) => q);
}

/**
 * Counts a search, once per student per query per day. One that found something feeds the
 * popular searches; one that found nothing is demand: `search:gaps` ranks missing topics by how
 * many different students looked for them (feed/gaps.js turns the top ones into courses).
 */
export async function noteSearch(userId, q, found) {
  const nq = normQuery(q);
  if (nq.length < 3 || nq.length > 40 || !userId) return;
  if (!(await kv.set(`search:seen:${userId}:${nq}`, 1, { nx: true, ex: 86400 }))) return;
  if (found) { await kv.zincrby(`search:q:${weekOf()}`, 1, nq); return; }
  if (BLOCKED.some((w) => nq.includes(w))) return;
  await kv.sadd(`search:gapusers:${nq}`, userId);
  await kv.zadd('search:gaps', { score: Number(await kv.scard(`search:gapusers:${nq}`)) || 1, member: nq });
}

/** Missing topics, most-wanted first: [{ q, students }]. */
export async function searchGaps(limit = 30) {
  const flat = await kv.zrange('search:gaps', 0, limit - 1, { rev: true, withScores: true });
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ q: flat[i], students: Number(flat[i + 1]) || 0 });
  return out;
}

/** Popular searches with their counts (admin insights; no minimum). */
export async function searchCounts(limit = 30) {
  const flat = await kv.zrange(`search:q:${weekOf()}`, 0, limit - 1, { rev: true, withScores: true });
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ q: flat[i], searches: Number(flat[i + 1]) || 0 });
  return out;
}

/**
 * Typeahead: up to 8 suggestions of four kinds. `query` completes a popular search, `course`
 * opens a profile, `lesson` plays it, `topic` filters the grid.
 */
export async function suggest(q, user, { limit = 8 } = {}) {
  const nq = normQuery(q);
  if (nq.length < 1) return [];
  const loc = regionOf(user?.profile?.country);
  const [courses, lessons, trending] = await Promise.all([nq.length >= 2 ? searchChannels(nq, 4) : [], nq.length >= 2 ? searchLessons(nq, { loc, limit: 4 }) : [], trendingSearches(20)]);
  const out = [];
  for (const t of trending.filter((x) => x.startsWith(nq) && x !== nq).slice(0, 2)) out.push({ type: 'query', text: t });
  for (const t of TOPICS.filter((t) => t.label.toLowerCase().startsWith(nq) || t.id.startsWith(nq)).slice(0, 2)) out.push({ type: 'topic', id: t.id, label: t.label, emoji: t.emoji });
  const chs = (await Promise.all(courses.map(async ({ handle, followers }) => { const ch = await getChannel(handle); return ch ? { type: 'course', handle: ch.handle, name: ch.name, emoji: TOPIC_BY_ID[ch.topic]?.emoji || '📚', avatar: ch.avatar?.id ? `/a/${ch.avatar.id}` : null, followers } : null; }))).filter(Boolean);
  out.push(...chs.slice(0, 3));
  out.push(...lessons.slice(0, 3).map((x) => ({ type: 'lesson', id: x.id, title: x.t, unit: x.ut, poster: x.p })));
  for (const p of PACKS.filter((p) => p.title.toLowerCase().includes(nq)).slice(0, 1)) out.push({ type: 'pack', slug: p.slug, title: p.title });
  return out.slice(0, limit);
}

/** Full results: courses, lessons and packs. */
export async function search(q, user) {
  const nq = normQuery(q);
  if (nq.length < 2) return { q: nq, courses: [], lessons: [], packs: [] };
  const loc = regionOf(user?.profile?.country);
  const [found, lessons] = await Promise.all([searchChannels(nq, 12), searchLessons(nq, { loc, limit: 36 })]);
  const courses = (await Promise.all(found.map(async ({ handle }) => { const ch = await getChannel(handle); return ch ? publicChannel(ch, { userId: user?.id, user }) : null; }))).filter(Boolean);
  const packs = PACKS.filter((p) => `${p.title} ${p.by} ${p.about} ${p.tags.join(' ')} ${p.units.map((u) => u.title).join(' ')}`.toLowerCase().includes(nq)).slice(0, 6).map(publicPack);
  return { q: nq, courses, lessons: lessons.map(tileOf), packs };
}

/** A lesson tile for the app (Explore grid and search). */
export const tileOf = (x) => ({ id: x.id, title: x.t, poster: x.p, duration: x.d, format: formatOf(x.f).tag, topic: x.tp, unit: x.ut, handle: x.h || null, why: x.why || undefined, loc: x.loc || null });
