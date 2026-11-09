// Lesson materials: the unit study plan, the reviewer pass, the structured visuals (cycle, bars),
// the revision notes and the media ranking. Model calls are injected, so nothing touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-lessons-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
process.env.ANTHROPIC_API_KEY = 'test-key'; // enables the plan and review paths; `ask` is always injected
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const { cleanPlan, unitPlan, nextConcepts, planContext, getPlan } = await import('../server/lessons/plan.js');
const { reviewView, applyReview, reviewEpisodes } = await import('../server/lessons/review.js');
const { sanitizeLesson, VISUAL_KINDS, isTeachingVisual } = await import('../server/lessons/schema.js');
const { teachingVisual } = await import('../server/video/visuals.js');
const { rank } = await import('../server/video/media.js');
const { notesOf } = await import('../server/feed/index.js');
const { SAMPLES } = await import('../server/lessons/samples.js');

const unit = { id: 'hs-biology-u1', title: 'Cell Biology', summary: 'cell structure, organelles and microscopy', topic: 'biology' };
const audience = { level: 'high-school', audience: 'a senior high school student', exam: 'WASSCE', country: 'Ghana' };
const rawPlan = { concepts: [
  { title: 'What a cell is', objective: 'Explain why the cell is the unit of life', keyTerms: ['cell', 'organelle'], misconception: 'That all cells have a nucleus', example: 'A brick in a wall', examAngle: 'Define and give two examples' },
  { title: 'Plant vs animal cells', objective: 'Tell a plant cell from an animal cell', keyTerms: ['cell wall', 'chloroplast'], misconception: '', example: 'Onion skin under a microscope', examAngle: 'Label a diagram' },
  { title: 'The nucleus', objective: 'Describe what the nucleus does', keyTerms: ['DNA'], misconception: 'That the nucleus makes energy', example: '', examAngle: '' },
  { title: 'Mitochondria', objective: 'Explain respiration happens in mitochondria', keyTerms: ['ATP'], misconception: '', example: 'A sprinter', examAngle: 'State the site of respiration' },
], glossary: [{ term: 'organelle', meaning: 'A structure inside a cell with a job' }, { term: '', meaning: 'dropped' }] };

test('a plan is cleaned, cached per lesson key, and hands out concepts in order, wrapping with a fresh-angle note', async () => {
  assert.equal(cleanPlan({ concepts: [{ title: 'a', objective: 'b' }] }), null, 'fewer than three concepts is no plan');
  let asked = 0;
  const plan = await unitPlan(unit, audience, 'k1', { ask: async (prompt) => { asked++; assert.match(prompt, /Cell Biology/); assert.match(prompt, /WASSCE/); return rawPlan; } });
  assert.equal(plan.concepts.length, 4); assert.equal(plan.glossary.length, 1, 'empty glossary rows dropped');
  const again = await unitPlan(unit, audience, 'k1', { ask: async () => { throw new Error('should not be called'); } });
  assert.equal(again.concepts[0].title, 'What a cell is'); assert.equal(asked, 1, 'cached');
  assert.deepEqual(await getPlan('k1'), plan);
  const first = await nextConcepts(plan, 'k1', 3);
  assert.deepEqual(first.map((p) => p.index), [0, 1, 2]);
  const second = await nextConcepts(plan, 'k1', 3);
  assert.deepEqual(second.map((p) => [p.index, p.round]), [[3, 0], [0, 1], [1, 1]], 'wraps and marks the second round');
  const lines = planContext(plan, first);
  assert.match(lines[0], /UNIT PLAN/); assert.match(lines[0], /1\. What a cell is: Explain why/);
  assert.match(lines[1], /Episode 1 teaches concept 1 "What a cell is"/); assert.match(lines[1], /Address this misconception: That all cells have a nucleus/);
  assert.match(lines[2], /organelle: A structure inside a cell with a job/);
  assert.match(planContext(plan, second)[1], /fresh angle/);
  assert.deepEqual(planContext(null, []), []);
  const failed = await unitPlan(unit, audience, 'k2', { ask: async () => { throw new Error('boom'); } });
  assert.equal(failed, null, 'a failed plan call means no plan, not no lesson');
  assert.equal(await kv.get('lock:plan:k2'), null, 'the lock is released');
});

