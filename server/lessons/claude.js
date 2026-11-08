// Writes a batch of progressive episodes for one unit with Claude, using structured outputs so
// the answer always parses into EpisodesSchema. One call yields several videos' worth of
// lessons, which is what keeps generation fast after the first video of a unit.

import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from '../config.js';
import { claude } from '../claude.js';
import { EpisodesSchema } from './schema.js';

const SYSTEM = `You write scripts for StudyTok, a vertical short-video feed that helps students learn their actual syllabus.
Each episode is a 25-45 second video: a narrator reads the hook, each beat, the quiz question, the answer and the takeaway, while the screen shows a big key term, a teaching visual and captions.

Teaching rules:
- Teach exactly one idea per episode, accurately and at the student's level. Prefer established facts; never invent numbers, dates, names or quotes. If unsure of a figure, teach the idea without it.
- Episodes in a batch progress: the first introduces the core idea of the unit; later ones go deeper (mechanism, worked example, common exam mistake, real application). Never repeat a subtopic already covered.
- When the student is preparing for an exam, use that exam's terminology and the kinds of questions it asks. Use examples that make sense in the student's country.
- Beats build on each other; define jargon the first time it appears. Every beat is a single spoken sentence.
- The quiz checks the main idea, has exactly one correct option and two plausible wrong ones; vary the correct position across episodes.

Visual rules (each beat has one visual):
- Use teaching visuals for at least two beats: diagram, steps, compare, timeline, definition, equation or stat. Use photo (a specific real, named thing: a structure, organism, artefact, place, person) or footage (filmable action) only where seeing the real thing teaches.
- diagram: one complete inline <svg viewBox="0 0 800 800"> drawing of the concept: flat shapes, clear labels, white (#ffffff) text and strokes on a transparent background, the accent colour ACCENT for the key part, label font-size >= 40, at most 6 labels, drawing filling most of the canvas. No <script>, <image>, <foreignObject>, external links or CSS imports. Under 5000 characters.
- steps: 3-5 short steps (max 40 chars each). timeline: 3-5 "when|what" items. compare: title "A|B" and 3-4 "a|b" rows. definition: title = the term, items = [definition]. equation: 1-3 lines using unicode (×, ÷, ², √, →, Δ, ≈) plus title = what it means. stat: value + unit + title label, only for a well-established figure.
- ambient: a calm background footage query that fits the whole episode.`;

/**
 * @param {object} p
 * @param {object} p.unit        { title, summary, topic, open?, programName? }
 * @param {object} p.audience    { levelLabel, audience, country, exam, institution }
 * @param {string[]} p.covered   subtopics/titles already made for this unit and level
 * @param {number} p.count
 * @param {string} p.accent      topic accent colour for diagrams
 */
export async function writeEpisodes({ unit, audience, covered = [], count = 3, accent = '#34d399' }) {
  const context = [
    unit.open ? `Topic: ${unit.title} (open: pick any worthwhile subtopic)` : `Unit: ${unit.title}${unit.summary ? ` — ${unit.summary}` : ''}`,
    unit.programName && `Course: ${unit.programName}`,
    `Student: ${audience.audience}`,
    audience.country && `Country: ${audience.country}`,
    audience.institution && `Institution: ${audience.institution}`,
    audience.exam && `Preparing for: ${audience.exam}`,
    covered.length && `Already covered for this unit (do not repeat):\n${covered.slice(-30).map((c) => `- ${c}`).join('\n')}`,
    `Write ${count} episodes.`,
  ].filter(Boolean).join('\n');

  const response = await claude().messages.parse({
    model: config.anthropic.model,
    max_tokens: 16000, // non-streaming: keep under the SDK's 10-minute threshold
    output_config: { effort: config.anthropic.effort, format: zodOutputFormat(EpisodesSchema) },
    system: SYSTEM.replace('ACCENT', accent),
    messages: [{ role: 'user', content: context }],
  });

  if (response.stop_reason === 'refusal') throw new Error(`Lesson declined (${response.stop_details?.category ?? 'no category'})`);
  if (response.stop_reason === 'max_tokens') throw new Error('Lessons were cut off at max_tokens');
  const episodes = response.parsed_output?.episodes;
  if (!episodes?.length) throw new Error('Lessons did not match the schema');
  return episodes;
}
