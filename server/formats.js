// Video formats. Each format is a different kind of video: its own structure (the scenes),
// pacing, typography, captions, colour grade, transitions, music mood and narrator voice.
// A lesson carries `format`; `scenesFor()` turns it into the scene list the composer renders.
//
// Scene: { id, kind, spoken, captions?, pauseAfter?, minDur?, ...data }
//   spoken      what the narrator says in this scene ('' = silent scene)
//   captions    show the spoken words as captions
//   pauseAfter  seconds of silence inserted after the scene (the narration is cut there)
//   minDur      duration of a silent scene, or the minimum for a spoken one

const sentence = (s) => { s = String(s || '').trim(); return s && !/[.!?…]$/.test(s) ? `${s}.` : s; };
const question = (s) => { s = String(s || '').trim(); return s && !/[?]$/.test(s) ? `${s.replace(/[.!…]+$/, '')}?` : s; };
const ABC = 'ABC';

const quizScenes = (lesson, lead = 'Quick check.') => {
  const q = lesson.quiz;
  if (!q) return [];
  return [
    // The app holds the video at the end of the question until the viewer answers (or skips), so
    // the answer is never spoken before they have had the chance; pauseAfter is the silent-video think time.
    { id: 'quizQ', kind: 'quiz', spoken: `${lead} ${question(q.question)} ${q.options.map((o, i) => `${ABC[i]}, ${o}`).join('. ')}.`, pauseAfter: 4, minDur: 5 },
    { id: 'reveal', kind: 'reveal', spoken: `It's ${ABC[q.answerIndex]}: ${sentence(q.options[q.answerIndex])} ${sentence(q.explanation)}`.trim(), short: `It's ${ABC[q.answerIndex]}: ${sentence(q.options[q.answerIndex])}`, minDur: 3, captions: false },
  ];
};
const outro = (lesson, label = 'Remember') => ({ id: 'outro', kind: 'outro', spoken: sentence(lesson.takeaway), minDur: 3, label });

