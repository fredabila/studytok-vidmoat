import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyState, mastery, scoreUnits, pickUnits, sampleBeta, videoQuality, BOX_DAYS } from '../server/feed/ranking.js';

const seeded = (seed = 1) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const unit = (id) => ({ id, title: id, topic: 'math' });
const course = ['u1', 'u2', 'u3', 'u4', 'u5'].map((id, order) => ({ unit: unit(id), kind: 'course', order }));

test('Beta sampler stays in (0,1) and tracks the mean', () => {
  const rand = seeded(7);
  let sum = 0;
  for (let i = 0; i < 3000; i++) { const x = sampleBeta(8, 2, rand); assert.ok(x > 0 && x < 1); sum += x; }
  assert.ok(Math.abs(sum / 3000 - 0.8) < 0.03);
});

test('quiz answers drive spaced repetition (Leitner boxes)', () => {
  const now = 1_000_000_000_000;
  let s = applyEvent(emptyState(), 'view', { now });
  assert.equal(s.box, 0);
  s = applyEvent(s, 'quiz_answer', { correct: true, now });
  assert.equal(s.box, 1);
  assert.equal(s.due, now + BOX_DAYS[1] * 86400000);
  s = applyEvent(s, 'quiz_answer', { correct: false, now });
  assert.equal(s.box, 0);
  assert.ok(s.due - now <= 30 * 60 * 1000, 'wrong answers come back soon');
});

test('a fresh student walks the syllabus from the start', () => {
  const rand = seeded(3);
  const counts = {};
  for (let i = 0; i < 400; i++) {
    const [first] = scoreUnits(course, {}, [], { rand });
    counts[first.unit.id] = (counts[first.unit.id] || 0) + 1;
  }
  assert.ok(counts.u1 > (counts.u3 || 0) && counts.u1 > (counts.u5 || 0), JSON.stringify(counts));
});

test('learned units give way to the next unit; due reviews come back', () => {
  const now = Date.now();
  const learned = { views: 4, completes: 4, quizRight: 3, quizWrong: 0, box: 2, lastSeen: now - 1000, due: now + 7 * 86400000 };
  assert.ok(mastery(learned) >= 0.7);
  const states = { u1: learned };
  const rand = seeded(11);
  let firstIsU2 = 0;
  for (let i = 0; i < 300; i++) if (scoreUnits(course, states, [], { rand, now })[0].unit.id === 'u2') firstIsU2++;
  assert.ok(firstIsU2 > 150, `u2 first ${firstIsU2}/300`);
  const due = { ...learned, due: now - 1000, quizWrong: 4 };
  const r = scoreUnits(course, { u1: due }, [], { rand, now }).find((x) => x.unit.id === 'u1');
  assert.ok(r.parts.review > 0, 'due unit gets a review boost');
});

test('"less" and recency push a unit down; pages do not repeat units', () => {
  const rand = seeded(5);
  const states = { u1: { ...emptyState(), less: 2 } };
  let u1First = 0;
  for (let i = 0; i < 300; i++) if (scoreUnits(course, states, [], { rand })[0].unit.id === 'u1') u1First++;
  assert.ok(u1First < 30, `u1 still first ${u1First}/300`);
  const page = pickUnits(course, {}, [], 4, { rand: seeded(9), explore: 0 });
  assert.equal(new Set(page.map((p) => p.unit.id)).size, 4);
});

test('video quality rewards completion and likes, penalises skips', () => {
  const good = videoQuality({ views: 10, completes: 8, likes: 3, skips: 1, quizRight: 5, quizWrong: 1, saves: 1 });
  const bad = videoQuality({ views: 10, completes: 1, likes: 0, skips: 8, quizRight: 0, quizWrong: 3, saves: 0 });
  assert.ok(good > bad);
});

test('with several subjects, each one starts from its own first unit', () => {
  const two = [
    ...['b1', 'b2', 'b3', 'b4'].map((id, order) => ({ unit: unit(id), kind: 'course', order, group: 'bio' })),
    ...['c1', 'c2', 'c3', 'c4'].map((id, order) => ({ unit: unit(id), kind: 'course', order, group: 'chem' })),
  ];
  const r = scoreUnits(two, {}, [], { rand: seeded(2) });
  const progress = Object.fromEntries(r.map((x) => [x.unit.id, x.parts.progress]));
  assert.equal(progress.b1, 1);
  assert.equal(progress.c1, 1);
  assert.ok(progress.b4 < progress.b2);
});

test('a brand-new student always starts at unit 1 (affinity noise cannot override the syllabus)', () => {
  const rand = seeded(13);
  for (let i = 0; i < 300; i++) assert.equal(scoreUnits(course, {}, [], { rand })[0].unit.id, 'u1');
});

const { needsBreather, pickBreather, breatherUnit, breatherUnits, isBreatherUnit, BREATHERS } = await import('../server/feed/breathers.js');
const { BREATHER_FORMATS, FORMAT_IDS } = await import('../server/video/formats.js');

test('breathers fire on early leaves, wrong runs and long sessions, not too often, and respect "less"', () => {
  assert.equal(needsBreather({ viewed: 3, earlyStreak: 1 }), null, 'one early leave is noise');
  assert.equal(needsBreather({ viewed: 8, earlyStreak: 2 }), 'leaving-early');
  assert.equal(needsBreather({ viewed: 8, wrongStreak: 3 }), 'tough-run');
  assert.equal(needsBreather({ viewed: 10, earlyStreak: 0, wrongStreak: 0 }), 'long-session');
  assert.equal(needsBreather({ viewed: 10, earlyStreak: 2, lastBreatherAt: 6 }), null, 'not within six videos of the last one');
  assert.equal(needsBreather({ viewed: 20, earlyStreak: 2 }, { breathers: { n: 1, pctSum: 0.1, less: 2 } }), null, 'two "less" switch them off');
  assert.equal(needsBreather({ viewed: 20, earlyStreak: 2 }, { breathers: { n: 4, pctSum: 0.8, less: 0 } }), null, 'swiped away: off');
  assert.equal(needsBreather({ viewed: 20, earlyStreak: 2 }, { breathers: { n: 4, pctSum: 3.2, less: 0 } }), 'leaving-early', 'watched through: on');
});

test('a breather stays next door to the subject and is a real, light unit', () => {
  const rand = seeded(5);
  const u = pickBreather({ topics: ['biology', 'space'], lastTopic: 'biology', recentUnits: [], rand });
  assert.ok(isBreatherUnit(u.id) && u.fun && u.open && u.topic === 'biology');
  assert.deepEqual(breatherUnit(u.id), u, 'ids resolve back to the unit');
  assert.equal(breatherUnit('fun:nope:9'), null);
  assert.equal(pickBreather({ topics: [], lastTopic: null, rand }).topic, 'general', 'no topics: general fun');
  const recent = breatherUnits('biology').slice(0, 2).map((x) => x.id);
  for (let i = 0; i < 20; i++) assert.equal(pickBreather({ topics: ['biology'], lastTopic: 'biology', recentUnits: recent, rand }).id, breatherUnits('biology')[2].id, 'skips recent titles');
  for (const t of Object.keys(BREATHERS)) assert.equal(breatherUnits(t).length, 3);
  for (const f of BREATHER_FORMATS) assert.ok(FORMAT_IDS.includes(f), `${f} is a format`);
});
