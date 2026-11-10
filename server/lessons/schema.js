import * as z from 'zod/v4';
import { FORMAT_IDS } from '../video/formats.js';

// What a StudyGraph video is made of. One schema for every format: a lesson carries `format`,
// and only the fields that format uses are filled (the rest are empty strings/arrays).
// Kept short on purpose: every field becomes on-screen text or narration on a phone.

export const VISUAL_KINDS = ['diagram', 'stat', 'steps', 'compare', 'timeline', 'definition', 'equation', 'cycle', 'bars', 'photo', 'footage'];
const TEACHING = new Set(['diagram', 'stat', 'steps', 'compare', 'timeline', 'definition', 'equation', 'cycle', 'bars']);
export const isTeachingVisual = (kind) => TEACHING.has(kind);

const Visual = z.object({
  kind: z.enum(VISUAL_KINDS).describe('How this beat is shown. Prefer teaching visuals; photo/footage only when seeing the real thing teaches.'),
  query: z.string().describe('photo/footage: stock search query (photo: a specific named thing, e.g. "Pantheon Rome"); else ""'),
  title: z.string().describe('Label/heading for the visual (stat label, steps heading, compare "Left|Right", definition term, equation meaning); else ""'),
  items: z.array(z.string()).describe('steps: 3-5 short steps; timeline: "1450|Event"; compare: rows "left|right"; definition: [definition, max 130 chars]; equation: 1-3 lines; cycle: 3-6 stages in order (max 24 chars each); bars: 2-5 "label|number" rows; else []'),
  value: z.number().describe('stat: the number (no separators); else 0'),
  unit: z.string().describe('stat: suffix such as "%", " km/s", "x"; else ""'),
  svg: z.string().describe('diagram only: complete inline <svg viewBox="0 0 800 800">…</svg>; else ""'),
});

const Beat = z.object({
  text: z.string().describe('One spoken sentence, 10-24 words, plain language; also shown as captions'),
  keyTerm: z.string().describe('The concept (or, in a story, the dateline/chapter label), 1-3 words, shown big'),
  visual: Visual,
});

export const LessonSchema = z.object({
  format: z.enum(FORMAT_IDS).describe('The video format this episode is written for (as assigned)'),
  subtopic: z.string().describe('Narrow subject of this episode, 1-4 words'),
  title: z.string().describe('Feed title, max 60 characters'),
  hook: z.string().describe('Opening line, spoken and shown big, max 80 characters'),
  hookTerm: z.string().describe('1-3 words copied exactly from the hook to highlight'),
  hookStyle: z.enum(['curiosity', 'challenge', 'number', 'question', 'pain', 'claim', 'story', 'secret']).describe('The kind of hook used (see the hook rules)'),
  ambient: z.string().describe('Background footage search query for the whole video, 1-3 concrete visual nouns'),
  beats: z.array(Beat).describe('explain/why/story/mythbust/detective/teachback/numbers/zoom/debate/connect/personify/plottwist/translate and the other beat formats: the beats (see the format spec); else []'),
  myth: z.string().describe('mythbust: the common wrong belief; plottwist: what you would expect; examiner: the vague answer that loses marks; translate: the textbook sentence; else ""'),
  fact: z.string().describe('mythbust/hottake: the correct statement or real point; wow: the astonishing true fact; mnemonic: the mnemonic phrase; detective: the solution; teachback: the model one-sentence explanation; debate: the verdict; redflags: the green flag; plottwist: the twist; examiner: the full-mark sentence; translate: the plain-words version; else ""'),
  items: z.array(z.object({
    title: z.string().describe('max 28 chars (thisorthat: "Left|Right"; mnemonic: "Word|Term"; history: "YEAR|what happened")'),
    text: z.string().describe('one spoken sentence, 8-16 words'),
    visual: z.string().describe('stock footage/photo query for this item'),
    tier: z.string().describe('tierlist: S, A, B or C; else ""'),
  })).describe('rapid/tierlist/thisorthat/countdown/speedrun/cheatsheet/mistakes/history/mnemonic/realworld/howto/redflags/starterpack/examiner: the items (see the format spec); else []'),
  cards: z.array(z.object({ q: z.string().describe('recall question or true/false statement, max 70 chars'), a: z.string().describe('answer, max 60 chars') })).describe('flashcards/truefalse: exactly 4; else []'),
  exam: z.object({
    question: z.string().describe('examdrill: the question, max 120 chars; else ""'),
    options: z.array(z.string()).describe('examdrill: exactly 3 options; else []'),
    answerIndex: z.number().int().describe('examdrill: 0-based correct option; else 0'),
    steps: z.array(z.string()).describe('examdrill: 3-4 worked steps, one spoken sentence each; else []'),
    mistake: z.string().describe('examdrill: the common wrong move; else ""'),
    tip: z.string().describe('examdrill: what earns the marks; else ""'),
  }),
  chat: z.object({
    contact: z.string().describe('chat: who the student messages; interview: the thing being interviewed (never a real person); else ""'),
    messages: z.array(z.string()).describe('chat/interview: 5-6 messages alternating student, then tutor or thing…; else []'),
  }),
  quiz: z.object({
    question: z.string().describe('Recall or apply question answerable from the video, max 70 chars (examdrill/flashcards: "")'),
    options: z.array(z.string()).describe('Exactly 3 short options, max 28 chars each (or [])'),
    answerIndex: z.number().int().describe('0-based index of the correct option'),
    explanation: z.string().describe('Why it is right, one short sentence, max 100 chars'),
  }),
  takeaway: z.string().describe('The one sentence to remember, max 70 characters'),
});