export const FORMATS = {
  explain: {
    name: 'Explainer', tag: 'Explainer',
    blurb: 'A hook, 3-4 beats that each teach one thing with a diagram or visual, a quick check, a takeaway.',
    spec: 'beats: 3-4 (text = one spoken sentence, keyTerm, visual). quiz required. Leave myth, fact, items, cards, exam.question and chat empty.',
    weights: { default: 3 },
    skin: {
      hook: { fontFamily: 'Montserrat', fontWeight: 900, fontSize: 168, uppercase: false, animIn: 'word-pop' },
      term: { fontFamily: 'Montserrat', fontWeight: 900 },
      captions: { preset: 'Karaoke', y: 430, maxWordsPerLine: 4 },
      filter: null, transition: 'dissolve', music: ['lofi piano', 'calm piano'], voice: 'marin', cards: 'dark', scrim: 0.62,
    },
    scenes: (l) => [
      { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 3.2 },
      ...l.beats.map((b, i) => ({ id: `beat${i}`, kind: 'beat', index: i, spoken: sentence(b.text), captions: true, beat: b })),
      ...quizScenes(l), outro(l),
    ],
  },

  mythbust: {
    name: 'Myth or fact', tag: 'Myth vs fact',
    blurb: 'A common belief stamped MYTH, the truth stamped FACT, two reasons why, a myth-or-fact check.',
    spec: 'myth: the common wrong belief (max 70 chars). fact: the correct statement (max 80 chars). hook: a one-line teaser. beats: exactly 2 reasons the fact is true (text, keyTerm, visual). quiz: a different myth-or-fact statement with options ["Myth","Fact","Depends"] and the explanation. Leave items, cards, exam.question and chat empty.',
    weights: { default: 2, biology: 3, health: 3, psychology: 3, physics: 2, history: 2 },
    skin: {
      hook: { fontFamily: 'Anton', fontWeight: 400, fontSize: 176, uppercase: true, animIn: 'word-slam', outline: '#000000', outlineWidth: 6 },
      term: { fontFamily: 'Anton', fontWeight: 400, uppercase: true },
      captions: { preset: 'Boxed Red', y: 430, maxWordsPerLine: 3 },
      filter: 'Moody', transition: 'glitch', music: ['dramatic', 'tension', 'suspense'], voice: 'ash', cards: 'dark', scrim: 0.7, stampSfx: true,
    },
    scenes: (l) => [
      { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 2.6 },
      { id: 'myth', kind: 'stamp', spoken: `Everyone says: ${sentence(l.myth)}`, label: 'MYTH', text: l.myth, color: '#e5484d', minDur: 3.5 },
      { id: 'fact', kind: 'stamp', spoken: `Actually, ${sentence(l.fact)}`, label: 'FACT', text: l.fact, color: '#2bbf6a', minDur: 3.5 },
      ...l.beats.slice(0, 2).map((b, i) => ({ id: `beat${i}`, kind: 'beat', index: i, spoken: sentence(b.text), captions: true, beat: b, kicker: i === 0 ? 'WHY' : 'AND' })),
      ...quizScenes(l, 'Your turn. Myth or fact?'), outro(l, 'The truth'),
    ],
  },

  rapid: {
    name: 'Rapid fire', tag: '5 things',
    blurb: 'N things you need to know, one punchy line each, big numbers, fast cuts, a recap, a quick check.',
    spec: 'items: 4-5 punchy facts in order (title max 28 chars, text = one spoken sentence of 8-16 words, visual query). hook: "N things about X…" style. quiz required. Leave beats, myth, fact, cards, exam.question and chat empty.',
    weights: { default: 2, 'computer-science': 3, economics: 2, earth: 3, space: 3, business: 3 },
    skin: {
      hook: { fontFamily: 'Bungee', fontWeight: 400, fontSize: 150, uppercase: true, animIn: 'bounce', color: '#ffd93d' },
      term: { fontFamily: 'Bungee', fontWeight: 400 },
      captions: { preset: 'Comic Pop', y: 420, maxWordsPerLine: 3 },
      filter: 'Vivid', transition: 'whip-pan', music: ['upbeat', 'funky', 'energetic'], voice: 'nova', cards: 'dark', scrim: 0.55, countdown: true,
    },
    scenes: (l) => [
      { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 2.6 },
      ...l.items.map((it, i) => ({ id: `item${i}`, kind: 'item', index: i, total: l.items.length, spoken: sentence(it.text), captions: true, item: it })),
      { id: 'recap', kind: 'recap', spoken: '', items: l.items.map((it) => it.title), minDur: 3.2 },
      ...quizScenes(l, 'Did you catch it?'), outro(l, 'Takeaway'),
    ],
  },

  examdrill: {
    name: 'Exam drill', tag: 'Exam drill',
    blurb: 'A real exam-style question, a pause to try it, the worked solution step by step, the common mistake, a marking tip.',
    spec: 'exam.question: an exam-style question (max 120 chars) with exam.options (exactly 3, max 28 chars) and exam.answerIndex; exam.steps: 3-4 solution steps (each one spoken sentence, max 90 chars); exam.mistake: the common wrong move (max 90 chars); exam.tip: what earns the marks (max 90 chars). hook: a one-line framing ("This one costs students marks every year"). Leave beats, items, myth, fact, cards, chat and quiz empty.',
    weights: { default: 1, math: 4, physics: 4, chemistry: 3, economics: 2, 'computer-science': 2, law: 2, health: 2 },
    skin: {
      hook: { fontFamily: 'Oswald', fontWeight: 700, fontSize: 150, uppercase: true, animIn: 'slide-up' },
      term: { fontFamily: 'Oswald', fontWeight: 700 },
      captions: { preset: 'Clean', y: 540, maxWordsPerLine: 4 },
      filter: 'cool-clean', transition: 'fade', music: ['calm piano', 'soft piano'], voice: 'cedar', cards: 'paper', scrim: 0.75,
    },
    scenes: (l) => {
      const e = l.exam;
      return [
        { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 2.6 },
        { id: 'question', kind: 'question', spoken: `Try this. ${question(e.question)} ${e.options.map((o, i) => `${ABC[i]}, ${o}`).join('. ')}.`, pauseAfter: 4, minDur: 6, exam: e },
        ...e.steps.map((s, i) => ({ id: `step${i}`, kind: 'steps', index: i, spoken: sentence(s), captions: true, steps: e.steps, answer: i === 0 ? e : null })),
        { id: 'mistake', kind: 'callout', spoken: `Common mistake: ${sentence(e.mistake)}`, label: 'COMMON MISTAKE', text: e.mistake, color: '#e5484d', captions: false, minDur: 3 },
        { id: 'outro', kind: 'outro', spoken: `Marks tip: ${sentence(e.tip)}`, minDur: 3, label: 'Marks tip', text: e.tip },
      ];
    },
  },

  story: {
    name: 'Story', tag: 'Story',
    blurb: 'A narrative told in chapters with datelines and real photos: what happened, the turning point, why it still matters.',
    spec: 'beats: 3-4 chapters in time order; each keyTerm is a short dateline or chapter label (e.g. "1455" or "The turning point"), text = one spoken narrative sentence, visual = photo or footage of the real thing (or a timeline for the last chapter). hook: a dramatic opening line. quiz required. Leave items, myth, fact, cards, exam.question and chat empty.',
    weights: { default: 1, history: 5, space: 2, biology: 2, earth: 2, economics: 2, law: 2, language: 3 },
    skin: {
      hook: { fontFamily: 'DM Serif Display', fontWeight: 400, fontSize: 160, uppercase: false, animIn: 'fade-in', animInDuration: 1 },
      term: { fontFamily: 'Cinzel', fontWeight: 700, uppercase: true, letterSpacing: 6 },
      captions: { preset: 'Clean Subtitle', y: 500, maxWordsLine: 6, maxWordsPerLine: 6 },
      filter: 'Cinematic', transition: 'dissolve', music: ['cinematic', 'orchestral', 'epic'], voice: 'sage', cards: 'dark', scrim: 0.45, letterbox: true,
    },
    scenes: (l) => [
      { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 3.4 },
      ...l.beats.map((b, i) => ({ id: `beat${i}`, kind: 'beat', index: i, spoken: sentence(b.text), captions: true, beat: b, chapter: i + 1 })),
      ...quizScenes(l, 'One question.'), outro(l, 'Why it matters'),
    ],
  },

  flashcards: {
    name: 'Flashcards', tag: 'Flash drill',
    blurb: 'Four rapid question-and-answer cards with a beat to answer each: revision, not explanation.',
    spec: 'cards: exactly 4 { q: a short recall question (max 70 chars), a: the answer (max 60 chars) } on this unit. hook: "Rapid revision: say it before it appears" style. takeaway: one line. Leave beats, items, myth, fact, exam.question, chat and quiz empty.',
    weights: { default: 2, biology: 3, chemistry: 3, law: 3, health: 3, language: 3 },
    skin: {
      hook: { fontFamily: 'Permanent Marker', fontWeight: 400, fontSize: 150, uppercase: false, animIn: 'write-on' },
      term: { fontFamily: 'Permanent Marker', fontWeight: 400 },
      captions: { preset: 'Handwritten', y: 480, maxWordsPerLine: 5 },
      filter: 'Fade', transition: 'slide', music: ['lofi', 'lofi beat'], voice: 'marin', cards: 'paper', scrim: 0.7, countdown: true,
    },
    scenes: (l) => [
      { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 2.6 },
      ...l.cards.flatMap((c, i) => [
        { id: `q${i}`, kind: 'flashQ', index: i, total: l.cards.length, spoken: question(c.q), pauseAfter: 2.5, minDur: 3.2, card: c },
        { id: `a${i}`, kind: 'flashA', index: i, total: l.cards.length, spoken: sentence(c.a), minDur: 2.2, card: c },
      ]),
      { id: 'outro', kind: 'outro', spoken: `How many did you get? ${sentence(l.takeaway)}`, minDur: 3, label: 'Score yourself' },
    ],
  },

  why: {
    name: 'Why?', tag: 'Why?',
    blurb: 'One big "why" question answered as a chain of "because" steps that each lead to the next, ending in "so".',
    spec: 'hook: the "Why does/why is…" question itself (max 70 chars). beats: 3 "because" steps that chain (each text starts the causal link, keyTerm = the 1-3 word idea, visual). takeaway: the "So…" conclusion. quiz required. Leave items, myth, fact, cards, exam.question and chat empty.',
    weights: { default: 2, physics: 3, chemistry: 3, earth: 3, biology: 2, economics: 3, psychology: 3 },
    skin: {
      hook: { fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 156, uppercase: false, animIn: 'zoom-blur' },
      term: { fontFamily: 'Archivo Black', fontWeight: 400 },
      captions: { preset: 'Dark Pill', y: 440, maxWordsPerLine: 4 },
      filter: 'Teal', transition: 'zoom', music: ['ambient', 'chill'], voice: 'echo', cards: 'dark', scrim: 0.6, chain: true,
    },
    scenes: (l) => [
      { id: 'hook', kind: 'hook', spoken: question(l.hook), minDur: 3 },
      ...l.beats.slice(0, 3).map((b, i) => ({ id: `beat${i}`, kind: 'beat', index: i, spoken: sentence(b.text), captions: true, beat: b, kicker: i === 0 ? 'BECAUSE' : 'WHICH MEANS' })),
      ...quizScenes(l, 'Got it?'), outro(l, 'So…'),
    ],
  },

  chat: {
    name: 'Chat', tag: 'DM thread',
    blurb: 'A student messages a tutor; the answer unfolds bubble by bubble, like a group chat.',
    spec: 'chat.contact: who the student is texting (e.g. "Tutor Ama"). chat.messages: 5-6 messages alternating student (first) and tutor, each 6-22 words, conversational, the tutor explaining the idea; the last message is the student summing it up. hook: the student\'s opening problem in one line. quiz required. Leave beats, items, myth, fact, cards and exam.question empty.',
    weights: { default: 2, 'computer-science': 3, business: 3, psychology: 2, language: 3, math: 2 },
    skin: {
      hook: { fontFamily: 'Inter', fontWeight: 800, fontSize: 140, uppercase: false, animIn: 'slide-up' },
      term: { fontFamily: 'Inter', fontWeight: 800 },
      captions: { preset: 'Minimal', y: 520, maxWordsPerLine: 6 },
      filter: 'Matte', transition: 'push', music: ['lofi', 'chill beat'], voice: 'coral', cards: 'dark', scrim: 0.7,
    },
    scenes: (l) => [
      { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 2.6 },
      ...l.chat.messages.map((m, i) => ({ id: `msg${i}`, kind: 'chat', index: i, spoken: sentence(m), contact: l.chat.contact, messages: l.chat.messages.slice(0, i + 1), captions: false, minDur: 2.4 })),
      ...quizScenes(l, 'Quick check.'), outro(l, 'In one line'),
    ],
  },
};

export const FORMAT_IDS = Object.keys(FORMATS);
export const format = (id) => FORMATS[id] || FORMATS.explain;
export const scenesFor = (lesson) => format(lesson.format).scenes(lesson);

/**
 * Picks `count` distinct formats for a unit's next batch of episodes: weighted by topic, with
 * the formats a student saw most recently (or the unit already has) pushed down.
 */
export function pickFormats(topic, count = 3, { recent = [], rand = Math.random, allowed = FORMAT_IDS } = {}) {
  const pool = allowed.map((id) => {
    const w = FORMATS[id].weights;
    const base = w[topic] ?? w.default ?? 1;
    const age = recent.lastIndexOf(id); // -1 = not recent
    const penalty = age === -1 ? 1 : age === recent.length - 1 ? 0.15 : age >= recent.length - 3 ? 0.4 : 0.7;
    return { id, weight: base * penalty * (0.6 + rand() * 0.8) };
  }).sort((a, b) => b.weight - a.weight);
  return pool.slice(0, count).map((p) => p.id);
}

/** Formats that can run without Claude (the offline bank only has explainers). */
export const OFFLINE_FORMATS = ['explain'];
