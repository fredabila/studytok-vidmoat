// A study plan per unit and level, written once and cached: the concepts in teaching order,
// each with an objective (what the student can do afterwards), key terms, the misconception
// to address, an example idea and the exam angle, plus a glossary the whole unit shares.
//
// Episodes are then written against the plan: each one is assigned the next concept, so a
// unit's videos progress deliberately (core idea → mechanism → worked example → exam trap)
// instead of each batch re-deciding what to teach, and terminology stays consistent from one
// video to the next. The plan is also what the app shows a student as "What's in this unit".

import * as z from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { kv } from '../core/kv.js';
import { config } from '../core/config.js';
import { claude } from '../core/claude.js';

export const PlanSchema = z.object({
  concepts: z.array(z.object({
    title: z.string().describe('The concept, 2-6 words, in teaching order'),
    objective: z.string().describe('What the student can do after one video on it ("explain why…", "calculate…", "tell X from Y"), max 110 chars'),
    keyTerms: z.array(z.string()).describe('1-4 terms the video must use and define'),
    misconception: z.string().describe('The common wrong belief or exam mistake to address, max 120 chars; "" if none'),
    example: z.string().describe('A concrete example or situation to teach it through, max 100 chars'),
    examAngle: z.string().describe('How the exam asks about it (question type, what earns marks), max 100 chars; "" if not exam-bound'),
  })).describe('6-10 concepts that cover the unit, from the core idea to applications and exam traps'),
  glossary: z.array(z.object({ term: z.string(), meaning: z.string().describe('max 90 chars') })).describe('5-12 terms used across the unit, defined once, consistently'),
});

const SYSTEM = `You design the study plan for one unit of a student's syllabus, for StudyGraph (short study videos). Think like an experienced teacher preparing the unit: what is the core idea, what builds on what, where do students go wrong, what does the exam actually ask. Be accurate and specific to the level and exam; never invent facts. Order the concepts so each one is needed by the next.`;

const key = (lessonKey) => `plan:${lessonKey}`;
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Tidies a model answer into the stored shape. Exported for the tests. */
export function cleanPlan(raw) {
  const concepts = (raw?.concepts || []).slice(0, 10).map((c) => ({
    title: clip(c.title, 60), objective: clip(c.objective, 110), keyTerms: (c.keyTerms || []).slice(0, 4).map((t) => clip(t, 30)).filter(Boolean),
    misconception: clip(c.misconception, 120), example: clip(c.example, 100), examAngle: clip(c.examAngle, 100),
  })).filter((c) => c.title && c.objective);
  const glossary = (raw?.glossary || []).slice(0, 12).map((g) => ({ term: clip(g.term, 30), meaning: clip(g.meaning, 90) })).filter((g) => g.term && g.meaning);
  return concepts.length >= 3 ? { concepts, glossary, at: Date.now() } : null;
}

/**
 * The plan for this unit + audience (lesson key), from the cache or written now. `ask` is the
 * model call (injected in tests). Returns null when Claude is off or the answer was unusable;
 * lessons are then written without a plan, as before.
 */
export async function unitPlan(unit, audience, lessonKey, { ask = askClaude, facts = [] } = {}) {
  const cached = await kv.get(key(lessonKey));
  if (cached) return cached;
  if (!config.anthropic.enabled || !config.anthropic.plan) return null;
  const lock = `lock:${key(lessonKey)}`;
  if (!(await kv.set(lock, Date.now(), { nx: true, ex: 120 }))) return null; // someone else is writing it; this batch goes without
  try {
    const prompt = [
      unit.open ? `Topic (open-ended): ${unit.title}` : `Unit: ${unit.title}${unit.summary ? ` — ${unit.summary}` : ''}`,
      unit.programName && `Course: ${unit.programName}`,
      `Student: ${audience.audience}${audience.exam ? `, preparing for ${audience.exam}` : ''}${audience.country ? `, in ${audience.country}` : ''}`,
      facts.length && `Facts the unit must respect:\n${facts.slice(0, 30).map((f) => `- ${f}`).join('\n')}`,
      'Write the plan.',
    ].filter(Boolean).join('\n');
    const raw = await ask(prompt);
    const plan = cleanPlan(raw);
    if (plan) await kv.set(key(lessonKey), plan);
    return plan;
  } catch (err) {
    console.warn(`[plan] ${unit.id}: ${err.message}`);
    return null;
  } finally {
    await kv.del(lock);
  }
}

async function askClaude(prompt) {
  const response = await claude().messages.parse({
    model: config.anthropic.model,
    max_tokens: 4000,
    output_config: { effort: config.anthropic.effort, format: zodOutputFormat(PlanSchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') throw new Error(`plan stopped: ${response.stop_reason}`);
  return response.parsed_output;
}

/** Which concepts the next `count` episodes should teach: the next unassigned ones, then round again. */
export async function nextConcepts(plan, lessonKey, count) {
  if (!plan?.concepts?.length) return [];
  const n = plan.concepts.length;
  const cursor = Number(await kv.get(`${key(lessonKey)}:next`)) || 0;
  const picks = Array.from({ length: count }, (_, i) => ({ index: (cursor + i) % n, ...plan.concepts[(cursor + i) % n], round: Math.floor((cursor + i) / n) }));
  await kv.set(`${key(lessonKey)}:next`, cursor + count);
  return picks;
}

/** Lines for the writer: the whole plan for context, the assigned concept per episode, the glossary. */
export function planContext(plan, picks = []) {
  if (!plan?.concepts?.length) return [];
  const lines = [
    `UNIT PLAN (the concepts of this unit in teaching order; every episode teaches one of them):\n${plan.concepts.map((c, i) => `${i + 1}. ${c.title}: ${c.objective}`).join('\n')}`,
  ];
  if (picks.length) {
    lines.push(`This batch, in order:\n${picks.map((p, i) => `Episode ${i + 1} teaches concept ${p.index + 1} "${p.title}"${p.round > 0 ? ' (the unit has been covered once; take a fresh angle: an application, a harder example or an exam trap)' : ''}. Objective: ${p.objective}. Key terms: ${p.keyTerms.join(', ') || '—'}.${p.misconception ? ` Address this misconception: ${p.misconception}.` : ''}${p.example ? ` Example idea: ${p.example}.` : ''}${p.examAngle ? ` Exam angle: ${p.examAngle}.` : ''}`).join('\n')}`);
  }
  if (plan.glossary?.length) lines.push(`Use these terms consistently, with these meanings:\n${plan.glossary.map((g) => `- ${g.term}: ${g.meaning}`).join('\n')}`);
  return lines;
}

/** The cached plan for a lesson key, or null. */
export const getPlan = (lessonKey) => kv.get(key(lessonKey));