export const EpisodesSchema = z.object({ episodes: z.array(LessonSchema) });

const clip = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
};
const list = (a, n, f) => (Array.isArray(a) ? a : []).map(f).filter(Boolean).slice(0, n);

function sanitizeVisual(v, beat) {
  const kind = VISUAL_KINDS.includes(v?.kind) ? v.kind : 'footage';
  const out = {
    kind,
    query: clip(v?.query || (kind === 'footage' || kind === 'photo' ? beat.visual || beat.keyTerm : ''), 50),
    title: clip(v?.title, 60),
    items: list(v?.items, kind === 'cycle' ? 6 : 5, (x) => clip(x, kind === 'definition' ? 150 : kind === 'cycle' ? 24 : 90)),
    value: Number.isFinite(Number(v?.value)) ? Number(v.value) : 0,
    unit: clip(v?.unit, 10),
    svg: kind === 'diagram' ? String(v?.svg || '').slice(0, 14000) : '',
  };
  if (kind === 'bars') out.items = out.items.filter((x) => /\|\s*-?\d/.test(x)); // "label|number" only
  const needsItems = { steps: 2, timeline: 2, compare: 2, definition: 1, equation: 1, cycle: 3, bars: 2 };
  if ((needsItems[kind] && out.items.length < needsItems[kind]) || (kind === 'diagram' && !/<svg[\s>]/i.test(out.svg)) || (kind === 'stat' && !out.value)) {
    return { ...out, kind: 'footage', query: clip(beat.visual || beat.keyTerm || out.title, 50), svg: '' };
  }
  return out;
}

const sanitizeBeats = (raw, max) => list(raw, max, (b) => (b && b.text ? { text: clip(b.text, 170), keyTerm: clip(b.keyTerm, 28), visual: sanitizeVisual(b.visual, b) } : null));

function sanitizeQuiz(q) {
  if (!q || !Array.isArray(q.options) || q.options.length < 3 || !q.question) return null;
  const options = q.options.slice(0, 3).map((o) => clip(o, 32));
  const answerIndex = Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < 3 ? q.answerIndex : 0;
  return { question: clip(q.question, 90), options, answerIndex, explanation: clip(q.explanation, 120) };
}

/**
 * Clamp lengths and shape so a slightly-off model answer still composes cleanly, and make sure
 * the format has what it needs (falling back to `explain` when it does not). Throws if unusable.
 */
