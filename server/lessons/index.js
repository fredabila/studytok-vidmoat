// Picks where a lesson comes from: Claude when configured, otherwise (or on failure) the offline bank.

import { config } from '../config.js';
import { BANK } from './bank.js';
import { sanitizeLesson } from './schema.js';
import { writeLessonWithClaude } from './claude.js';

const norm = (s) => String(s || '').toLowerCase().trim();

function fromBank(topic, avoid) {
  const list = BANK[topic.id] || [];
  const seen = new Set(avoid.map(norm));
  const fresh = list.filter((l) => !seen.has(norm(l.title)) && !seen.has(norm(l.subtopic)));
  const pool = fresh.length ? fresh : list;
  if (!pool.length) throw new Error(`No offline lessons for topic ${topic.id}`);
  return { lesson: pool[Math.floor(Math.random() * pool.length)], source: 'bank', exhausted: !fresh.length };
}

/**
 * @returns {Promise<{lesson: object, source: 'claude'|'bank', exhausted?: boolean}>}
 */
export async function writeLesson(topic, avoid = []) {
  if (config.anthropic.enabled) {
    try {
      const raw = await writeLessonWithClaude({ topic, avoid });
      return { lesson: sanitizeLesson(raw, topic.id), source: 'claude' };
    } catch (err) {
      console.warn(`[lessons] Claude failed for ${topic.id}, using the offline bank: ${err.message}`);
    }
  }
  const { lesson, source, exhausted } = fromBank(topic, avoid);
  return { lesson: sanitizeLesson(lesson, topic.id), source, exhausted };
}
