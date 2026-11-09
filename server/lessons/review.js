// A second pair of eyes on every batch before it becomes video: a reviewer model checks each
// episode for factual errors, wrong or ambiguous quiz answers, a question that leaks its answer,
// level fit and internal contradictions, and returns small text fixes (or "drop" for an episode
// that cannot be rescued). Cheap (a smaller model, low effort, a few hundred tokens per
// episode) and the single biggest lever on trust: a confident wrong fact in a study video is
// worse than no video.

import * as z from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from '../core/config.js';
import { claude } from '../core/claude.js';

export const ReviewSchema = z.object({
  verdicts: z.array(z.object({
    index: z.number().int().describe('0-based episode index'),
    verdict: z.enum(['ok', 'fix', 'drop']).describe('ok: nothing wrong; fix: apply the fixes below; drop: factually unsound or unteachable as written'),
    reason: z.string().describe('One sentence: what was wrong (or "" for ok), max 160 chars'),
    fixes: z.array(z.object({
      path: z.string().describe('Which text: hook | takeaway | fact | myth | beats[i].text | items[i].text | cards[i].q | cards[i].a | quiz.question | quiz.options[i] | quiz.answerIndex | quiz.explanation | exam.question | exam.options[i] | exam.answerIndex | exam.tip | exam.mistake | exam.steps[i]'),
      value: z.string().describe('The corrected text (for answerIndex: the digit 0, 1 or 2)'),
    })).describe('Minimal edits that make the episode right; [] for ok or drop'),
  })),
});

const SYSTEM = `You review short study-video scripts before they are produced. For each episode check, in this order:
1. Facts: every number, date, name, definition and mechanism is correct and standard for the stated level and exam. Fix wrong ones with the correct value; if a claim cannot be verified or the episode rests on a wrong idea, drop it.
2. The quick check: exactly one option is correct, the question is answerable from the episode alone without seeing the options, it does not contain or hint at the answer, the wrong options are plausible and clearly wrong, and the explanation matches the correct option.
3. Level and language: no jargon undefined at this level, no sentence a narrator cannot say in one breath (over 28 words), no British/American spelling mix within an episode.
4. Internal consistency: beats do not contradict each other, the takeaway follows from the beats, key terms match the text.
Make the smallest edits that fix a problem; keep the author's voice and length limits (hook ≤ 80 chars, beat 10-24 words, options ≤ 28 chars, quiz question ≤ 70 chars, takeaway ≤ 70). Prefer "ok" when nothing is actually wrong: do not rewrite for taste.`;

const LIMITS = { hook: 80, takeaway: 70, fact: 120, myth: 120, 'quiz.question': 70, 'quiz.explanation': 100, 'exam.question': 120, 'exam.tip': 120, 'exam.mistake': 120 };

/** What the reviewer sees of an episode: the spoken and tested text, nothing visual. */
export function reviewView(ep, i) {
  const q = ep.quiz || {};
  return [
    `--- Episode ${i} (format ${ep.format}; subtopic: ${ep.subtopic})`,
    `hook: ${ep.hook}`,
    ...(ep.beats || []).map((b, k) => `beats[${k}].text: ${b.text}`),
    ...(ep.items || []).map((it, k) => `items[${k}].text (${it.title}): ${it.text}`),
    ...(ep.cards || []).map((c, k) => `cards[${k}]: Q ${c.q} | A ${c.a}`),
    ep.myth && `myth: ${ep.myth}`, ep.fact && `fact: ${ep.fact}`,
    ep.exam?.question && `exam.question: ${ep.exam.question} | options: ${(ep.exam.options || []).map((o, k) => `${k}:${o}`).join(' / ')} | answerIndex: ${ep.exam.answerIndex} | steps: ${(ep.exam.steps || []).join(' // ')} | tip: ${ep.exam.tip}`,
    q.question && `quiz.question: ${q.question} | options: ${(q.options || []).map((o, k) => `${k}:${o}`).join(' / ')} | answerIndex: ${q.answerIndex} | explanation: ${q.explanation}`,
    `takeaway: ${ep.takeaway}`,
  ].filter(Boolean).join('\n');
}

