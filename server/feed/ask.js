// "Ask about this lesson": a private question to a tutor that has the lesson in front of it.
// The answer is short and only about studying; the tutor can suggest a follow-up topic, which the
// app offers to turn into lessons (a custom topic, curriculum/index.js customUnit).
// Every question is also a signal: the student did not get something (events: ask).
//
// Safety: the same rules for everyone (school-appropriate, no personal data asked for, no
// medical/legal/self-harm advice beyond pointing to a trusted adult or a professional), with a
// gentler voice for under-13s. Private: no other student ever sees a question or an answer.

import * as z from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { kv } from '../core/kv.js';
import { claude } from '../core/claude.js';
import { config } from '../core/config.js';
import { notesOf } from './index.js';

export const MAX_QUESTION = 300;
export const ASKS_PER_DAY = 30;

const AnswerSchema = z.object({
  answer: z.string().describe('The reply to the student: at most 120 words, plain text, no markdown headings'),
  followUp: z.string().describe('If a short extra lesson would really help, its topic in 2-6 words (e.g. "Balancing Forces"); otherwise ""'),
  onTopic: z.boolean().describe('false when the question is not about studying (then the answer politely steers back)'),
});

function systemFor({ age, child }) {
  return [
    'You are the tutor inside StudyGraph, a study-video app. A student just watched a short lesson and asks you about it.',
    'Answer the question clearly and correctly in at most 120 words, at the level of the lesson. Use a simple example when it helps. If the question shows a misunderstanding, gently name it and fix it.',
    'Stay on studying. If the question is not about learning, say kindly that you can only help with study questions.',
    'Never ask for or repeat personal details (names, addresses, phone numbers, schools, social media). Nothing sexual, violent, hateful or about weapons, drugs, gambling or cheating on exams.',
    'If the student mentions being hurt, unsafe, or thinking of harming themselves, do not try to handle it yourself: tell them warmly to talk to a trusted adult right now, or a local emergency or helpline number.',
    'Do not complete graded homework word for word; explain how to do it instead.',
    child ? 'The student is a child under 13: short sentences, everyday examples, encouraging tone.' : age != null && age < 18 ? 'The student is a teenager: friendly and direct.' : 'The student is an adult learner.',
  ].join('\n');
}

function lessonContext(video) {
  const n = notesOf(video);
  return [
    `Lesson: ${n.title || video.unitTitle || 'a study lesson'}${video.unitTitle ? ` (course unit: ${video.unitTitle})` : ''}`,
    n.objective && `Objective: ${n.objective}`,
    n.points.length && `What it said:\n- ${n.points.slice(0, 10).join('\n- ')}`,
    n.definitions.length && `Definitions: ${n.definitions.map((d) => `${d.term}: ${d.meaning}`).join('; ')}`,
    n.quiz && `Its quick check: ${n.quiz.question} (answer: ${n.quiz.options[n.quiz.answerIndex]})`,
    n.takeaway && `Takeaway: ${n.takeaway}`,
  ].filter(Boolean).join('\n');
}

async function askClaude({ system, context, question }) {
  const response = await claude().messages.parse({
    model: config.anthropic.reviewModel,
    max_tokens: 600,
    output_config: { effort: 'low', format: zodOutputFormat(AnswerSchema) },
    system,
    messages: [{ role: 'user', content: `${context}\n\nThe student asks: "${question}"` }],
  });
  return response.parsed_output;
}

/** The text of the lesson point the student marked as confusing (null when there is no such part). */
export function confusingPart(video, part) {
  const points = notesOf(video).points;
  const i = Number(part);
  return Number.isInteger(i) && i >= 0 && i < points.length ? points[i].slice(0, 300) : null;
}

/** Cleans the question; throws a 400 with a friendly message when it is not usable. */
export function cleanQuestion(q) {
  const text = String(q || '').replace(/\s+/g, ' ').trim();
  if (text.length < 3) throw Object.assign(new Error('Type your question first.'), { status: 400 });
  if (text.length > MAX_QUESTION) throw Object.assign(new Error(`Keep it under ${MAX_QUESTION} characters.`), { status: 400 });
  return text;
}

/**
 * { answer, followUp, onTopic } for one question about `video`. Throws 429 past the daily limit,
 * 503 when no tutor is configured.
 */
export async function askAboutLesson({ userId, video, question, part = null, audience = {}, ask = askClaude, now = Date.now() }) {
  // "I'm confused": the student points at a part of the lesson instead of typing a question.
  const confusing = part != null ? confusingPart(video, part) : null;
  const q = confusing
    ? `I am confused by this part of the lesson: "${confusing}". ${String(question || '').replace(/\s+/g, ' ').trim().slice(0, 200)} Explain it again in a simpler way, with a different everyday example. If I need to understand something else first, name that topic as the follow-up.`
    : cleanQuestion(question);
  if (confusing) await kv.hincrby(`video:${video.id}:confusion`, String(Number(part)), 1); // which parts lose students, per lesson
  if (ask === askClaude && !config.anthropic.enabled) throw Object.assign(new Error('The tutor is not available right now.'), { status: 503 });
  // The daily limit is checked before the model is called (and counts the attempt).
  const day = new Date(now).toISOString().slice(0, 10);
  if ((await kv.hincrby('ask:counts', `${userId}:${day}`, 1)) > ASKS_PER_DAY) {
    throw Object.assign(new Error(`That's ${ASKS_PER_DAY} questions today. Ask again tomorrow, or watch the lesson notes.`), { status: 429 });
  }
  const r = await tutorAnswer({ video, question: q, audience, ask });
  await kv.hincrby(`events:day:${day}`, 'ask', 1);
  return r;
}

/** The tutor's answer to one question about `video`, with no limits applied (callers limit). */
export async function tutorAnswer({ video, question, audience = {}, ask = askClaude, publicReply = false }) {
  if (ask === askClaude && !config.anthropic.enabled) throw Object.assign(new Error('The tutor is not available right now.'), { status: 503 });
  let out;
  try {
    const system = systemFor(audience) + (publicReply ? '\nThis is a public reply under the lesson, read by other students too: answer the question only, never mention the asker personally.' : '');
    out = await ask({ system, context: lessonContext(video), question });
  } catch (err) {
    console.warn('[ask] failed:', err.message);
    throw Object.assign(new Error("The tutor couldn't answer just now. Try again in a moment."), { status: 502 });
  }
  const answer = String(out?.answer || '').trim().slice(0, 1200);
  if (!answer) throw Object.assign(new Error("The tutor couldn't answer that. Try asking it another way."), { status: 502 });
  const followUp = out?.onTopic === false ? '' : String(out?.followUp || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return { answer, followUp: followUp.length >= 3 ? followUp : '', onTopic: out?.onTopic !== false };
}
