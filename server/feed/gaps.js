// Searches that find nothing are demand. When enough different students search for the same
// missing topic, StudyGraph makes it: a course (custom topic + profile) and a first lesson,
// written for no particular country so anyone can watch it. Runs with the nightly top-up.
//
// Safeguards: only queries at least MIN_STUDENTS different students searched; never anything on
// the blocked list; a model must confirm it is a real, school-appropriate subject to study (and
// gives it a clean title), failing closed; at most MAX_PER_DAY a day; each query only once.

import * as z from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { kv } from '../core/kv.js';
import { claude } from '../core/claude.js';
import { config } from '../core/config.js';
import { customUnit } from '../curriculum/index.js';
import { startVideo } from '../video/generator.js';
import { searchGaps } from './discover.js';
import { ensureChannel } from './channels.js';
import { audienceFor } from './index.js';

export const MIN_STUDENTS = 3;
export const MAX_PER_DAY = 2;

const VerdictSchema = z.object({
  ok: z.boolean().describe('true only if this is a real subject a student could study, suitable for a school-age audience'),
  title: z.string().describe('a clean course title for it, 2-6 words, Title Case (e.g. "Photosynthesis", "Python Decorators"); "" when not ok'),
});
const SYSTEM = `You decide whether a search typed into StudyGraph, a study-video app used by students aged 11 and up, is a real subject worth a short course of lessons. Say ok for school, university, professional or hobby subjects (sciences, history, languages, coding, music theory, chess, finance basics…). Say not ok for: people's names (celebrities, classmates), gossip, news events, products or shopping, anything sexual, violent, hateful, about weapons, drugs, self-harm or cheating, nonsense, and anything you are unsure about. When ok, give a clean title.`;

async function askClaude(q) {
  const response = await claude().messages.parse({
    model: config.anthropic.reviewModel,
    max_tokens: 200,
    output_config: { effort: 'low', format: zodOutputFormat(VerdictSchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Search: "${q}"` }],
  });
  return response.parsed_output;
}

/** { ok, title }: fails closed (no model, an error or an unclear answer means no). */
export async function classifyGap(q, { ask = askClaude } = {}) {
  if (ask === askClaude && !config.anthropic.enabled) return { ok: false, title: '' };
  try {
    const v = await ask(q);
    const title = String(v?.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return v?.ok === true && title.length >= 2 ? { ok: true, title } : { ok: false, title: '' };
  } catch (err) {
    console.warn('[gaps] check failed:', err.message);
    return { ok: false, title: '' };
  }
}

/**
 * Makes courses for the most-wanted missing topics. Returns { made: [{ q, title, handle }], pending }
 * (pass `pending` to waitUntil).
 */
export async function fillSearchGaps({ classify = classifyGap, start = startVideo, now = Date.now() } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  let left = MAX_PER_DAY - (Number(await kv.get(`gaps:made:${today}`)) || 0);
  const made = [];
  const pending = [];
  for (const { q, students } of await searchGaps(30)) {
    if (left <= 0) break;
    if (students < MIN_STUDENTS || (await kv.get(`gap:done:${q}`))) continue;
    await kv.set(`gap:done:${q}`, { at: new Date(now).toISOString(), students }); // decided once, whatever the verdict
    const verdict = await classify(q);
    if (!verdict.ok) continue;
    const unit = await customUnit(verdict.title);
    if (!unit) continue;
    const ch = await ensureChannel(unit.id).catch(() => null);
    // Lessons with no country, so everyone who searched can watch them.
    const started = await start(unit, audienceFor({ profile: { level: 'lifelong' } }), { requestedBy: 'cron' });
    pending.push(started.done);
    left--;
    await kv.set(`gaps:made:${today}`, MAX_PER_DAY - left);
    await kv.hincrby(`events:day:${today}`, 'gap_course', 1);
    made.push({ q, title: verdict.title, handle: ch?.channel?.handle || null });
  }
  return { made, pending };
}
