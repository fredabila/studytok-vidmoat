// Writes a fresh lesson with Claude, using structured outputs so the answer is always valid JSON
// in the LessonSchema shape. Credentials come from the environment (ANTHROPIC_API_KEY, or
// ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile).

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from '../config.js';
import { LessonSchema } from './schema.js';

let client;

const SYSTEM = `You write scripts for StudyTok, a vertical short-video feed that teaches one idea per video.
Each video is 20-30 seconds of on-screen text over stock footage, read on a phone.

Rules:
- Teach exactly one idea, accurately. Prefer well-established facts; never invent numbers, dates or quotes.
- The hook is a surprising but true statement or a sharp question. No clickbait that the beats do not pay off.
- Beats build on each other: what it is, how it works, why it matters. Plain words; define any jargon.
- Visual queries must describe filmable things a stock library has (objects, places, nature, people doing things), not abstractions.
- The quiz checks the lesson's main point, has one unambiguous correct answer and two plausible wrong ones. Vary the position of the correct answer.
- Pitch it for a curious high-school or early-university student.`;

/**
 * @param {object} p
 * @param {{id:string,label:string}} p.topic
 * @param {string[]} p.avoid  titles/subtopics already made for this topic (to keep the feed varied)
 * @param {string}  [p.level] optional level hint
 */
export async function writeLessonWithClaude({ topic, avoid = [], level }) {
  client ??= new Anthropic();
  const response = await client.messages.parse({
    model: config.anthropic.model,
    max_tokens: 4000,
    output_config: { effort: config.anthropic.effort, format: zodOutputFormat(LessonSchema) },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          `Topic: ${topic.label}\n` +
          (level ? `Level: ${level}\n` : '') +
          (avoid.length ? `Already covered (pick a different subtopic):\n${avoid.slice(-40).map((a) => `- ${a}`).join('\n')}\n` : '') +
          'Write one lesson.',
      },
    ],
  });

  if (response.stop_reason === 'refusal') throw new Error(`Lesson declined (${response.stop_details?.category ?? 'no category'})`);
  if (response.stop_reason === 'max_tokens') throw new Error('Lesson was cut off at max_tokens');
  if (!response.parsed_output) throw new Error('Lesson did not match the schema');
  return response.parsed_output;
}
