// Where a video's lesson comes from:
//   1. a queued episode for this unit + level (written earlier in a batch)  -> instant
//   2. Claude writes a batch of episodes (one call), the rest are queued
//   3. the offline bank (no Anthropic key, or Claude failed)
// A short lock stops two concurrent requests from paying for the same batch.

import { config } from '../config.js';
import { kv } from '../kv.js';
import { normalize } from '../catalog.js';
import { topic as topicOf } from '../topics.js';
import { BANK } from './bank.js';
import { sanitizeLesson } from './schema.js';
import { writeEpisodes } from './claude.js';
import { pickFormats } from '../formats.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Lessons are shared by everyone studying the same unit at the same level (and exam), with the
 * same lesson preferences. Default preferences add nothing, so the common case stays shared.
 */
export const lessonKey = (unitId, audience) => `${unitId}|${audience.level}|${normalize(audience.exam || '')}${audience.lessonStyle || ''}`;

function fromBank(unit, covered) {
  const list = BANK[unit.topic] || [];
  const seen = new Set(covered.map(normalize));
  const fresh = list.filter((l) => !seen.has(normalize(l.title)));
  const pool = fresh.length ? fresh : list;
  if (!pool.length) throw new Error(unit.custom ? 'Custom topics need Claude (set ANTHROPIC_API_KEY)' : `No offline lessons for topic ${unit.topic}`);
  return pool[Math.floor(Math.random() * pool.length)];
}

async function writeBatch(unit, audience, key, covered) {
  // Every batch mixes formats, steering away from the ones this unit used most recently, so a
  // student scrolling one unit never sees the same kind of video twice in a row.
  const recent = ((await kv.lrange(`formats:${key}`, 0, 9)) || []).reverse();
  const formats = pickFormats(unit.topic, config.anthropic.episodesPerCall, { recent });
  const raws = await writeEpisodes({
    unit, audience, covered, formats, count: formats.length, accent: topicOf(unit.topic).accent,
  });
  const lessons = [];
  for (const raw of raws) {
    try { lessons.push(sanitizeLesson(raw, unit.topic)); } catch (err) { console.warn('[lessons] dropped an episode:', err.message); }
  }
  if (!lessons.length) throw new Error('No usable episodes');
  await kv.lpush(`covered:${key}`, ...lessons.flatMap((l) => [l.title, l.subtopic]));
  await kv.ltrim(`covered:${key}`, 0, 199);
  await kv.lpush(`formats:${key}`, ...lessons.map((l) => l.format).reverse());
  await kv.ltrim(`formats:${key}`, 0, 19);
  if (lessons.length > 1) await kv.rpush(`lessons:${key}`, ...lessons.slice(1));
  return lessons[0];
}

/**
 * @param unit      { id, title, summary, topic, open?, programName? }
 * @param audience  { level, levelLabel, audience, country, institution, exam }
 * @returns {Promise<{ lesson, source: 'queue'|'claude'|'bank' }>}
 */
export async function nextLesson(unit, audience) {
  const key = lessonKey(unit.id, audience);
  const meta = { unitId: unit.id, level: audience.level };

  const queued = await kv.lpop(`lessons:${key}`);
  if (queued) return { lesson: { ...queued, ...meta }, source: 'queue' };

  if (config.anthropic.enabled) {
    const covered = await kv.lrange(`covered:${key}`, 0, 199);
    const lock = `lock:lessons:${key}`;
    if (await kv.set(lock, Date.now(), { nx: true, ex: 180 })) {
      try {
        return { lesson: { ...(await writeBatch(unit, audience, key, covered)), ...meta }, source: 'claude' };
      } catch (err) {
        console.warn(`[lessons] Claude failed for ${unit.id}, using the offline bank: ${err.message}`);
      } finally {
        await kv.del(lock);
      }
    } else {
      // Someone else is writing this unit's batch: wait for it rather than paying twice.
      for (let i = 0; i < 50; i++) {
        await sleep(2000);
        const item = await kv.lpop(`lessons:${key}`);
        if (item) return { lesson: { ...item, ...meta }, source: 'queue' };
        if (!(await kv.get(lock))) break;
      }
    }
  }

  const covered = await kv.lrange(`covered:${key}`, 0, 199);
  const raw = fromBank(unit, covered);
  await kv.lpush(`covered:${key}`, raw.title);
  return { lesson: sanitizeLesson(raw, unit.topic, meta), source: 'bank' };
}
