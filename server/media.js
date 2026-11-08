// Finds b-roll and music for a lesson with Vidmoat's free stock search, imports the picks into
// the account (so clip srcs are Vidmoat-hosted, browser-accessible URLs the embed player can load)
// and caches every import by source URL so the same stock file is never imported twice.

import { searchStock, importMedia } from './vidmoat.js';
import { mediaCache } from './store.js';

const searchCache = new Map(); // `${type}:${query}` -> results (in-memory, per process)

async function search(query, type) {
  const key = `${type}:${query.toLowerCase()}`;
  if (!searchCache.has(key)) searchCache.set(key, searchStock(query, type, 12).catch(() => []));
  return searchCache.get(key);
}

async function importOnce(result) {
  const hit = mediaCache.get(result.downloadUrl);
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
  mediaCache.set(result.downloadUrl, entry);
  return entry;
}

// Rank candidates: keyword relevance first (Pexels result URLs carry a description slug, e.g.
// /video/microscopic-view-of-blue-glowing-cells-29851224/), then portrait footage (no crop),
// then short files (fast import), with a little randomness so repeated queries vary.
export function rank(results, avoid, query = '') {
  const terms = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return results
    .filter((r) => r.downloadUrl && !avoid.has(r.downloadUrl))
    .map((r) => {
      const text = `${r.sourceUrl || ''} ${r.name || ''} ${(r.tags || []).join(' ')}`.toLowerCase();
      const hits = terms.filter((t) => text.includes(t.replace(/s$/, ''))).length;
      const score = hits * 2 + (r.height > r.width ? 1.5 : 0) + (r.duration && r.duration <= 20 ? 0.5 : 0) + Math.random();
      return { r, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r);
}

/** One clip per query. Falls back to images, then to the topic's fallback query. */
export async function resolveBroll(queries, fallbackQuery) {
  const used = new Set();
  const out = [];
  for (const q of queries) {
    let picked = null;
    for (const [query, type] of [[q, 'video'], [q, 'image'], [fallbackQuery, 'video']]) {
      const candidates = rank(await search(query, type), used, query);
      for (const c of candidates.slice(0, 3)) {
        try {
          picked = await importOnce(c);
          used.add(c.downloadUrl);
          break;
        } catch (err) {
          console.warn(`[media] import failed for "${query}": ${err.code || err.message}`);
        }
      }
      if (picked) break;
    }
    if (picked) out.push(picked);
  }
  return out;
}

// Freesound tag search is literal and noisy, so use queries that return actual music and drop
// anything tagged as an effect or unsettling. Set STUDYTOK_MUSIC=0 to turn the bed off.
const MUSIC_QUERIES = ['lofi piano', 'calm piano', 'slow cinematic music', 'piano loop', 'acoustic guitar loop'];
const BAD_TAGS = /creepy|horror|hell|drone|distortion|noise|scream|glitch|8-bit|chiptune|field-recording|radio/i;

/** A CC0 music bed from the stock audio library (Freesound, CC0 only). */
export async function resolveMusic() {
  const query = MUSIC_QUERIES[Math.floor(Math.random() * MUSIC_QUERIES.length)];
  const results = (await search(query, 'audio'))
    .filter((r) => r.duration >= 20 && r.duration <= 400 && !BAD_TAGS.test(`${r.name} ${(r.tags || []).join(' ')}`))
    .sort(() => Math.random() - 0.5);
  for (const pick of results.slice(0, 3)) {
    try {
      return await importOnce({ ...pick, width: null, height: null, photographer: pick.username });
    } catch (err) {
      console.warn(`[media] music import failed: ${err.code || err.message}`);
    }
  }
  return null;
}