test('the reviewer sees only spoken and tested text, and its verdicts apply as bounded edits', async () => {
  const ep = structuredClone(SAMPLES.explain);
  const view = reviewView(ep, 0);
  assert.match(view, /hook: Objects don’t want to stop/); assert.match(view, /beats\[0\]\.text/); assert.match(view, /quiz\.question/); assert.doesNotMatch(view, /svg|viewBox/);
  const eps = [ep, structuredClone(SAMPLES.explain), structuredClone(SAMPLES.explain)];
  const { episodes, dropped, fixes, notes } = applyReview(eps, [
    { index: 0, verdict: 'fix', reason: 'wrong answer index', fixes: [{ path: 'quiz.answerIndex', value: '2' }, { path: 'beats[0].text', value: 'A moving object keeps moving unless a force acts on it.' }, { path: 'quiz.options[1]', value: 'It keeps the same velocity' }, { path: 'hook', value: 'x'.repeat(200) }, { path: 'nope.field', value: 'ignored' }, { path: 'quiz.answerIndex', value: '7' }] },
    { index: 1, verdict: 'drop', reason: 'rests on a wrong idea', fixes: [] },
    { index: 2, verdict: 'ok', reason: '', fixes: [] },
    { index: 9, verdict: 'drop', reason: 'no such episode', fixes: [] },
  ]);
  assert.equal(episodes.length, 2); assert.equal(dropped, 1); assert.equal(fixes, 4, 'four valid fixes (the hook is clipped, not refused), two ignored');
  assert.equal(episodes[0].quiz.answerIndex, 2); assert.equal(episodes[0].beats[0].text, 'A moving object keeps moving unless a force acts on it.');
  assert.equal(episodes[0].quiz.options[1], 'It keeps the same velocity'); assert.equal(episodes[0].hook.length, 80, 'clipped to the limit');
  assert.equal(eps[0].quiz.answerIndex, 1, 'the input is not mutated');
  assert.equal(notes.length, 2);
  // reviewEpisodes: a stub model; failures pass the batch through
  const r = await reviewEpisodes(eps.slice(0, 1), { unit, audience, facts: ['Newton published the laws in 1687'], ask: async (prompt) => { assert.match(prompt, /1687/); return { verdicts: [{ index: 0, verdict: 'fix', reason: 'tightened', fixes: [{ path: 'takeaway', value: 'No force, no change in motion.' }] }] }; } });
  assert.equal(r.reviewed, true); assert.equal(r.fixes, 1); assert.equal(r.episodes[0].takeaway, 'No force, no change in motion.');
  const down = await reviewEpisodes(eps.slice(0, 1), { unit, audience, ask: async () => { throw new Error('offline'); } });
  assert.equal(down.reviewed, false); assert.equal(down.episodes.length, 1);
});

test('cycle and bars are teaching visuals that sanitize strictly and render without free-hand SVG', () => {
  assert.ok(VISUAL_KINDS.includes('cycle') && VISUAL_KINDS.includes('bars'));
  assert.ok(isTeachingVisual('cycle') && isTeachingVisual('bars'));
  const base = structuredClone(SAMPLES.explain);
  base.beats[0].visual = { kind: 'cycle', title: 'The water cycle', items: ['Evaporation', 'Condensation', 'Precipitation', 'Collection'], query: '', value: 0, unit: '', svg: '' };
  base.beats[1].visual = { kind: 'bars', title: 'Boiling point (°C)', items: ['Water|100', 'Ethanol|78', 'nonsense', 'Mercury|357'], query: '', value: 0, unit: '', svg: '' };
  const l = sanitizeLesson(base, 'physics');
  assert.equal(l.beats[0].visual.kind, 'cycle'); assert.equal(l.beats[0].visual.items.length, 4);
  assert.equal(l.beats[1].visual.kind, 'bars'); assert.deepEqual(l.beats[1].visual.items, ['Water|100', 'Ethanol|78', 'Mercury|357'], 'rows without a number are dropped');
  const few = structuredClone(base); few.beats[0].visual.items = ['Only', 'Two'];
  assert.equal(sanitizeLesson(few, 'physics').beats[0].visual.kind, 'footage', 'a cycle needs three stages');
  const opts = { id: 'v', start: 1, duration: 4, track: 4, accent: '#34d399' };
  const cycle = teachingVisual(l.beats[0].visual, opts);
  const cycleHtml = JSON.stringify(cycle);
  assert.ok(cycle.length >= 1); assert.match(cycleHtml, /Evaporation/); assert.match(cycleHtml, /marker-end/); assert.match(cycleHtml, /The water cycle/);
  const bars = teachingVisual(l.beats[1].visual, { ...opts, theme: 'paper' });
  const barsHtml = JSON.stringify(bars);
  assert.ok(bars.length >= 3, 'staged: one clip per row'); assert.match(barsHtml, /Mercury/); assert.match(barsHtml, /width:100%/); assert.match(barsHtml, /width:22%/);
});

test('notes: a revision sheet from the lesson (objective, terms, points, definitions, quiz, takeaway)', () => {
  const v = { lesson: { ...structuredClone(SAMPLES.explain), concept: { title: 'Inertia', objective: 'Explain why a moving object keeps moving', keyTerms: ['inertia', 'net force'] }, reviewed: true }, quiz: { ...SAMPLES.explain.quiz, hold: 20 } };
  const n = notesOf(v);
  assert.equal(n.objective, 'Explain why a moving object keeps moving');
  assert.ok(n.keyTerms.includes('inertia') && n.keyTerms.includes('Inertia'.trim()) || n.keyTerms.length >= 2);
  assert.ok(n.points.length >= 2); assert.equal(n.definitions[0].term, 'Inertia'); assert.match(n.definitions[0].meaning, /resist/);
  assert.equal(n.quiz.answerIndex, 1); assert.equal(n.reviewed, true); assert.ok(n.takeaway);
  assert.equal(notesOf({}).quiz, null);
});

test('media ranking sinks clip art, logos and text graphics', () => {
  const results = [
    { downloadUrl: 'a', name: 'heart anatomy logo vector', tags: ['icon'], width: 1080, height: 1920, provider: 'pexels' },
    { downloadUrl: 'b', name: 'human heart anatomy model', tags: ['medicine'], width: 1080, height: 1920, provider: 'pexels' },
  ];
  const wins = Array.from({ length: 20 }, () => rank(results, new Set(), 'heart anatomy')[0].downloadUrl);
  assert.ok(wins.every((w) => w === 'b'), 'the real photo always outranks the clip art');
});
