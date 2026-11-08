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

async function importOnce(result) {
  const hit = await getMedia(result.downloadUrl);
  if (hit) return hit;
  const media = await importMedia(result.downloadUrl);
  const entry = {
    src: media.url,
    type: media.mediaType,
    mediaDuration: media.durationSec ?? result.duration ?? null,
    width: result.width ?? null,
    height: result.height ?? null,
    thumbnailUrl: result.thumbnailUrl ?? null,
    credit: result.photographer || result.username || null,
    sourceUrl: result.sourceUrl ?? null,
    provider: result.provider ?? 'freesound',
    importedAt: new Date().toISOString(),
  };
  await setMedia(result.downloadUrl, entry);
  return entry;
}

// Rank candidates: keyword relevance first (Pexels result URLs carry a description slug, e.g.
// /video/microscopic-view-of-blue-glowing-cells-29851224/), then portrait footage (no crop),
// then short files (fast import), with a little randomness so repeated queries vary.
export function rank(results, avoid, query = '', { preferCommons = false } = {}) {
  const terms = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return results
    .filter((r) => r.downloadUrl && !avoid.has(r.downloadUrl))
    .map((r) => {
      const text = `${r.sourceUrl || ''} ${r.name || ''} ${(r.tags || []).join(' ')}`.toLowerCase();
      const hits = terms.filter((t) => text.includes(t.replace(/s$/, ''))).length;
      const commons = preferCommons && r.provider === 'commons' ? 2.5 : 0;
      const score = hits * 2 + commons + (r.height > r.width ? 1.5 : 0) + (r.duration && r.duration <= 20 ? 0.5 : 0) + Math.random();
      return { r, score };
    })
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
  const beatJobs = lesson.beats.map((b) => {
    const v = b.visual || {};
    if (v.kind === 'photo') return [[v.query, 'image', { preferCommons: true }], [v.query, 'video']];
    if (v.kind === 'footage') return [[v.query, 'video'], [v.query, 'image']];
    return null;
  });
  const [ambient, ...beatMedia] = await Promise.all([
    resolveOne([[lesson.ambient, 'video'], [fallbackQuery, 'video']], used),
    ...beatJobs.map((attempts) => (attempts ? resolveOne([...attempts, [fallbackQuery, 'video']], used) : null)),
  ]);
  return { ambient, beatMedia };
}

// Freesound tag search is literal and noisy, so use queries that return actual music and drop
// anything tagged as an effect or unsettling. Set STUDYTOK_MUSIC=0 to turn the bed off.
const MUSIC_QUERIES = ['lofi piano', 'calm piano', 'slow cinematic music', 'piano loop', 'acoustic guitar loop'];
const BAD_TAGS = /creepy|horror|hell|drone|distortion|noise|scream|glitch|8-bit|chiptune|field-recording|radio/i;

/**
 * A CC0 music bed. Imported tracks go into a shared pool that later videos draw from, so most
 * videos need no music import at all; a new track is added now and then to keep variety.
 */
export async function resolveMusic() {
  const pool = (await kv.lrange('music:pool', 0, 49)) || [];
  if (pool.length >= 6 && Math.random() > 0.15) return pool[Math.floor(Math.random() * pool.length)];
  const query = MUSIC_QUERIES[Math.floor(Math.random() * MUSIC_QUERIES.length)];
  const results = (await search(query, 'audio'))
    .filter((r) => r.duration >= 20 && r.duration <= 400 && !BAD_TAGS.test(`${r.name} ${(r.tags || []).join(' ')}`))
    .sort(() => Math.random() - 0.5);
  for (const pick of results.slice(0, 3)) {
    try {
      const track = await importOnce({ ...pick, width: null, height: null, photographer: pick.username });
      if (!pool.some((t) => t.src === track.src)) { await kv.lpush('music:pool', track); await kv.ltrim('music:pool', 0, 49); }
      return track;
    } catch (err) {
      console.warn(`[media] music import failed: ${err.code || err.message}`);
    }
  }
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}
