// Recall cards (missed quick checks that come back), exam urgency and the opener moments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-recall-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const { recordMiss, recordRecall, getMisses, dueMisses, pickRecall, noteRecall, recallItem, FIRST_DUE_MS, SECOND_DUE_MS, MIN_VIEWED, GAP } = await import('../server/feed/recall.js');
const { examUrgency, pickUnits, scoreVideo } = await import('../server/feed/ranking.js');
const { openerMoment, pickMoment, noteMoment, momentContext } = await import('../server/feed/moments.js');
const { EVENT_SPECS } = await import('../server/feed/events.js');

const video = (n) => ({ id: `v${n}`, unitId: 'u1', unitTitle: 'Cells', topic: 'biology', quiz: { question: `Q${n}?`, options: ['a', 'b', 'c'], answerIndex: 1, explanation: 'because' }, lesson: { hook: 'h' } });

test('a wrong answer is remembered and comes back after half an hour; right twice retires it, wrong resets it', async () => {
  const uid = 'u-recall', t0 = 1_700_000_000_000;
  assert.equal(await recordMiss(uid, { id: 'noquiz' }, t0), null, 'no question, nothing to recall');
  await recordMiss(uid, video(1), t0);
  await recordMiss(uid, video(2), t0 + 1000);
  await recordMiss(uid, video(1), t0 + 2000); // again: one entry per video
  const list = await getMisses(uid);
  assert.equal(list.length, 2); assert.equal(list[0].videoId, 'v1'); assert.equal(list[0].due, t0 + 2000 + FIRST_DUE_MS);
  assert.equal(dueMisses(list, t0 + 2000).length, 0, 'not due yet');
  assert.equal(dueMisses(list, t0 + 2000 + FIRST_DUE_MS).length, 2, 'due after the gap');
  assert.equal(await recordRecall(uid, 'v1', true, t0 + 3600e3), 'advanced');
  assert.equal((await getMisses(uid)).find((m) => m.videoId === 'v1').due, t0 + 3600e3 + SECOND_DUE_MS);
  assert.equal(await recordRecall(uid, 'v1', false, t0 + 2 * 3600e3), 'reset');
  const reset = (await getMisses(uid)).find((m) => m.videoId === 'v1');
  assert.equal(reset.box, 0); assert.equal(reset.misses, 2);
  assert.equal(await recordRecall(uid, 'v2', true, t0), 'advanced');
  assert.equal(await recordRecall(uid, 'v2', true, t0), 'retired');
  assert.equal((await getMisses(uid)).length, 1);
  assert.equal(await recordRecall(uid, 'nope', true, t0), null);
  const item = recallItem(reset);
  assert.equal(item.kind, 'recall'); assert.equal(item.id, 'recall:v1'); assert.equal(item.recall.answerIndex, 1); assert.equal(item.topic.id, 'biology'); assert.ok(item.topic.accent);
});

test('recall pacing: not before two lessons, then one every four, only when something is due', async () => {
  const uid = 'u-pace', t0 = Date.now() - 86400e3;
  await recordMiss(uid, video(1), t0);
  assert.equal(await pickRecall(uid, { session: { sid: 's1', viewed: MIN_VIEWED - 1 } }), null);
  const m = await pickRecall(uid, { session: { sid: 's1', viewed: MIN_VIEWED } });
  assert.equal(m.videoId, 'v1');
  await noteRecall(uid, { sid: 's1', viewed: MIN_VIEWED });
  assert.equal(await pickRecall(uid, { session: { sid: 's1', viewed: MIN_VIEWED + GAP - 1 } }), null, 'gap');
  assert.ok(await pickRecall(uid, { session: { sid: 's1', viewed: MIN_VIEWED + GAP } }));
  assert.ok(await pickRecall(uid, { session: { sid: 's2', viewed: MIN_VIEWED } }), 'a new session starts the count again');
  await recordRecall(uid, 'v1', true); await recordRecall(uid, 'v1', true);
  assert.equal(await pickRecall(uid, { session: { sid: 's3', viewed: 10 } }), null, 'nothing left');
});

