// Researches what a student's institution/course actually teaches, so their feed follows
// their syllabus. Two Claude calls:
//   1. web search (server tool) -> plain-text notes with the module list and sources
//   2. structured output        -> a clean, ordered list of units
// They are separate because citations from web search cannot be combined with structured
// output in one request. Results are cached per program by curriculum.js.

import * as z from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from './config.js';
import { claude } from './claude.js';
import { level as levelOf } from './levels.js';
import { TOPICS } from './topics.js';

const TOPIC_IDS = TOPICS.map((t) => t.id);

export const ProgramSchema = z.object({
  programName: z.string().describe('Clean name of the program or subject, e.g. "BSc Computer Science" or "WASSCE Integrated Science"'),
  institutionMatched: z.boolean().describe('True only if the notes describe this specific institution\'s own program'),
  basis: z.string().describe('One short line on what the units are based on, e.g. "University of Ghana 2024/25 course list" or "WAEC Integrated Science syllabus"'),
  units: z
    .array(
      z.object({
        title: z.string().describe('Unit/module title, max 60 characters'),
        summary: z.string().describe('What it covers, max 110 characters'),
        topic: z.enum(TOPIC_IDS).describe('Closest visual style category'),
        stage: z.string().describe('Year/semester/form if known, else ""'),
      }),
    )
    .describe('6 to 14 core units in the order students meet them'),
});

const searchPrompt = (p) => {
  const lvl = levelOf(p.level);
  return [
    `Find out what this student studies so we can make short lessons that follow their actual syllabus.`,
    `Level: ${lvl.label}`,
    p.country && `Country: ${p.country}`,
    p.institution && `Institution: ${p.institution}`,
    p.program && `Program / subject: ${p.program}`,
    p.exam && `Exam they are preparing for: ${p.exam}`,
    '',
    'Search for the official course/module list or syllabus (prefer the institution\'s own site or the official exam board).',
    'Then write concise notes: the modules/units with one line each (grouped by year or term if known), and which pages you used.',
    'If the institution\'s own list cannot be found, say so and use the national curriculum or exam syllabus for that country and level instead.',
  ].filter(Boolean).join('\n');
};

/** Returns { notes, sources:[{title,url}] }. Handles pause_turn for long server-tool turns. */
async function searchNotes(profile) {
  const messages = [{ role: 'user', content: searchPrompt(profile) }];
  const sources = new Map();
  let notes = '';
  for (let turn = 0; turn < 5; turn++) {
    const res = await claude().messages.create({
      model: config.anthropic.researchModel,
      max_tokens: 8000,
      output_config: { effort: config.anthropic.researchEffort },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }],
      messages,
    });
    for (const block of res.content) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) if (r.url && !sources.has(r.url)) sources.set(r.url, { title: r.title || r.url, url: r.url });
      }
      if (block.type === 'text') notes += block.text;
    }
    if (res.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: res.content });
      continue;
    }
    if (res.stop_reason === 'refusal') throw new Error('Research declined');
    break;
  }
  if (!notes.trim()) throw new Error('Research returned no notes');
  return { notes, sources: [...sources.values()].slice(0, 8) };
}

/**
 * @param profile { level, country, institution, program, exam }
 * @returns {Promise<{ name, basis, institutionMatched, units:[{title,summary,topic,stage}], sources }>}
 */
export async function researchProgram(profile) {
  const { notes, sources } = await searchNotes(profile);
  const res = await claude().messages.parse({
    model: config.anthropic.researchModel,
    max_tokens: 6000,
    output_config: { effort: 'low', format: zodOutputFormat(ProgramSchema) },
    messages: [{
      role: 'user',
      content: `Turn these research notes into the student's syllabus units.\n` +
        `Student: ${levelOf(profile.level).label}${profile.country ? `, ${profile.country}` : ''}` +
        `${profile.institution ? `, ${profile.institution}` : ''}${profile.program ? `, ${profile.program}` : ''}` +
        `${profile.exam ? `, preparing for ${profile.exam}` : ''}\n\n<notes>\n${notes.slice(0, 20000)}\n</notes>`,
    }],
  });
  if (res.stop_reason === 'refusal') throw new Error('Research declined');
  const out = res.parsed_output;
  if (!out || !out.units?.length) throw new Error('Research produced no units');
  return { name: out.programName, basis: out.basis, institutionMatched: out.institutionMatched, units: out.units.slice(0, 14), sources };
}
