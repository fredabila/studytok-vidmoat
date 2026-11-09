// Where a video's lesson comes from:
//   1. a queued episode for this unit + level (written earlier in a batch)  -> instant
//   2. Claude writes a batch of episodes (one call), the rest are queued
//   3. the offline bank (no Anthropic key, or Claude failed)
// A short lock stops two concurrent requests from paying for the same batch.

import { config } from '../core/config.js';
import { packOfUnit } from '../curriculum/packs.js';
import { unitPlan, nextConcepts, planContext } from './plan.js';
import { reviewEpisodes } from './review.js';
import { kv } from '../core/kv.js';
import { normalize } from '../curriculum/catalog.js';
import { topic as topicOf } from '../curriculum/topics.js';
import { BANK } from './bank.js';
import { sanitizeLesson } from './schema.js';
import { writeEpisodes } from './claude.js';
import { pickFormats, FORMAT_IDS, BREATHER_FORMATS, RETRIEVAL_FORMATS } from '../video/formats.js';
import { formatPerformance, hookGuidance, quizGuidance } from '../feed/events.js';

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
  // Formats that students on this topic actually watch through get written more often.
  const performance = await formatPerformance(unit.topic, FORMAT_IDS).catch(() => ({}));
  // Children under 13 do not get the opinion-led formats.
  // A breather is always light (feed/breathers.js); a review session is always retrieval practice.
  const base = unit.fun ? BREATHER_FORMATS : audience.review ? RETRIEVAL_FORMATS : FORMAT_IDS;
  const allowed = audience.child ? base.filter((f) => !['hottake', 'wyr'].includes(f)) : base;
  const formats = pickFormats(unit.topic, config.anthropic.episodesPerCall, { recent, performance, allowed });
  const hooks = await hookGuidance(unit.topic).catch(() => null);
  const quizNote = await quizGuidance(unit.topic).catch(() => null);
  // The unit's study plan (cached per unit and level): each episode in the batch is assigned
  // the next concept, so a unit's videos progress deliberately and share one glossary.
  const facts = packFacts(unit);
  const plan = await unitPlan(unit, audience, key, { facts });
  const picks = await nextConcepts(plan, key, formats.length);
  const written = await writeEpisodes({ extra: [...packContext(unit), ...planContext(plan, picks)],
    unit, audience, covered, formats, count: formats.length, accent: topicOf(unit.topic).accent, hooks, quizNote,
  });
  // A reviewer pass: facts, the quick check, level fit; small fixes applied, unsound episodes dropped.
  const review = await reviewEpisodes(written, { unit, audience, facts });
  if (review.reviewed) {
    const day = new Date().toISOString().slice(0, 10);
    if (review.fixes) await kv.hincrby(`events:day:${day}`, 'lesson_fixes', review.fixes);
    if (review.dropped) await kv.hincrby(`events:day:${day}`, 'lesson_dropped', review.dropped);
    if (review.notes.length) console.log(`[review] ${unit.id}: ${review.notes.join(' | ')}`);
  }
  const lessons = [];
  review.episodes.forEach((raw, i) => {
    try {
      const concept = picks[i] ? { title: picks[i].title, objective: picks[i].objective, keyTerms: picks[i].keyTerms } : null;
      lessons.push({ ...sanitizeLesson(raw, unit.topic), concept, reviewed: review.reviewed });
    } catch (err) { console.warn('[lessons] dropped an episode:', err.message); }
  });
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
/** The facts a unit must respect: its pack's, when it comes from one. */
export function packFacts(unit) {
  const pack = packOfUnit(unit.id);
  if (!pack) return [];
  const u = pack.units.find((x) => x.id === unit.id);
  return [...(u?.facts || []), ...pack.facts];
}

/** What the writer is told about a pack unit: the pack, its facts, assets and quiz bank. */
export function packContext(unit) {
  const pack = packOfUnit(unit.id);
  if (!pack) return [];
  const u = pack.units.find((x) => x.id === unit.id);
  return [
    `SOURCE PACK: this unit comes from "${pack.title}" (${pack.kind}) by ${pack.by}, a community pack. Teach from its words below and stay faithful to them; name the pack once, in the hook or the outro, as the source.`,
    `About the pack: ${pack.about}`,
    u?.facts?.length && `Facts for this unit (must be right):\n${u.facts.map((f) => `- ${f}`).join('\n')}`,
    pack.facts.length && `Facts for the whole pack (must be right):\n${pack.facts.slice(0, 25).map((f) => `- ${f}`).join('\n')}`,
    pack.assets.length && `Assets the pack provides. To use one as a beat's visual, set visual.kind to "photo" (image) or "footage" (video) and visual.query to exactly "asset:<file>". Use an asset when it shows what the beat is about; otherwise describe stock as usual:\n${pack.assets.filter((a) => a.kind !== 'audio').map((a) => `- asset:${a.file} (${a.kind}): ${a.shows}`).join('\n')}`,
    pack.quiz.length && `Quiz bank from the pack (use one of these for the quick check when it fits the episode; the first option is correct, reorder the options):\n${pack.quiz.slice(0, 12).map((q) => `- ${q.question} | ${q.options.join(' | ')}`).join('\n')}`,
  ].filter(Boolean);
}

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
