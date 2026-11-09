// Experiments (arms for the judgement-call thresholds), evidence decay, and stage-one leads in the calibration report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-exp-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const db = await import('../server/core/db.js');
const { EXPERIMENTS, NAMES, armOf, settingsFor, armOutcomeWrites, armCountWrites, experimentReport } = await import('../server/feed/experiments.js');
const { exploreRate } = await import('../server/feed/ranking.js');
const { needsBreather } = await import('../server/feed/breathers.js');
const { noteDecision, recordOutcome, recordQuizOutcome, calibrationReport, calibrationRows } = await import('../server/feed/calibration.js');
const { leadOf } = await import('../server/feed/index.js');

test('arms are stable, roughly even and independent across experiments', () => {
  const ids = Array.from({ length: 400 }, (_, i) => `user-${i}-${i * 7919}`);
  for (const n of NAMES) {
    const b = ids.filter((id) => armOf(id, n) === 'B').length;
    assert.ok(b > 150 && b < 250, `${n}: ${b}/400 in B`);
  }
  assert.equal(armOf('u-1', 'explore'), armOf('u-1', 'explore'));
  const agree = ids.filter((id) => armOf(id, 'explore') === armOf(id, 'breather')).length;
  assert.ok(agree > 150 && agree < 250, 'independent assignment');
  const s = settingsFor('u-1');
  assert.deepEqual(Object.keys(s.arms), NAMES);
  assert.deepEqual(s.explore, EXPERIMENTS.explore[s.arms.explore]);
});

test('the settings reach the rules: exploration share, breather triggers, moment gap', () => {
  assert.equal(exploreRate(4), 0); assert.equal(exploreRate(20), 0.075);
  assert.equal(exploreRate(20, EXPERIMENTS.explore.B), 0.05); assert.equal(exploreRate(10000, EXPERIMENTS.explore.B), 0.02);
  const session = { viewed: 9, earlyStreak: 2, wrongStreak: 0, lastBreatherAt: 0 };
  assert.equal(needsBreather(session, {}, EXPERIMENTS.breather.A), 'leaving-early');
  assert.equal(needsBreather(session, {}, EXPERIMENTS.breather.B), null, 'B waits for three early leaves');
  assert.equal(needsBreather({ ...session, earlyStreak: 3, viewed: 7 }, {}, EXPERIMENTS.breather.B), null, 'and eight videos since the last breather');
  assert.equal(needsBreather({ ...session, earlyStreak: 3, viewed: 12, lastBreatherAt: 2 }, {}, EXPERIMENTS.breather.B), 'leaving-early');
});

test('outcomes, sessions and days are counted per arm and reported', async () => {
  await Promise.all([...armOutcomeWrites('u-9', { pct: 0.8, early: false }), ...armOutcomeWrites('u-9', { pct: 0.1, early: true }), ...armCountWrites('u-9', 'sessions'), ...armCountWrites('u-9', 'days')]);
  const rows = await experimentReport();
  const mine = rows.find((r) => r.name === 'explore' && r.arm === armOf('u-9', 'explore'));
  assert.equal(mine.n, 2); assert.equal(mine.watch, 0.45); assert.equal(mine.early, 0.5); assert.equal(mine.sessions, 1); assert.equal(mine.days, 1); assert.equal(mine.perSession, 2);
  const other = rows.find((r) => r.name === 'explore' && r.arm !== armOf('u-9', 'explore'));
  assert.equal(other.n, 0);
  const sheet = calibrationRows(await calibrationReport());
  assert.ok(sheet.some((r) => r.Kind === 'experiment' && /experiment · explore · [AB] \(start/.test(r.Row)));
});

test('evidence decays: this month and last count in full, older evidence at 0.35', async () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const m0 = db.monthOf(now);
  assert.equal(m0, '202611');
  await kv.hincrby('video:old:stats', 'views', 100); await kv.hincrby('video:old:stats', 'completes', 80);     // all-time
  await kv.hincrby('video:old:stats:m202611', 'views', 10); await kv.hincrby('video:old:stats:m202611', 'completes', 2); // this month
  await kv.hincrby('video:old:stats:m202610', 'views', 10); await kv.hincrby('video:old:stats:m202610', 'completes', 2); // last month
  const s = await db.getStats('old', { now });
  assert.equal(s.views, 48); assert.equal(s.completes, 30.6);
  assert.equal((await db.getStats('never', { now })).views, 0);
  const jan = await db.blendedHash('video:old:stats', { now: Date.parse('2027-01-10T00:00:00Z'), fields: ['views'] });
  assert.equal(jan.views, 0.35 * 100, 'two months on, the same evidence has aged');
});

test('stage one: the lead term of each decision is reported with its outcomes', async () => {
  assert.equal(leadOf({ explored: true }), 'explored');
  assert.equal(leadOf({ kind: 'breather' }), 'breather');
  assert.equal(leadOf({ kind: 'course', affinity: 0.4, progress: 0.9, review: 0 }), 'progress-led');
  assert.equal(leadOf({ kind: 'course', affinity: 0.4, progress: 0.1, review: 0.9 }), 'review-led');
  await noteDecision('u-5', 'v-5', { quality: 0.5, fatigue: 1 }, { viewed: 3, unit: { kind: 'course', lead: 'review-led' } });
  await Promise.all(await recordOutcome('u-5', { id: 'v-5', format: 'explain' }, { pct: 1, early: false }));
  await Promise.all(await recordQuizOutcome('u-5', 'v-5', true));
  const report = await calibrationReport();
  const r = report.units.find((u) => u.lead === 'review-led');
  assert.equal(r.n, 1); assert.equal(r.watch, 1); assert.equal(r.completion, 1); assert.equal(r.accuracy, 1);
  assert.ok(calibrationRows(report).some((x) => x.Row === 'unit · review-led'));
});
