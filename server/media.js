// Finds b-roll and music for a lesson with Vidmoat's free stock search, imports the picks into
// the account (so clip srcs are Vidmoat-hosted, browser-accessible URLs the embed player can load)
// and caches every import by source URL so the same stock file is never imported twice.

import { searchStock, importMedia } from './vidmoat.js';
import { getMedia, setMedia } from './db.js';
import { kv } from './kv.js';

const searchCache = new Map(); // `${type}:${query}` -> results (in-memory, per instance)

async function search(query, type) {
  const key = `${type}:${query.toLowerCase()}`;
  if (!searchCache.has(key)) searchCache.set(key, searchStock(query, type, 12).catch(() => []));
  return searchCache.get(key);
}

// Pixabay serves the same video at several sizes under one id: _tiny (640), _small (960),
// _medium (1280) and _large (1920). The stock search returns _medium or _tiny; the 1080p file
// is one URL away. Pexels and Commons URLs carry no such variants.
export function pixabayLarge(url) {
  return /cdn\.pixabay\.com\/video\/.*_(tiny|small|medium)\.mp4$/.test(url) ? url.replace(/_(tiny|small|medium)\.mp4$/, '_large.mp4') : null;
}
/** How much a w x h source is enlarged to cover 1080x1920 (1 = native, 2.67 = landscape 720p). */
export const upscaleFactor = (w, h) => (w && h ? Math.max(1080 / w, 1920 / h) : 2.5);

/** Dimensions a candidate will have once imported (after the Pixabay upgrade). */
export function effectiveDims(r) {
  if (r.width && r.height && pixabayLarge(r.downloadUrl || '')) {
    const f = 1920 / Math.max(r.width, r.height);
    return { width: Math.round(r.width * f), height: Math.round(r.height * f) };
  }
  return { width: r.width || 0, height: r.height || 0 };
}

async function importOnce(result) {
  const hit = await getMedia(result.downloadUrl);
  if (hit) return hit;
  let media = null;
  let dims = { width: result.width ?? null, height: result.height ?? null };
  const large = pixabayLarge(result.downloadUrl);
  if (large) {
    try { media = await importMedia(large); dims = effectiveDims(result); } catch { media = null; }
  }
  if (!media) media = await importMedia(result.downloadUrl);
  const entry = {
    src: media.url,
    type: media.mediaType,
    mediaDuration: media.durationSec ?? result.duration ?? null,
    width: dims.width,
    height: dims.height,
    thumbnailUrl: result.thumbnailUrl ?? null,
    credit: result.photographer || result.username || null,
    sourceUrl: result.sourceUrl ?? null,
    provider: result.provider ?? 'freesound',
    importedAt: new Date().toISOString(),
  };
  await setMedia(result.downloadUrl, entry);
  return entry;
}

// Rank candidates: keyword relevance (Pexels result URLs carry a description slug), then
// sharpness on a 1080x1920 canvas (how much the file must be scaled up to cover it: a portrait
// 1080p file barely scales, a landscape 720p file scales 2.7x and looks soft), Commons for
// named things, short files (fast import), and a little randomness so repeated queries vary.
// `maxScale` drops anything that would be scaled up more than that.
export function rank(results, avoid, query = '', { preferCommons = false, maxScale = Infinity } = {}) {
  const terms = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return results
    .filter((r) => r.downloadUrl && !avoid.has(r.downloadUrl))
    .map((r) => {
      const text = `${r.sourceUrl || ''} ${r.name || ''} ${(r.tags || []).join(' ')}`.toLowerCase();
      const hits = terms.filter((t) => text.includes(t.replace(/s$/, ''))).length;
      const commons = preferCommons && r.provider === 'commons' ? 2.5 : 0;
      const { width, height } = effectiveDims(r);
      const scale = upscaleFactor(width, height);
      const sharp = Math.max(0, Math.min(1.8, 2.8 - scale));
      const score = hits * 2 + commons + sharp + (r.duration && r.duration <= 20 ? 0.3 : 0) + Math.random() * 0.8;
      return { r, score, scale };
    })
    .filter((x) => x.scale <= maxScale)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r);
}

async function resolveOne(attempts, used) {
  for (const [query, type, opts] of attempts) {
    if (!query) continue;
    const candidates = rank(await search(query, type), used, query, opts);
    for (const c of candidates.slice(0, 3)) {
      try {
        const m = await importOnce(c);
        used.add(c.downloadUrl);
        return m;
      } catch (err) {
        console.warn(`[media] import failed for "${query}": ${err.code || err.message}`);
      }
    }
  }
  return null;
}

