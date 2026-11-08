// Breathers: when the events say a student is about to drop off (two early leaves in a row, a
// run of wrong answers, a long session with nothing light in it), the feed slips in one short,
// fun, still-accurate video from next door to their subject, then goes back to the syllabus.
// Never far from the course (an animal superpower for a biology student, a famous bug for a
// computer-science one), never more than one, never two within a few videos, and never again
// for a student who keeps telling the feed "less" about them.
//
// A breather is an open unit (`fun:<topic>:<n>`) written in one of BREATHER_FORMATS with a
// "this is a breather" note to the writer (lessons/claude.js). Its videos are shared like any
// other unit's and tracked by the same events, but they never count towards mastery or level-ups.

import { TOPIC_BY_ID } from '../curriculum/topics.js';

export const BREATHERS = {
  biology: ['Animals with real superpowers', 'The strangest things your body does every day', 'Creatures that technically never die'],
  physics: ['Everyday physics that looks like magic', 'The weirdest sounds and lights in nature', 'Record-breaking speeds in the universe'],
  space: ['The strangest places in the solar system', 'What astronauts actually do all day', 'Space facts that sound made up'],
  history: ['History’s most ridiculous true stories', 'Everyday things with a wild origin', 'Jobs that no longer exist'],
  math: ['Numbers that behave strangely', 'Puzzles mathematicians love', 'Maths hiding in games and music'],
  chemistry: ['Kitchen chemistry that looks like magic', 'The strangest substances on Earth', 'Colours and where they come from'],
  psychology: ['Tricks your brain plays on you', 'Why we laugh, yawn and blush', 'Famous experiments with surprising results'],
  economics: ['The strangest things ever used as money', 'Why prices do odd things', 'Businesses that started by accident'],
  'computer-science': ['Famous bugs that broke the world', 'How games trick your eyes', 'Inventions that came from a hack'],
  earth: ['Record-breaking weather and places', 'Volcanoes, caves and other wonders', 'Animals that predict the weather'],
  health: ['The body’s strangest defences', 'Medical discoveries made by accident', 'Myths about sleep, food and fitness'],
  law: ['The strangest laws still on the books', 'Court cases that changed everyday life', 'How a bill really becomes law'],
  business: ['Products that failed spectacularly', 'Brands with wild origin stories', 'The psychology of a good deal'],
  language: ['Words with unexpected origins', 'Untranslatable words from around the world', 'How languages borrow from each other'],
  general: ['Things that sound fake but are true', 'Everyday objects with a surprising past', 'Questions kids ask that stump adults'],
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** The breather units for a topic (ids are stable, so videos are shared). */
export function breatherUnits(topicId) {
  const t = TOPIC_BY_ID[topicId] ? topicId : 'general';
  return (BREATHERS[t] || BREATHERS.general).map((title, i) => ({
    id: `fun:${t}:${i}`, title, topic: t, open: true, fun: true,
    summary: `A light, fun, surprising detour next door to ${TOPIC_BY_ID[t].label.toLowerCase()}: true facts and stories, no exam framing.`,
  }));
}

/** Resolves a `fun:<topic>:<n>` id. */
export function breatherUnit(id) {
  const m = /^fun:([a-z-]+):(\d+)$/.exec(id || '');
  if (!m) return null;
  return breatherUnits(m[1]).find((u) => u.id === id) || null;
}

export const isBreatherUnit = (id) => typeof id === 'string' && id.startsWith('fun:');

const MIN_GAP = 6; // videos between breathers
const LONG_RUN = 10; // videos without one before the feed offers one anyway

/**
 * Should the next slot be a breather? Returns a reason or null.
 * @param session  { viewed, earlyStreak, wrongStreak, lastBreatherAt }
 * @param signals  { breathers?: { n, pctSum, less } }  how this student took earlier breathers
 */
export function needsBreather(session = {}, signals = {}) {
  const b = signals.breathers || {};
  if ((b.less || 0) >= 2) return null; // they asked for less of this
  if (b.n >= 3 && b.pctSum / b.n < 0.35) return null; // they swipe them away
  const since = (session.viewed || 0) - (session.lastBreatherAt || 0);
  if (since < MIN_GAP) return null;
  if ((session.earlyStreak || 0) >= 2) return 'leaving-early';
  if ((session.wrongStreak || 0) >= 3) return 'tough-run';
  if ((session.viewed || 0) >= LONG_RUN && since >= LONG_RUN) return 'long-session';
  return null;
}

/**
 * Picks the breather unit: the topic the student is in right now (or one of their course and
 * interest topics), a title they have not had recently.
 */
export function pickBreather({ topics = [], lastTopic = null, recentUnits = [], rand = Math.random } = {}) {
  const pool = [lastTopic, ...topics].filter((t) => t && TOPIC_BY_ID[t]);
  const topic = pool.length ? (rand() < 0.7 ? pool[0] : pool[Math.floor(rand() * pool.length)]) : 'general';
  const units = breatherUnits(topic);
  const fresh = units.filter((u) => !recentUnits.includes(u.id));
  const from = fresh.length ? fresh : units;
  return from[Math.floor(rand() * from.length)];
}

export const BREATHER_REASONS = {
  'leaving-early': 'You left the last couple of lessons early, so here is a quick fun one next door to your subject. Your units are next.',
  'tough-run': 'A few tricky questions in a row. Here is something light before we go back in.',
  'long-session': 'You have been at it a while. A short detour, then back to your syllabus.',
};
