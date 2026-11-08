import * as z from 'zod/v4';

// What a StudyTok video is made of. Kept short on purpose: every field becomes on-screen text
// or narration on a phone, and a whole video should land in 25 to 45 seconds.

export const VISUAL_KINDS = ['diagram', 'stat', 'steps', 'compare', 'timeline', 'definition', 'equation', 'photo', 'footage'];
const TEACHING = new Set(['diagram', 'stat', 'steps', 'compare', 'timeline', 'definition', 'equation']);
export const isTeachingVisual = (kind) => TEACHING.has(kind);

const Visual = z.object({
  kind: z.enum(VISUAL_KINDS).describe('How this beat is shown. Prefer teaching visuals; photo/footage only when seeing the real thing teaches something.'),
  query: z.string().describe('photo/footage: stock search query (photo: a specific named thing, e.g. "Pantheon Rome"); else ""'),
  title: z.string().describe('Label/heading for the visual (stat label, steps heading, compare "Left|Right", definition term, equation meaning); else ""'),
  items: z.array(z.string()).describe('steps: 3-5 short steps; timeline: "1450|Event"; compare: rows "left|right"; definition: [definition]; equation: 1-3 lines; else []'),
  value: z.number().describe('stat: the number (no separators); else 0'),
  unit: z.string().describe('stat: suffix such as "%", " km/s", "x"; else ""'),
  svg: z.string().describe('diagram only: complete inline <svg viewBox="0 0 800 800">…</svg>; else ""'),
});

export const LessonSchema = z.object({
  subtopic: z.string().describe('Narrow subject of this episode, 1-4 words'),
  title: z.string().describe('Feed title, max 60 characters'),
  hook: z.string().describe('Opening line, spoken and shown: a surprising true fact or a sharp question, max 80 characters'),
  hookTerm: z.string().describe('1-3 words copied exactly from the hook to highlight'),
  ambient: z.string().describe('Background footage search query for the whole video, 1-3 concrete visual nouns'),
  beats: z
    .array(z.object({
      text: z.string().describe('One spoken sentence, 10-24 words, plain language; also shown as captions'),
      keyTerm: z.string().describe('The concept this beat teaches, 1-3 words, shown big'),
      visual: Visual,
    }))
    .describe('3 or 4 beats that build on each other'),
  quiz: z.object({
    question: z.string().describe('Recall or apply question answerable from the beats, max 70 characters'),
    options: z.array(z.string()).describe('Exactly 3 short options, max 28 characters each'),
    answerIndex: z.number().int().describe('0-based index of the correct option'),
    explanation: z.string().describe('Why it is right, one short sentence, max 100 characters'),
  }),
  takeaway: z.string().describe('The one sentence to remember, max 70 characters'),
});

export const EpisodesSchema = z.object({ episodes: z.array(LessonSchema) });

const clip = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
};

function sanitizeVisual(v, beat) {
  const kind = VISUAL_KINDS.includes(v?.kind) ? v.kind : 'footage';
  const out = {
    kind,
    query: clip(v?.query || (kind === 'footage' || kind === 'photo' ? beat.visual || beat.keyTerm : ''), 50),
    title: clip(v?.title, 60),
    items: (Array.isArray(v?.items) ? v.items : []).map((x) => clip(x, kind === 'definition' ? 150 : 90)).filter(Boolean).slice(0, 5),
    value: Number.isFinite(Number(v?.value)) ? Number(v.value) : 0,
    unit: clip(v?.unit, 10),
    svg: kind === 'diagram' ? String(v?.svg || '').slice(0, 14000) : '',
  };
  // Downgrade teaching visuals that are missing what they need.
  const needsItems = { steps: 2, timeline: 2, compare: 2, definition: 1, equation: 1 };
  if ((needsItems[kind] && out.items.length < needsItems[kind]) || (kind === 'diagram' && !/<svg[\s>]/i.test(out.svg)) || (kind === 'stat' && !out.value)) {
    return { ...out, kind: 'footage', query: clip(beat.visual || beat.keyTerm || out.title, 50), svg: '' };
  }
  return out;
}

/** Clamp lengths and shape so a slightly-off model answer still composes cleanly. Throws if unusable. */
export function sanitizeLesson(raw, topicId, meta = {}) {
  const beats = (raw.beats || [])
    .filter((b) => b && b.text)
    .slice(0, 4)
    .map((b) => ({ text: clip(b.text, 170), keyTerm: clip(b.keyTerm, 28), visual: sanitizeVisual(b.visual, b) }));
  if (beats.length < 2) throw new Error('Lesson needs at least two beats');
  let quiz = raw.quiz && Array.isArray(raw.quiz.options) && raw.quiz.options.length >= 3 ? raw.quiz : null;
  if (quiz) {
    const options = quiz.options.slice(0, 3).map((o) => clip(o, 32));
    const answerIndex = Number.isInteger(quiz.answerIndex) && quiz.answerIndex >= 0 && quiz.answerIndex < 3 ? quiz.answerIndex : 0;
    quiz = { question: clip(quiz.question, 90), options, answerIndex, explanation: clip(quiz.explanation, 120) };
  }
  return {
    topic: topicId,
    ...meta,
    subtopic: clip(raw.subtopic || beats[0].keyTerm, 40),
    title: clip(raw.title, 60),
    hook: clip(raw.hook, 90),
    hookTerm: clip(raw.hookTerm, 30),
    ambient: clip(raw.ambient || beats.find((b) => b.visual.query)?.visual.query || '', 50),
    beats,
    quiz,
    takeaway: clip(raw.takeaway, 80),
  };
}
