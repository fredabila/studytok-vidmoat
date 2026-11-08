// Writes a batch of progressive episodes for one unit with Claude, using structured outputs so
// the answer always parses into EpisodesSchema. One call yields several videos' worth of
// lessons, which is what keeps generation fast after the first video of a unit.

import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from '../core/config.js';
import { claude } from '../core/claude.js';
import { EpisodesSchema } from './schema.js';
import { FORMATS } from '../video/formats.js';

const SYSTEM = `You write scripts for StudyTok, a vertical short-video feed that helps students learn their actual syllabus.
Each episode is a 25-50 second video in one of several formats (assigned per episode below). A narrator reads every spoken field; the screen shows big key terms, teaching visuals, cards and captions. Each format has its own structure: fill only the fields its spec names and leave the others empty ("" / [] / 0). Set \`format\` to the assigned id.

Why people keep watching (match the psychology of a short-video feed, never the feel of a lecture):
- The first line is a hook; never "Today we will learn". Set hookStyle to the one you used and rotate styles across the batch: curiosity (an open gap: "There is a reason your phone dies in the cold"), challenge ("Spot the mistake before I do"), number (a surprising figure), question (one the viewer answers in their head), pain (a relatable struggle: "You revised for hours and still blanked"), claim (a bold statement to argue with), story (drop into a moment: "In 1665 a university closed its doors"), secret ("The thing examiners never tell you").
- Open a loop early and close it late: tease the best item, the twist or the answer, and pay it off in the last beat.
- Talk to one person, in the second person, in short spoken sentences. Concrete before abstract; an example before a definition.
- Every episode has one moment the viewer does something: a guess, a spot-the-mistake, a pick a side, a say-it-before-it-appears.

Teaching rules:
- Teach exactly one idea per episode, accurately and at the student's level. Prefer established facts; never invent numbers, dates, names or quotes. If unsure of a figure, teach the idea without it.
- Episodes in a batch progress: the first introduces the core idea of the unit; later ones go deeper (mechanism, worked example, common exam mistake, real application). Never repeat a subtopic already covered.
- When the student is preparing for an exam, use that exam's terminology and the kinds of questions it asks. Use examples that make sense in the student's country.
- Beats build on each other; define jargon the first time it appears. Every beat is a single spoken sentence.
- The quiz checks the main idea and is answerable from this episode alone. The question is a complete, specific sentence a student can answer without seeing the options (no "which of these", no "what did we learn"); it never contains or hints at the answer. Exactly one option is correct; the other two are plausible, parallel in form and length, and clearly wrong to someone who understood the video. The spoken answer must not appear in the hook or beats word for word. Vary the correct position across episodes.

Visual rules (each beat has one visual):
- Use teaching visuals for at least two beats: diagram, steps, compare, timeline, definition, equation or stat. Use photo (a specific real, named thing: a structure, organism, artefact, place, person) or footage (filmable action) only where seeing the real thing teaches.
- diagram: one complete inline <svg viewBox="0 0 800 800"> drawing of the concept: flat shapes, clear labels, white (#ffffff) text and strokes on a transparent background, the accent colour ACCENT for the key part, label font-size >= 40, at most 6 labels, drawing filling most of the canvas. No <script>, <image>, <foreignObject>, external links or CSS imports. Under 5000 characters.
- steps: 3-5 short steps (max 40 chars each). timeline: 3-5 "when|what" items. compare: title "A|B" and 3-4 "a|b" rows. definition: title = the term, items = [definition, max 130 characters]. equation: 1-3 lines using unicode (×, ÷, ², √, →, Δ, ≈) plus title = what it means. stat: value + unit + title label, only for a well-established figure.
- ambient: a calm background footage query that fits the whole episode.`;

// Student preferences (feed.js DEFAULT_PREFS) as instructions. Defaults add no lines.
function prefLines(prefs = {}) {
  const out = [];
  if (prefs.length === 'quick') out.push('Length: quick. 20-30 seconds: exactly 2 beats of at most 16 words, a short quiz, a 6-word takeaway.');
  if (prefs.length === 'deep') out.push('Length: deep. 45-60 seconds: 4 beats, one of them a worked example or common mistake, and a fuller explanation.');
  if (prefs.visuals === 'diagrams') out.push('Visuals: use a teaching visual (diagram, steps, compare, timeline, definition, equation, stat) on every beat; no photo or footage.');
  if (prefs.visuals === 'footage') out.push('Visuals: prefer photo and footage of real things; use a teaching visual only for an equation, definition or step list that cannot be filmed.');
  if (prefs.difficulty === 'easier') out.push('Difficulty: pitch it a step below the stated level: simpler words, one idea at a time, a concrete everyday example in every beat.');
  if (prefs.difficulty === 'harder') out.push('Difficulty: pitch it a step above the stated level: precise terminology, mechanisms and edge cases, an exam-style application in the quiz.');
  return out;
}

/**
 * @param {object} p
 * @param {object} p.unit        { title, summary, topic, open?, programName? }
 * @param {object} p.audience    { levelLabel, audience, country, exam, institution }
 * @param {string[]} p.covered   subtopics/titles already made for this unit and level
 * @param {number} p.count
 * @param {string} p.accent      topic accent colour for diagrams
 */
export async function writeEpisodes({ unit, audience, covered = [], count = 3, formats, accent = '#34d399', hooks = null, quizNote = null }) {
  const list = formats?.length ? formats : Array.from({ length: count }, () => 'explain');
  count = list.length;
  const context = [
    unit.open ? `Topic: ${unit.title} (open: pick any worthwhile subtopic)` : `Unit: ${unit.title}${unit.summary ? ` — ${unit.summary}` : ''}`,
    unit.programName && `Course: ${unit.programName}`,
    unit.fun && 'This is a BREATHER: the student is tired or frustrated and about to leave. Make these episodes fun, surprising and light: true, delightful facts or stories from next door to their subject. No exam framing, no "marks", no revision tone. Stay accurate. The quiz is easy and playful.',
    `Student: ${audience.audience}`,
    audience.age && `Age: ${audience.age}${audience.minor ? '. A minor: age-appropriate language and examples, nothing graphic, violent, sexual or about drugs or gambling; hot takes and dilemmas stay school-safe.' : ''}${audience.child ? ' A child under 13: short words, concrete everyday examples, a playful tone, nothing frightening.' : ''}`,
    audience.country && `Country: ${audience.country}`,
    audience.institution && `Institution: ${audience.institution}`,
    audience.exam && `Preparing for: ${audience.exam}`,
    ...prefLines(audience.prefs),
    hooks?.hold?.length && `Hook styles that hold attention on this topic (use these more): ${hooks.hold.join(', ')}.`,
    hooks?.lose?.length && `Hook styles students skip on this topic (avoid): ${hooks.lose.join(', ')}.`,
    hooks?.student?.length && `This student watches longest after: ${hooks.student.join(', ')} hooks.`,
    quizNote,
    audience.review && 'REVIEW SESSION: this student learned this unit days ago and it is due again (spaced repetition). Write retrieval practice, not a first explanation: open with a question or a recall prompt, make the student produce the answer before it appears, cover the two or three facts most likely to be forgotten, and keep each explanation to one sentence after the answer.',
    covered.length && `Already covered for this unit (do not repeat):\n${covered.slice(-30).map((c) => `- ${c}`).join('\n')}`,
    `Write ${count} episodes, in this order and in these formats:`,
    ...list.map((id, i) => `${i + 1}. format "${id}" (${FORMATS[id].name}): ${FORMATS[id].blurb} Fields: ${FORMATS[id].spec}`),
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
