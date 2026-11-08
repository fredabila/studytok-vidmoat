import * as z from 'zod/v4';

// What a StudyTok video is made of. Kept short on purpose: every field becomes on-screen text
// on a phone, and the whole video should land in 20 to 30 seconds.
export const LessonSchema = z.object({
  subtopic: z.string().describe('Narrow subject inside the topic, 1-4 words, e.g. "Bone marrow"'),
  title: z.string().describe('Feed title, max 60 characters'),
  hook: z.string().describe('Opening line that makes a scroller stop: a surprising true fact or question, max 70 characters'),
  hookTerm: z.string().describe('1-3 words copied exactly from the hook to highlight (a number or key noun)'),
  beats: z
    .array(
      z.object({
        text: z.string().describe('One clear explanatory sentence, 10-20 words, plain language'),
        keyTerm: z.string().describe('The concept this beat teaches, 1-3 words, shown big on screen'),
        visual: z.string().describe('Stock footage search query, 1-3 concrete visual nouns, e.g. "red blood cells"'),
      }),
    )
    .describe('2 to 4 beats that build on each other'),
  quiz: z.object({
    question: z.string().describe('A recall question answerable from the beats, max 60 characters'),
    options: z.array(z.string()).describe('Exactly 3 short answer options, max 28 characters each'),
    answerIndex: z.number().int().describe('0-based index of the correct option'),
  }),
  takeaway: z.string().describe('The one sentence to remember, max 60 characters'),
});

const clip = (s, n) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
};

/** Clamp lengths and shape so a slightly-off model answer still composes cleanly. Throws if unusable. */
export function sanitizeLesson(raw, topicId) {
  const beats = (raw.beats || [])
    .filter((b) => b && b.text)
    .slice(0, 4)
    .map((b) => ({ text: clip(b.text, 140), keyTerm: clip(b.keyTerm, 28), visual: clip(b.visual || b.keyTerm, 40) }));
  if (beats.length < 2) throw new Error('Lesson needs at least two beats');
  let quiz = raw.quiz && Array.isArray(raw.quiz.options) && raw.quiz.options.length >= 3 ? raw.quiz : null;
  if (quiz) {
    const options = quiz.options.slice(0, 3).map((o) => clip(o, 32));
    const answerIndex = Number.isInteger(quiz.answerIndex) && quiz.answerIndex >= 0 && quiz.answerIndex < 3 ? quiz.answerIndex : 0;
    quiz = { question: clip(quiz.question, 80), options, answerIndex };
  }
  return {
    topic: topicId,
    subtopic: clip(raw.subtopic || beats[0].keyTerm, 40),
    title: clip(raw.title, 60),
    hook: clip(raw.hook, 90),
    hookTerm: clip(raw.hookTerm, 30),
    beats,
    quiz,
    takeaway: clip(raw.takeaway, 80),
  };
}