test('exam urgency rises over the last 45 days and tilts unit picks towards review and videos towards retrieval', () => {
  const now = Date.parse('2026-05-01T00:00:00Z');
  assert.equal(examUrgency(null, now), 0); assert.equal(examUrgency('nonsense', now), 0);
  assert.equal(examUrgency('2026-08-01', now), 0, 'far away');
  assert.equal(examUrgency('2026-04-20', now), 0, 'long past');
  assert.ok(examUrgency('2026-05-31', now) > 0.3 && examUrgency('2026-05-31', now) < 0.4);
  assert.equal(examUrgency('2026-05-01', now), 1);
  const units = [{ unit: { id: 'a', topic: 'biology' }, kind: 'course', group: 'g' }, { unit: { id: 'b', topic: 'biology' }, kind: 'course', group: 'g' }];
  const states = { a: { lastSeen: now - 86400e3, served: 3, views: 3, completes: 3, quizRight: 2, quizWrong: 0, due: now + 5 * 86400e3, box: 2 } };
  const rand = () => 0.5;
  const calm = pickUnits(units, states, [], 1, { rand, now, urgency: 0 });
  const urgent = pickUnits(units, states, [], 1, { rand, now, urgency: 1 });
  assert.equal(calm[0].unit.id, 'b', 'normally the frontier wins');
  assert.equal(urgent[0].unit.id, 'a', 'with the exam near, the started unit is revisited');
  assert.ok(urgent[0].parts.review > 0);
  const gentle = scoreVideo({ format: 'explain', topic: 'biology' }, {}, {}, {}, { rand, now, gentle: true });
  const hard = scoreVideo({ format: 'examdrill', topic: 'biology' }, {}, {}, {}, { rand, now, gentle: true });
  assert.ok(gentle.parts.easing > hard.parts.easing, 'easing favours the gentle formats');
  assert.equal(scoreVideo({ format: 'examdrill', topic: 'biology' }, {}, {}, {}, { rand, now }).parts.easing, undefined);
});

test('openers: welcome back after days away, the exam countdown weekly, otherwise last time; once a day, never inside a live session', () => {
  const now = Date.parse('2026-05-10T09:00:00Z');
  const stats = { goal: 3, due: 2, streak: 4, mastered: 3, unitsTotal: 10 };
  assert.equal(openerMoment({ session: { lastAt: now - 3600e3, viewed: 5 }, stats, now }), null, 'the session is still live');
  const welcome = openerMoment({ session: { lastAt: now - 5 * 86400e3, viewed: 5 }, signals: { lastSeenAt: now - 5 * 86400e3 }, stats, now });
  assert.equal(welcome.type, 'welcome'); assert.match(welcome.title, /5 days away/);
  const exam = openerMoment({ session: { lastAt: now - 86400e3, viewed: 5, quizN: 4, quizRight: 3 }, signals: { lastSeenAt: now - 86400e3 }, stats, exam: { name: 'WASSCE', days: 21 }, now });
  assert.equal(exam.type, 'exam'); assert.match(exam.title, /21 days to WASSCE/); assert.match(exam.lines[0], /7 units still to master/); assert.match(exam.lines[1], /1 lesson a day/);
  const recap = openerMoment({ session: { lastAt: now - 86400e3, viewed: 5, quizN: 4, quizRight: 3 }, signals: { lastSeenAt: now - 86400e3 }, stats, exam: { name: 'WASSCE', days: 21 }, now, mark: { examAt: now - 86400e3 } });
  assert.equal(recap.type, 'recap', 'the exam card is weekly; otherwise last time'); assert.match(recap.title, /Last time: 5 lessons/); assert.match(recap.lines[0], /3 of 4/);
  assert.equal(openerMoment({ session: { lastAt: now - 86400e3, viewed: 5 }, stats, now, mark: { openerDay: '2026-05-10' } }), null, 'once a day');
  assert.equal(openerMoment({ session: { lastAt: now - 86400e3, viewed: 0 }, stats, now }), null, 'nothing to recap');
});

test('pickMoment serves an opener ahead of the pacing rules and noteMoment keeps it out of the daily quota', async () => {
  const uid = 'u-opener', now = Date.now();
  const session = { sid: 's', lastAt: now - 86400e3, viewed: 6, quizN: 2, quizRight: 2 };
  const ctx = momentContext({ user: { units: [] }, signals: { lastSeenAt: now - 86400e3, topics: {} }, watched: 20 });
  const m = await pickMoment(uid, { session, ctx, stats: { goal: 3 }, now });
  assert.equal(m.type, 'recap');
  await noteMoment(uid, m, 0, now);
  const mark = await kv.get(`user:${uid}:moments`);
  assert.ok(mark.openerDay); assert.equal(mark.today, undefined, 'not counted');
  assert.equal(await pickMoment(uid, { session, ctx, stats: { goal: 3 }, now }), null, 'no second opener today, and the session is too early for a regular moment (viewed counts from the stale session)');
});

test('recall events are registered', () => {
  assert.deepEqual(Object.keys(EVENT_SPECS.recall_answer.fields), ['id', 'correct', 'ms']);
  assert.ok(EVENT_SPECS.recall_view && EVENT_SPECS.recall_skip);
});
