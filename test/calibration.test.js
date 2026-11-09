// Calibration: decisions joined to outcomes, lift per rule, fitted shrink weights the ranking
// applies, the report, and reminders at each student's own hour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-calib-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const { bucketOf, rulesOf, noteDecision, recordOutcome, recordQuizOutcome, weightFrom, calibrationReport, fitWeights, getWeights, calibrationRows, MIN_N, SHRINKABLE } = await import('../server/feed/calibration.js');
const { scoreVideo } = await import('../server/feed/ranking.js');
const { preferredHour, pickReminder } = await import('../server/core/push.js');

test('buckets: a multiplier above 1.02 is up, below 0.98 down; quality and taste use their own scales', () => {
  assert.equal(bucketOf('fatigue', 1.1), 'up'); assert.equal(bucketOf('fatigue', 1.0), 'flat'); assert.equal(bucketOf('fatigue', 0.9), 'down'); assert.equal(bucketOf('fatigue', null), null);
  assert.equal(bucketOf('quality', 0.7), 'up'); assert.equal(bucketOf('quality', 0.3), 'down'); assert.equal(bucketOf('quality', 0.45), 'flat');
  const r = rulesOf({ quality: 0.6, formatAffinity: 0.9, topicAffinity: 0.5, diversity: 0.6, fatigue: 1.1, context: 1 });
  assert.ok(r.taste > 1.08); assert.equal(bucketOf('taste', r.taste), 'up'); assert.equal(r.retrieval, null);
});

test('a decision is remembered and its outcomes land in the right buckets, by posture and by hour', async () => {
  const video = { id: 'v1', format: 'examdrill' };
  await noteDecision('u1', 'v1', { quality: 0.7, formatAffinity: 0.5, topicAffinity: 0.5, diversity: 1, fatigue: 1.2, difficulty: 0.8, freshness: 1.05, context: 1 }, { viewed: 4 });
  const w1 = await recordOutcome('u1', video, { pct: 0.9, early: false, posture: 'moving', hour: 20 });
  await Promise.all(w1);
  const w2 = await recordOutcome('u1', video, { pct: 0.1, early: true, posture: 'flat', hour: 20 });
  await Promise.all(w2);
  await Promise.all(await recordQuizOutcome('u1', 'v1', true));
  await Promise.all(await recordQuizOutcome('u1', 'v1', false));
  const up = await kv.hgetall('calib:rule:fatigue:up');
  assert.equal(Number(up.n), 2); assert.equal(Number(up.pctSum), 100); assert.equal(Number(up.early), 1); assert.equal(Number(up.right), 1); assert.equal(Number(up.wrong), 1);
  assert.equal(Number((await kv.hgetall('calib:rule:difficulty:down')).n), 2);
  assert.equal(Number((await kv.hgetall('calib:rule:diversity:flat')).n), 2);
  assert.equal(Number((await kv.hgetall('calib:rule:quality:up')).n), 2);
  assert.equal(await kv.hgetall('calib:rule:retrieval:up'), null, 'a rule that did not apply is not counted');
  const moving = await kv.hgetall('calib:posture:moving');
  assert.equal(Number(moving.dense_n), 1, 'examdrill is a dense format'); assert.equal(Number(moving.dense_pct), 90);
  assert.equal(Number((await kv.hgetall('calib:posture:flat')).dense_early), 1);
  assert.equal(Number((await kv.hgetall('calib:hour:20')).n), 2);
  assert.deepEqual(await recordOutcome('u1', { id: 'never-served' }, { pct: 0.5 }), [], 'no decision, no rule counters');
  assert.deepEqual(await recordQuizOutcome('u1', 'never-served', true), []);
});

test('weights: insufficient evidence keeps the rule; lift earns it; no lift shrinks it; a bad down bucket sinks it', () => {
  const r = (n, watch) => ({ n, watch, early: 0, completion: 0, accuracy: null });
  assert.equal(weightFrom(r(10, 0.6), r(500, 0.5), null).evidence, 'insufficient');
  assert.equal(weightFrom(r(10, 0.6), r(500, 0.5), null).weight, 1);
  assert.equal(weightFrom(r(500, 0.57), r(500, 0.5), null).weight, 1, '+14% lift: the rule as designed');
  assert.equal(weightFrom(r(500, 0.5), r(500, 0.5), null).weight, 0.3, 'no lift: shrunk to 0.3');
  assert.equal(weightFrom(r(500, 0.47), r(500, 0.5), null).weight, 0, '−6%: switched off');
  const both = weightFrom(r(500, 0.55), r(500, 0.5), r(500, 0.45));
  assert.equal(both.liftUp, 1.1); assert.equal(both.liftDown, 0.9); assert.equal(both.weight, 0.8, 'up better and down worse: strong evidence');
});

