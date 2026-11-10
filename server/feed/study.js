// "Create study materials": flashcards, practice questions and a short summary for one lesson,
// written from that lesson's own content only (nothing the lesson did not teach), made once and
// shared by everyone who opens them (kv: video:<id>:study). Without a model, or when it fails,
// the materials are built from what the lesson already carries (definitions, key points, its
// quick check), so the button always works.

import * as z from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { kv } from '../core/kv.js';
import { claude } from '../core/claude.js';
import { config } from '../core/config.js';
import { notesOf } from './index.js';

const StudySchema = z.object({
  summary: z.string().describe('The lesson in 2-3 plain sentences'),
  flashcards: z.array(z.object({ q: z.string().describe('front: a short question or term'), a: z.string().describe('back: the answer, max 25 words') })).describe('4-6 flashcards'),
  questions: z.array(z.object({
    question: z.string(),
    options: z.array(z.string()).describe('exactly 3 short options'),
    answerIndex: z.number().describe('0, 1 or 2'),
    explanation: z.string().describe('one sentence on why'),
  })).describe('3 practice questions, different from the lesson\'s own quick check'),
});
const SYSTEM = `You turn one short study lesson into revision materials for the student who just watched it. Use ONLY what the lesson says: do not add facts, numbers or examples it does not contain. Flashcards test recall of its key ideas; practice questions check understanding (not trivia) with exactly three options and one clearly correct answer. Plain text, no markdown.`;

function context(video) {
  const n = notesOf(video);
  return [
    `Lesson: ${n.title || video.unitTitle || ''}`,
    n.objective && `Objective: ${n.objective}`,
    n.points.length && `Content:\n- ${n.points.join('\n- ')}`,
    n.definitions.length && `Definitions: ${n.definitions.map((d) => `${d.term}: ${d.meaning}`).join('; ')}`,
    n.equations.length && `Equations: ${n.equations.map((e) => e.lines.join(' ; ')).join(' | ')}`,
    n.myth && `Myth: ${n.myth}`, n.fact && `Fact: ${n.fact}`,
    n.quiz && `Its quick check (do not repeat): ${n.quiz.question}`,
    n.takeaway && `Takeaway: ${n.takeaway}`,
  ].filter(Boolean).join('\n');
}

async function writeClaude(video) {
  const response = await claude().messages.parse({
    model: config.anthropic.reviewModel,
    max_tokens: 1500,
    output_config: { effort: 'low', format: zodOutputFormat(StudySchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: context(video) }],
  });
  return response.parsed_output;
}

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Keeps only well-formed cards and questions. */
export function cleanMaterials(raw) {
  const flashcards = (raw?.flashcards || []).map((c) => ({ q: clip(c?.q, 140), a: clip(c?.a, 220) })).filter((c) => c.q.length > 2 && c.a.length > 1).slice(0, 6);
  const questions = (raw?.questions || []).map((q) => ({
    question: clip(q?.question, 200), options: (q?.options || []).map((o) => clip(o, 90)).filter(Boolean).slice(0, 3),
    answerIndex: Number(q?.answerIndex), explanation: clip(q?.explanation, 220),
  })).filter((q) => q.question.length > 5 && q.options.length === 3 && [0, 1, 2].includes(q.answerIndex)).slice(0, 3);
  return { summary: clip(raw?.summary, 400), flashcards, questions };
}

/** Materials from the lesson's own fields: no model needed. */
export function basicMaterials(video) {
  const n = notesOf(video);
  const flashcards = [
    ...n.cards.map((c) => ({ q: c.q, a: c.a })),
    ...n.definitions.map((d) => ({ q: `What is ${d.term}?`, a: d.meaning })),
    ...(n.myth && n.fact ? [{ q: `True or false: ${n.myth}`, a: `False. ${n.fact}` }] : []),
    ...(n.takeaway ? [{ q: `${n.title || 'This lesson'} in one line?`, a: n.takeaway }] : []),
  ];
  return cleanMaterials({ summary: n.points.slice(0, 2).join(' '), flashcards, questions: n.quiz ? [n.quiz] : [] });
}

/** { summary, flashcards, questions, source: 'ai' | 'lesson' } for a ready lesson. */
export async function studyMaterials(video, { write = writeClaude } = {}) {
  const key = `video:${video.id}:study`;
  const cached = await kv.get(key);
  if (cached) return cached;
  let out = null;
  if (write !== writeClaude || config.anthropic.enabled) {
    try {
      const m = cleanMaterials(await write(video));
      if (m.flashcards.length >= 2) out = { ...m, source: 'ai' };
    } catch (err) {
      console.warn('[study] generation failed:', err.message);
    }
  }
  if (!out) return { ...basicMaterials(video), source: 'lesson' }; // not cached: a later try may do better
  await kv.set(key, out);
  await kv.hincrby(`events:day:${new Date().toISOString().slice(0, 10)}`, 'study_made', 1);
  return out;
}