/** Applies verdicts to a copy of the episodes. Returns { episodes, dropped, fixes, notes }. Pure; exported for the tests. */
export function applyReview(episodes, verdicts = []) {
  const out = episodes.map((e) => structuredClone(e));
  const drop = new Set();
  let fixes = 0;
  const notes = [];
  for (const v of verdicts) {
    const ep = out[v.index];
    if (!ep) continue;
    if (v.verdict === 'drop') { drop.add(v.index); notes.push(`#${v.index} dropped: ${v.reason}`); continue; }
    if (v.verdict !== 'fix') continue;
    for (const f of v.fixes || []) {
      const value = String(f.value ?? '').replace(/\s+/g, ' ').trim();
      const m = /^(hook|takeaway|fact|myth)$|^(beats|items)\[(\d+)\]\.text$|^cards\[(\d+)\]\.(q|a)$|^(quiz|exam)\.(question|explanation|tip|mistake|answerIndex)$|^(quiz|exam)\.options\[(\d+)\]$|^exam\.steps\[(\d+)\]$/.exec(f.path || '');
      if (!m || (!value && !/answerIndex/.test(f.path))) continue;
      try {
        if (m[1]) ep[m[1]] = value.slice(0, LIMITS[m[1]] || 160);
        else if (m[2]) { const row = ep[m[2]]?.[Number(m[3])]; if (!row) continue; row.text = value.slice(0, 170); }
        else if (m[4] != null) { const card = ep.cards?.[Number(m[4])]; if (!card) continue; card[m[5]] = value.slice(0, m[5] === 'q' ? 70 : 60); }
        else if (m[6]) {
          const obj = ep[m[6]]; if (!obj) continue;
          if (m[7] === 'answerIndex') { const n = Number(value); if (![0, 1, 2].includes(n)) continue; obj.answerIndex = n; }
          else obj[m[7]] = value.slice(0, LIMITS[`${m[6]}.${m[7]}`] || 120);
        } else if (m[8]) { const obj = ep[m[8]]; const k = Number(m[9]); if (!obj?.options || k > 2) continue; obj.options[k] = value.slice(0, 28); }
        else if (m[10] != null) { const k = Number(m[10]); if (!ep.exam?.steps?.[k]) continue; ep.exam.steps[k] = value.slice(0, 160); }
        fixes++;
      } catch { /* a malformed fix is ignored */ }
    }
    if (v.reason) notes.push(`#${v.index} fixed: ${v.reason}`);
  }
  return { episodes: out.filter((_, i) => !drop.has(i)), dropped: drop.size, fixes, notes };
}

/**
 * Reviews a batch. `ask` is the model call (injected in tests). On any failure the batch goes
 * through unreviewed, with a warning: a review outage must not stop lessons.
 */
export async function reviewEpisodes(episodes, { unit, audience, facts = [], ask = askClaude } = {}) {
  if (!config.anthropic.enabled || !config.anthropic.review || !episodes.length) return { episodes, dropped: 0, fixes: 0, notes: [], reviewed: false };
  try {
    const prompt = [
      `Unit: ${unit.title}${unit.summary ? ` — ${unit.summary}` : ''}`,
      `Student: ${audience.audience}${audience.exam ? `, preparing for ${audience.exam}` : ''}`,
      facts.length && `Facts the episodes must agree with:\n${facts.slice(0, 30).map((f) => `- ${f}`).join('\n')}`,
      episodes.map(reviewView).join('\n'),
    ].filter(Boolean).join('\n\n');
    const raw = await ask(prompt);
    const result = applyReview(episodes, raw?.verdicts || []);
    return { ...result, reviewed: true };
  } catch (err) {
    console.warn(`[review] skipped: ${err.message}`);
    return { episodes, dropped: 0, fixes: 0, notes: [], reviewed: false };
  }
}

async function askClaude(prompt) {
  const response = await claude().messages.parse({
    model: config.anthropic.reviewModel,
    max_tokens: 3000,
    output_config: { effort: 'low', format: zodOutputFormat(ReviewSchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'max_tokens') throw new Error('review cut off');
  return response.parsed_output;
}