export function sanitizeLesson(raw, topicId, meta = {}) {
  let format = FORMAT_IDS.includes(raw.format) ? raw.format : 'explain';
  const beats = sanitizeBeats(raw.beats, 4);
  const items = list(raw.items, 6, (it) => (it && it.text ? { title: clip(it.title || it.text, String(it.title || '').includes('|') ? 44 : 28), text: clip(it.text, 140), visual: clip(it.visual || it.title, 50), tier: ['S', 'A', 'B', 'C'].includes(String(it.tier || '').toUpperCase()) ? String(it.tier).toUpperCase() : '' } : null));
  const cards = list(raw.cards, 4, (c) => (c && c.q && c.a ? { q: clip(c.q, 80), a: clip(c.a, 70) } : null));
  const ex = raw.exam || {};
  // exam: a question with options and/or worked steps (examdrill needs both, guess needs options,
  // spotmistake needs steps with answerIndex pointing at the wrong one).
  const exOptions = Array.isArray(ex.options) ? ex.options.filter(Boolean).slice(0, 3).map((o) => clip(o, 32)) : [];
  const exSteps = list(ex.steps, 4, (s) => clip(s, 100));
  const exam = ex.question && (exOptions.length >= 3 || exSteps.length >= 2)
    ? { question: clip(ex.question, 130), options: exOptions.length >= 3 ? exOptions : [], answerIndex: Number.isInteger(ex.answerIndex) && ex.answerIndex >= 0 && ex.answerIndex < Math.max(3, exSteps.length) ? ex.answerIndex : 0,
        steps: exSteps, mistake: clip(ex.mistake, 100), tip: clip(ex.tip, 100) }
    : null;
  const ch = raw.chat || {};
  const chat = Array.isArray(ch.messages) && ch.messages.length >= 3 ? { contact: clip(ch.contact || 'Tutor', 24), messages: list(ch.messages, 6, (m) => clip(m, 150)) } : null;
  const quiz = sanitizeQuiz(raw.quiz);

  // Does the format have what it needs? Otherwise fall back to the explainer.
  const examFull = Boolean(exam && exam.options.length === 3 && exam.steps.length >= 2);
  const ok = {
    explain: beats.length >= 2, why: beats.length >= 2, story: beats.length >= 2, pov: beats.length >= 2, levels: beats.length >= 3,
    mythbust: Boolean(raw.myth && raw.fact) && beats.length >= 1, hottake: Boolean(raw.myth && raw.fact) && beats.length >= 1,
    rapid: items.length >= 3, countdown: items.length >= 3, speedrun: items.length >= 4, tierlist: items.length >= 3, thisorthat: items.length >= 3 && items.every((it) => it.title.includes('|')),
    flashcards: cards.length >= 3, examdrill: examFull, chat: Boolean(chat),
    spotmistake: Boolean(exam && exam.steps.length >= 2 && exam.answerIndex < exam.steps.length),
    guess: Boolean(exam && exam.options.length === 3) && beats.length >= 1,
    wyr: Boolean(quiz) && beats.length >= 2,
    onething: beats.length >= 1, analogy: beats.length >= 3, cheatsheet: items.length >= 3, mistakes: items.length >= 3,
    history: items.length >= 3 && items.every((it) => it.title.includes('|')),
    predict: Boolean(exam && exam.options.length === 3) && beats.length >= 1,
    challenge: Boolean(exam && exam.options.length === 3 && exam.steps.length >= 1),
    eli5: beats.length >= 2, whatif: beats.length >= 3, beforeafter: beats.length >= 2,
    wow: Boolean(raw.fact) && beats.length >= 1,
    mnemonic: Boolean(raw.fact) && items.length >= 3 && items.every((it) => it.title.includes('|')),
    realworld: items.length >= 3, truefalse: cards.length >= 3,
    detective: beats.length >= 3 && Boolean(raw.fact), teachback: beats.length >= 2 && Boolean(raw.fact),
    numbers: beats.length >= 3 && beats.filter((b) => b.visual.kind === 'stat' || b.visual.kind === 'bars').length >= 2,
    zoom: beats.length >= 3, interview: Boolean(chat), debate: beats.length >= 4 && Boolean(raw.fact), connect: beats.length >= 3, howto: items.length >= 3,
    redflags: items.length >= 3 && Boolean(raw.fact), personify: beats.length >= 3, starterpack: items.length >= 4,
    plottwist: Boolean(raw.myth && raw.fact) && beats.length >= 2, examiner: Boolean(raw.myth && raw.fact) && items.length >= 3,
    translate: Boolean(raw.myth && raw.fact) && beats.length >= 2,
  };
  if (!ok[format]) format = beats.length >= 2 ? 'explain' : items.length >= 3 ? 'rapid' : cards.length >= 3 ? 'flashcards' : examFull ? 'examdrill' : chat ? 'chat' : null;
  if (!format) throw new Error('Lesson has no usable content');
  if (['explain', 'why', 'story', 'pov', 'levels', 'tierlist', 'thisorthat', 'countdown', 'speedrun', 'wyr', 'onething', 'analogy', 'cheatsheet', 'mistakes', 'history', 'eli5', 'whatif', 'beforeafter', 'wow', 'mnemonic', 'realworld', 'detective', 'teachback', 'numbers', 'zoom', 'interview', 'debate', 'connect', 'howto', 'redflags', 'personify', 'starterpack', 'plottwist', 'examiner', 'translate'].includes(format) && !quiz) throw new Error('Lesson needs a quiz');

  return {
    topic: topicId,
    ...meta,
    format,
    subtopic: clip(raw.subtopic || beats[0]?.keyTerm || items[0]?.title || cards[0]?.q || 'Lesson', 40),
    title: clip(raw.title, 60),
    hook: clip(raw.hook, 90),
    hookTerm: clip(raw.hookTerm, 30),
    hookStyle: ['curiosity', 'challenge', 'number', 'question', 'pain', 'claim', 'story', 'secret'].includes(raw.hookStyle) ? raw.hookStyle : 'curiosity',
    ambient: clip(raw.ambient || beats.find((b) => b.visual.query)?.visual.query || items[0]?.visual || '', 50),
    beats, items, cards, exam, chat,
    myth: clip(raw.myth, 80), fact: clip(raw.fact, 90),
    quiz: ['examdrill', 'guess', 'predict', 'challenge'].includes(format) ? { question: exam.question, options: exam.options, answerIndex: exam.answerIndex, explanation: exam.tip }
      : format === 'spotmistake' ? { question: 'Which step is wrong?', options: exam.steps.slice(0, 3).map((_, i) => `Step ${i + 1}`), answerIndex: Math.min(2, exam.answerIndex), explanation: exam.mistake }
      : format === 'flashcards' ? null : quiz,
    takeaway: clip(raw.takeaway, 80),
  };
}
