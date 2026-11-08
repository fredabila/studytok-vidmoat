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

  // ---- Second wave: formats built on the hooks short video uses to keep people watching ----
  // (curiosity gaps, "wait for the last one", challenges you answer before the reveal, rankings
  // you want to argue with, first-person immersion, hot takes). The learning is the same; the
  // packaging is what keeps a tired student on the next swipe.

  levels: {
    name: '3 levels', tag: 'Kid → expert',
    blurb: 'The same idea explained three times: to a kid, to a student, to an expert. Viewers stay to see how far they can follow.',
    spec: 'beats: exactly 3, in order: LEVEL 1 (a kid: one everyday analogy, no jargon), LEVEL 2 (a student at their level: the proper terms), LEVEL 3 (an expert: the mechanism, edge case or formula). keyTerm = the idea at that level. hook: "Explain X to a 5-year-old, a student and a professor" style. quiz required. Leave items, myth, fact, cards, exam.question and chat empty.',
    weights: { default: 2, physics: 3, chemistry: 3, biology: 3, 'computer-science': 3, economics: 2, math: 2 },
    skin: {
      hook: { fontFamily: 'Montserrat', fontWeight: 900, fontSize: 150, uppercase: false, animIn: 'slide-up' },
      term: { fontFamily: 'Montserrat', fontWeight: 900 },
      captions: { preset: 'Karaoke', y: 430, maxWordsPerLine: 4 },
      filter: 'Warm', transition: 'push', music: ['lofi piano', 'chill beat'], voice: 'marin', cards: 'dark', scrim: 0.62,
    },
    scenes: (l) => [
      { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 3 },
      ...l.beats.slice(0, 3).map((b, i) => ({ id: `beat${i}`, kind: 'beat', index: i, spoken: sentence(b.text), captions: true, beat: b, kicker: ['LEVEL 1 · KID', 'LEVEL 2 · STUDENT', 'LEVEL 3 · EXPERT'][i] })),
      ...quizScenes(l, 'Which level are you?'), outro(l, 'All three'),
    ],
  },

  spotmistake: {
    name: 'Spot the mistake', tag: 'Spot it',
    blurb: 'A worked answer with one deliberate error. The video holds while the viewer hunts for it, then the wrong step turns red and gets fixed.',
    spec: 'exam.question: the problem (max 120 chars). exam.steps: 3-4 worked steps, exactly one of them wrong in a way students really make (a sign error, a skipped unit conversion, a wrong formula); exam.answerIndex = the 0-based index of the wrong step. exam.mistake: why that step is wrong (max 90 chars). exam.tip: the corrected step (max 90 chars). exam.options: leave []. hook: "Can you spot the mistake?" style. Leave beats, items, myth, fact, cards, chat and quiz empty.',
    weights: { default: 1, math: 4, physics: 3, chemistry: 3, economics: 2, 'computer-science': 3, law: 1 },
    skin: {
      hook: { fontFamily: 'Oswald', fontWeight: 700, fontSize: 150, uppercase: true, animIn: 'shake' },
      term: { fontFamily: 'Oswald', fontWeight: 700 },
      captions: { preset: 'Clean', y: 540, maxWordsPerLine: 4 },
      filter: 'cool-clean', transition: 'fade', music: ['tension', 'calm piano'], voice: 'cedar', cards: 'paper', scrim: 0.75,
    },
    scenes: (l) => {
      const e = l.exam;
      return [
        { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 2.6 },
        { id: 'question', kind: 'stepsAll', spoken: `Here is a worked answer to: ${sentence(e.question)} One step is wrong. Which one?`, pauseAfter: 5, minDur: 7, exam: e, steps: e.steps },
        { id: 'reveal', kind: 'stepsWrong', spoken: `Step ${e.answerIndex + 1}. ${sentence(e.mistake)}`, minDur: 3.5, exam: e, steps: e.steps, wrong: e.answerIndex, captions: false },
        { id: 'fix', kind: 'callout', spoken: `The fix: ${sentence(e.tip)}`, label: 'THE FIX', text: e.tip, color: '#2bbf6a', captions: false, minDur: 3 },
        outro(l, 'Watch for it'),
      ];
    },
  },

  tierlist: {
    name: 'Tier list', tag: 'Tier list',
    blurb: 'Four or five things ranked S to C with one line of reasoning each. Rankings invite disagreement, and disagreement keeps people watching.',
    spec: 'items: 4-5 things from the unit to rank (title max 28 chars, tier one of S, A, B, C, text = one spoken sentence justifying the rank, visual query). Rank them by a criterion stated in the hook (most exam-relevant, most misunderstood, most important…). Put the S-tier item LAST so the video builds to it. quiz required. Leave beats, myth, fact, cards, exam.question and chat empty.',
    weights: { default: 2, history: 3, biology: 2, economics: 3, business: 3, law: 2, health: 2, space: 2, psychology: 3 },
    skin: {
      hook: { fontFamily: 'Bungee', fontWeight: 400, fontSize: 140, uppercase: true, animIn: 'bounce', color: '#ffd93d' },
      term: { fontFamily: 'Bungee', fontWeight: 400 },
      captions: { preset: 'Comic Pop', y: 480, maxWordsPerLine: 3 },
      filter: 'Vivid', transition: 'slide', music: ['upbeat', 'funky'], voice: 'nova', cards: 'dark', scrim: 0.65,
    },
    scenes: (l) => [
      { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 2.6 },
      ...l.items.map((it, i) => ({ id: `tier${i}`, kind: 'tier', index: i, spoken: `${it.tier || 'B'} tier: ${it.title}. ${sentence(it.text)}`, captions: true, items: l.items.slice(0, i + 1), item: it })),
      ...quizScenes(l, 'Agree?'), outro(l, 'The list'),
    ],
  },

  thisorthat: {
    name: 'This or that', tag: 'This or that',
    blurb: 'Four quick pairs that students mix up, each a "which one?" the viewer answers in their head before the answer lands.',
    spec: 'items: exactly 4 pairs, title = "Left|Right" (two things students confuse, max 28 chars total), text = one spoken sentence that says which is which and the one difference that matters (8-18 words), visual query. hook: "Do you know the difference?" style. quiz: one more pair as the check. Leave beats, myth, fact, cards, exam.question and chat empty.',
    weights: { default: 2, biology: 3, chemistry: 3, language: 4, law: 3, health: 3, 'computer-science': 2, economics: 2 },
    skin: {
      hook: { fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 150, uppercase: false, animIn: 'zoom-blur' },
      term: { fontFamily: 'Archivo Black', fontWeight: 400 },
      captions: { preset: 'Dark Pill', y: 440, maxWordsPerLine: 4 },
      filter: 'Teal', transition: 'whip-pan', music: ['funky', 'chill beat'], voice: 'echo', cards: 'dark', scrim: 0.6,
    },
    scenes: (l) => [
      { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 2.6 },
      ...l.items.map((it, i) => ({ id: `pair${i}`, kind: 'beat', index: i, spoken: sentence(it.text), captions: true, kicker: 'THIS OR THAT',
        beat: { text: it.text, keyTerm: it.title.replace('|', ' vs '), visual: { kind: 'compare', title: it.title, items: [], query: it.visual, value: 0, unit: '', svg: '' } } })),
      ...quizScenes(l, 'Last one.'), outro(l, 'The difference'),
    ],
  },

  pov: {
    name: 'POV', tag: 'POV',
    blurb: 'First person: you are the electron, the red blood cell, the bill going through parliament. Immersion makes the process stick.',
    spec: 'hook: "POV: you are a …" (max 70 chars). beats: 3-4 steps of the process told in second person, present tense ("You squeeze through the capillary wall…"), keyTerm = where you are / what is happening (1-3 words), visual = footage or a diagram of that stage. quiz required. Leave items, myth, fact, cards, exam.question and chat empty.',
    weights: { default: 2, biology: 4, chemistry: 3, physics: 3, earth: 3, health: 3, 'computer-science': 2, law: 2, economics: 2 },
    skin: {
      hook: { fontFamily: 'Permanent Marker', fontWeight: 400, fontSize: 150, uppercase: false, animIn: 'write-on' },
      term: { fontFamily: 'Permanent Marker', fontWeight: 400 },
      captions: { preset: 'Handwritten', y: 440, maxWordsPerLine: 4 },
      filter: 'golden-hour', transition: 'zoom', music: ['ambient', 'cinematic'], voice: 'coral', cards: 'dark', scrim: 0.55,
    },
    scenes: (l) => [
      { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 3 },
      ...l.beats.map((b, i) => ({ id: `beat${i}`, kind: 'beat', index: i, spoken: sentence(b.text), captions: true, beat: b, kicker: i === 0 ? 'YOU ARE HERE' : `STEP ${i + 1}` })),
      ...quizScenes(l, 'Still with me?'), outro(l, 'And that is'),
    ],
  },

  hottake: {
    name: 'Hot take', tag: 'Hot take',
    blurb: 'An opinion about the topic that sounds wrong, two reasons it is defensible, and a check. People watch to argue.',
    spec: 'myth: the hot take itself, phrased as an opinion that makes students stop ("Mitosis is the most overrated topic in biology"; max 70 chars). fact: the real point behind it (max 80 chars). beats: exactly 2 reasons that teach the actual content (text, keyTerm, visual). quiz: a question on the content, not the opinion. Leave items, cards, exam.question and chat empty.',
    weights: { default: 1, history: 3, economics: 3, psychology: 3, business: 3, law: 2, language: 2 },
    skin: {
      hook: { fontFamily: 'Anton', fontWeight: 400, fontSize: 170, uppercase: true, animIn: 'word-slam', outline: '#000000', outlineWidth: 6 },
      term: { fontFamily: 'Anton', fontWeight: 400, uppercase: true },
      captions: { preset: 'Boxed Red', y: 430, maxWordsPerLine: 3 },
      filter: 'punch', transition: 'glitch', music: ['dramatic', 'energetic'], voice: 'ash', cards: 'dark', scrim: 0.7, stampSfx: true,
    },
    scenes: (l) => [
      { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 2.4 },
      { id: 'take', kind: 'stamp', spoken: `Hot take: ${sentence(l.myth)}`, label: 'HOT TAKE', text: l.myth, color: '#ff6b2c', minDur: 3.5 },
      ...l.beats.slice(0, 2).map((b, i) => ({ id: `beat${i}`, kind: 'beat', index: i, spoken: sentence(b.text), captions: true, beat: b, kicker: i === 0 ? 'HEAR ME OUT' : 'AND' })),
      { id: 'point', kind: 'stamp', spoken: `The real point: ${sentence(l.fact)}`, label: 'THE POINT', text: l.fact, color: '#2bbf6a', minDur: 3.5 },
      ...quizScenes(l, 'Now the check.'), outro(l, 'Agree or not'),
    ],
  },

  countdown: {
    name: 'Countdown', tag: 'Top 3',
    blurb: 'Counts down to number one with "wait for it" energy: the thing most likely on the exam, the most common mistake, the fact nobody expects.',
    spec: 'items: exactly 3 ranked things, listed from number 3 down to number 1 (the best, most surprising or most examined one LAST). title max 28 chars, text = one spoken sentence of 10-18 words with a reason, visual query. hook: "The 3 things that will be on your exam" style. quiz required. Leave beats, myth, fact, cards, exam.question and chat empty.',
    weights: { default: 2, math: 3, physics: 2, chemistry: 2, biology: 2, history: 3, economics: 2, health: 3, space: 3 },
    skin: {
      hook: { fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 176, uppercase: true, animIn: 'slide-up' },
      term: { fontFamily: 'Bebas Neue', fontWeight: 400 },
      captions: { preset: 'Hormozi', y: 440, maxWordsPerLine: 3 },
      filter: 'Blockbuster', transition: 'zoom-blur', music: ['epic', 'energetic'], voice: 'onyx', cards: 'dark', scrim: 0.6, countdown: true,
    },
    scenes: (l) => [
      { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 2.6 },
      ...l.items.slice(0, 3).map((it, i) => ({ id: `item${i}`, kind: 'item', index: i, total: 3, number: 3 - i, spoken: `Number ${3 - i}: ${it.title}. ${sentence(it.text)}`, captions: true, item: it })),
      ...quizScenes(l, 'Did you get it?'), outro(l, 'Number one'),
    ],
  },

  speedrun: {
    name: 'Speedrun', tag: 'Speedrun',
    blurb: 'The whole unit in 30 seconds: six facts at full pace with a running timer. For revision night.',
    spec: 'items: exactly 6 facts that together cover the unit, in a logical order (title max 24 chars, text = one spoken sentence of at most 12 words, visual query). hook: "<Unit> in 30 seconds. Go." style. quiz required. Leave beats, myth, fact, cards, exam.question and chat empty.',
    weights: { default: 2, biology: 3, chemistry: 3, history: 3, law: 3, health: 2, language: 2 },
    skin: {
      hook: { fontFamily: 'Bungee', fontWeight: 400, fontSize: 150, uppercase: true, animIn: 'bounce', color: '#ffd93d' },
      term: { fontFamily: 'Bungee', fontWeight: 400 },
      captions: { preset: 'Comic Pop', y: 420, maxWordsPerLine: 3 },
      filter: 'Vivid', transition: 'whip-pan', music: ['energetic', 'upbeat'], voice: 'nova', cards: 'dark', scrim: 0.55, countdown: true,
    },
    scenes: (l) => [
      { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 2.2 },
      ...l.items.slice(0, 6).map((it, i) => ({ id: `item${i}`, kind: 'item', index: i, total: Math.min(6, l.items.length), spoken: sentence(it.text), captions: true, item: it, minDur: 2.4 })),
      { id: 'recap', kind: 'recap', spoken: '', items: l.items.slice(0, 6).map((it) => it.title), minDur: 3.2, title: 'Done. 30 seconds.' },
      ...quizScenes(l, 'Prove it.'), outro(l, 'Speedrun'),
    ],
  },

  guess: {
    name: 'Guess first', tag: 'Guess first',
    blurb: 'The question comes first, before any teaching. The viewer commits to an answer, then the explanation lands on a mind that wants to know.',
    spec: 'exam.question: a surprising, concrete question about the unit with exactly 3 exam.options (max 28 chars) and exam.answerIndex; the wrong options must be what most people guess. beats: exactly 2 that explain the answer (text, keyTerm, visual). exam.steps: []. exam.mistake: "". exam.tip: the one-line takeaway. hook: a one-line setup ("Most students get this wrong"). Leave items, myth, fact, cards, chat and quiz empty.',
    weights: { default: 3, physics: 3, biology: 3, earth: 3, space: 3, health: 3, psychology: 3, history: 2, economics: 3 },
    skin: {
      hook: { fontFamily: 'Montserrat', fontWeight: 900, fontSize: 156, uppercase: false, animIn: 'pop' },
      term: { fontFamily: 'Montserrat', fontWeight: 900 },
      captions: { preset: 'Karaoke', y: 430, maxWordsPerLine: 4 },
      filter: 'Cinematic', transition: 'dissolve', music: ['suspense', 'ambient'], voice: 'sage', cards: 'dark', scrim: 0.62,
    },
    scenes: (l) => {
      const e = l.exam;
      return [
        { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 2.4 },
        { id: 'question', kind: 'question', spoken: `${question(e.question)} ${e.options.map((o, i) => `${ABC[i]}, ${o}`).join('. ')}. Lock in your answer.`, pauseAfter: 4, minDur: 6, exam: e, label: 'Guess first' },
        { id: 'answer', kind: 'reveal', spoken: `It's ${ABC[e.answerIndex]}: ${sentence(e.options[e.answerIndex])}`, minDur: 2.5, captions: false, exam: e },
        ...l.beats.slice(0, 2).map((b, i) => ({ id: `beat${i}`, kind: 'beat', index: i, spoken: sentence(b.text), captions: true, beat: b, kicker: i === 0 ? 'BECAUSE' : 'AND' })),
        { id: 'outro', kind: 'outro', spoken: sentence(e.tip || l.takeaway), minDur: 3, label: 'Remember', text: e.tip || l.takeaway },
      ];
    },
  },

  wyr: {
    name: 'Would you rather', tag: 'Would you rather',
    blurb: 'A dilemma from the unit with two defensible sides; the viewer picks, then learns what actually decides it.',
    spec: 'quiz.question: a "Would you rather…" dilemma grounded in the unit (max 70 chars) with quiz.options = exactly 3 (the two sides, max 28 chars each, plus "Depends on the case"); quiz.answerIndex = the option the content supports; quiz.explanation = the deciding factor. beats: exactly 2 that teach what decides it (text, keyTerm, visual). hook: the dilemma in one line. Leave items, myth, fact, cards, exam.question and chat empty.',
    weights: { default: 2, economics: 4, business: 4, health: 3, law: 4, psychology: 3, earth: 2, 'computer-science': 2 },
    skin: {
      hook: { fontFamily: 'DM Serif Display', fontWeight: 400, fontSize: 156, uppercase: false, animIn: 'fade-in', animInDuration: 0.8 },
      term: { fontFamily: 'DM Serif Display', fontWeight: 400 },
      captions: { preset: 'Clean Subtitle', y: 460, maxWordsPerLine: 5 },
      filter: 'Matte', transition: 'push', music: ['chill', 'lofi'], voice: 'fable', cards: 'paper', scrim: 0.6,
    },
    scenes: (l) => [
      { id: 'hook', kind: 'hook', spoken: sentence(l.hook), minDur: 3 },
      ...quizScenes(l, 'Would you rather?'),
      ...l.beats.slice(0, 2).map((b, i) => ({ id: `beat${i}`, kind: 'beat', index: i, spoken: sentence(b.text), captions: true, beat: b, kicker: i === 0 ? 'WHAT DECIDES IT' : 'AND' })),
      outro(l, 'So'),
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
export function pickFormats(topic, count = 3, { recent = [], rand = Math.random, allowed = FORMAT_IDS, performance = {} } = {}) {
  const pool = allowed.map((id) => {
    const w = FORMATS[id].weights;
    const base = (w[topic] ?? w.default ?? 1) * (performance[id] ?? 1);
    const age = recent.lastIndexOf(id); // -1 = not recent
    const penalty = age === -1 ? 1 : age === recent.length - 1 ? 0.15 : age >= recent.length - 3 ? 0.4 : 0.7;
    return { id, weight: base * penalty * (0.6 + rand() * 0.8) };
  }).sort((a, b) => b.weight - a.weight);
  return pool.slice(0, count).map((p) => p.id);
}

/** Formats that can run without Claude (the offline bank only has explainers). */
export const OFFLINE_FORMATS = ['explain'];
