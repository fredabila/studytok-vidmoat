// A small sound-effects kit from Vidmoat's stock audio (Freesound, CC0 only: no attribution
// needed). Each effect is searched and imported once, then cached for every future video.

import { kv } from '../core/kv.js';
import { searchStock, importMedia } from '../core/vidmoat.js';

const KIT = {
  whoosh: { query: 'swoosh', prefer: /swoosh-3|short soft|digital swoosh/i, min: 0.3, max: 2 },
  pop: { query: 'bubble pop', prefer: /ui bubble pop/i, min: 0.1, max: 1 },
  tick: { query: 'tick tock', prefer: /tick_tock_loop|tick tock/i, min: 0.8, max: 5 },
  ding: { query: 'correct', prefer: /gameshow correct ping|correct3/i, min: 0.4, max: 2.5 },
};

const inflight = new Map();

async function loadEffect(name) {
  const cached = await kv.get(`sfx:v1:${name}`);
  if (cached) return cached;
  const spec = KIT[name];
  const results = (await searchStock(spec.query, 'audio', 24)).filter((r) => r.duration >= spec.min && r.duration <= spec.max);
  results.sort((a, b) => Number(spec.prefer.test(b.name)) - Number(spec.prefer.test(a.name)));
  for (const r of results.slice(0, 3)) {
    try {
      const media = await importMedia(r.downloadUrl);
      const entry = { src: media.url, mediaDuration: media.durationSec ?? r.duration, name: r.name, sourceUrl: r.sourceUrl };
      await kv.set(`sfx:v1:${name}`, entry);
      return entry;
    } catch (err) {
      console.warn(`[sfx] import failed for ${name}: ${err.code || err.message}`);
    }
  }
  return null;
}

/** { whoosh, pop, tick, ding }, each { src, mediaDuration } or null. Never throws. */
export async function soundKit() {
  const out = {};
  await Promise.all(Object.keys(KIT).map(async (name) => {
    if (!inflight.has(name)) inflight.set(name, loadEffect(name).catch(() => null).finally(() => setTimeout(() => inflight.delete(name), 1000)));
    out[name] = await inflight.get(name);
  }));
  return out;
}