test('the ranking applies fitted weights: a rule at weight 0 no longer moves the score', () => {
  const video = { format: 'rapid', topic: 'biology', createdAt: new Date().toISOString() };
  const session = { viewed: 20, lastFormats: [], lastTopics: [] }; // deep in a session: fatigue favours light formats
  const rand = () => 0.5;
  const stats = { views: 0, completes: 0, skips: 0, likes: 0, quizRight: 0, quizWrong: 0 };
  const asDesigned = scoreVideo(video, stats, {}, session, { rand });
  const off = scoreVideo(video, stats, {}, session, { rand, weights: { fatigue: 0 } });
  const half = scoreVideo(video, stats, {}, session, { rand, weights: { fatigue: 0.5 } });
  assert.ok(asDesigned.parts.fatigue > 1, 'rapid is light, so fatigue boosts it');
  assert.ok(off.score < asDesigned.score && half.score < asDesigned.score && half.score > off.score);
  assert.equal(off.parts.fatigue, asDesigned.parts.fatigue, 'the reported part stays the designed value, so decisions keep bucketing by it');
});

test('report, fit and rows: weights are stored and read back; rows are shaped for the sheet', async () => {
  for (let i = 0; i < MIN_N; i++) {
    await kv.hincrby('calib:rule:context:up', 'n', 1); await kv.hincrby('calib:rule:context:up', 'pctSum', 60);
    await kv.hincrby('calib:rule:context:flat', 'n', 1); await kv.hincrby('calib:rule:context:flat', 'pctSum', 50);
  }
  const report = await calibrationReport();
  const ctxUp = report.rules.find((r) => r.rule === 'context' && r.bucket === 'up');
  assert.equal(ctxUp.n, MIN_N); assert.equal(ctxUp.liftUp, 1.2); assert.equal(ctxUp.weight, 1);
  assert.equal(report.rules.find((r) => r.rule === 'quality' && r.bucket === 'up').evidence, 'not shrinkable');
  assert.ok(SHRINKABLE.every((rule) => rule in report.weights));
  const weights = await fitWeights();
  assert.equal(weights.context, 1); assert.equal(weights.fatigue, 1, 'no evidence yet: as designed');
  const stored = await getWeights();
  assert.equal(stored.context, 1); assert.equal(stored.at, undefined);
  const rows = calibrationRows(report);
  const row = rows.find((r) => r.Row === 'context · up');
  assert.equal(row['Mean watch'], '60%'); assert.equal(row['Lift vs flat'], 1.2); assert.equal(row.Kind, 'rule');
  assert.ok(rows.some((r) => r.Row.startsWith('posture · moving')));
  assert.ok(rows.some((r) => r.Row === 'hour · 20:00 local'));
});

test('reminders go out at the student\'s own hour: the mode of their hour-of-day counts, 18:00 until ten views', () => {
  const hours = Array(24).fill(0);
  assert.equal(preferredHour({ hours }), 18);
  hours[7] = 6; hours[21] = 9;
  assert.equal(preferredHour({ hours }), 21);
  const base = { hours, days: {}, device: { tz: 'UTC' } };
  const at = (h) => Date.UTC(2026, 10, 9, h);
  const progress = { a: { box: 1, due: 1, lastSeen: 1 }, b: { box: 1, due: 1, lastSeen: 1 } };
  assert.equal(pickReminder({ signals: base, progress, now: at(10) }), null, 'not their hour');
  assert.match(pickReminder({ signals: base, progress, now: at(21) }).body, /due for review/);
  const streaky = { ...base, days: { '2026-11-08': 1, '2026-11-07': 1 } };
  assert.match(pickReminder({ signals: streaky, progress: {}, now: at(21) }).body, /streak/);
  assert.equal(pickReminder({ signals: streaky, progress: {}, now: at(12) }), null, 'a streak nudge waits for the evening or their usual hour');
  const early = { ...streaky, hours: Object.assign(Array(24).fill(0), { 7: 20 }) };
  assert.match(pickReminder({ signals: early, progress: {}, now: at(19) }).body, /streak/, 'a morning student with a streak at risk is still nudged in the evening');
});