/** One clip per query. Falls back to images, then to the topic's fallback query. */
export async function resolveBroll(queries, fallbackQuery) {
  const used = new Set();
  const out = [];
  for (const q of queries) {
    const m = await resolveOne([[q, 'video'], [q, 'image'], [fallbackQuery, 'video']], used);
    if (m) out.push(m);
  }
  return out;
}

/**
 * Media for a lesson: one ambient background clip, plus a full-bleed photo/footage for each
 * beat whose visual is media-based (teaching visuals get null). Photos of named things prefer
 * Wikimedia Commons (CC0 / public domain).
 * @returns {Promise<{ ambient: object|null, beatMedia: (object|null)[] }>}
 */
export async function resolveLessonMedia(lesson, fallbackQuery) {
  const used = new Set();
  const SHARP = { maxScale: 2 }; // portrait 720p, landscape 1080p or better
  const beatJobs = lesson.beats.map((b) => {
    const v = b.visual || {};
    if (v.kind === 'photo') return [[v.query, 'image', { preferCommons: true }], [v.query, 'video', SHARP], [v.query, 'video']];
    if (v.kind === 'footage') return [[v.query, 'video', SHARP], [v.query, 'image'], [v.query, 'video']];
    return null;
  });
  // Ambient: sharp video when the library has one, otherwise a high-resolution photo with a slow
  // push-in beats an upscaled 720p clip behind the cards.
  // Rapid-fire items each get their own full-bleed footage.
  const itemJobs = (lesson.items || []).map((it) => [[it.visual, 'video', SHARP], [it.visual, 'image'], [it.visual, 'video']]);
  const [ambient, ...rest] = await Promise.all([
    resolveOne([[lesson.ambient, 'video', SHARP], [lesson.ambient, 'image'], [fallbackQuery, 'video', SHARP], [fallbackQuery, 'image'], [lesson.ambient, 'video']], used),
    ...beatJobs.map((attempts) => (attempts ? resolveOne([...attempts, [fallbackQuery, 'video']], used) : null)),
    ...itemJobs.map((attempts) => resolveOne([...attempts, [fallbackQuery, 'video']], used)),
  ]);
  return { ambient, beatMedia: rest.slice(0, beatJobs.length), itemMedia: rest.slice(beatJobs.length) };
}

// Freesound tag search is literal and noisy, so use queries that return actual music and drop
// anything tagged as an effect or unsettling. Set STUDYTOK_MUSIC=0 to turn the bed off.
export const MUSIC_QUERIES = ['lofi piano', 'calm piano', 'slow cinematic music', 'piano loop', 'acoustic guitar loop'];
const BAD_TAGS = /creepy|horror|hell|drone|distortion|noise|scream|glitch|8-bit|chiptune|field-recording|radio/i;

/**
 * A CC0 music bed in one of the given moods (a format's `skin.music` queries). Imported tracks
 * go into a shared pool tagged with their mood, so most videos need no music import at all; a
 * new track is added now and then to keep variety.
 */
export async function resolveMusic(queries = MUSIC_QUERIES) {
  const want = new Set(queries.map((q) => q.toLowerCase()));
  const pool = (await kv.lrange('music:pool', 0, 79)) || [];
  const fitting = pool.filter((t) => want.has((t.query || 'lofi piano').toLowerCase()));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  if (fitting.length >= 3 && Math.random() > 0.2) return pick(fitting);
  const query = pick(queries);
  const results = (await search(`${query} music`, 'audio'))
    .filter((r) => r.duration >= 20 && r.duration <= 400 && !BAD_TAGS.test(`${r.name} ${(r.tags || []).join(' ')}`))
    .sort(() => Math.random() - 0.5);
  for (const candidate of results.slice(0, 3)) {
    try {
      const track = { ...(await importOnce({ ...candidate, width: null, height: null, photographer: candidate.username })), query };
      if (!pool.some((t) => t.src === track.src)) { await kv.lpush('music:pool', track); await kv.ltrim('music:pool', 0, 79); }
      return track;
    } catch (err) {
      console.warn(`[media] music import failed: ${err.code || err.message}`);
    }
  }
  return fitting.length ? pick(fitting) : pool.length ? pick(pool) : null;
}
