// Calibration: does each ranking rule actually help? Every served video's score parts are kept
// for a day (the decision); when the student leaves the video or answers its quick check, the
// outcome is folded into counters per rule and bucket (did the rule push the video up, down,
// or leave it flat), plus by posture and by local hour. A nightly job turns those counters into
// a report (the sheet's Calibration tab) and into shrink weights the ranking applies: a rule
// whose "up" picks are not watched better than its "flat" picks fades towards 1.0.
//
// Keys:
//   decision:{userId}:{videoId}   JSON  score parts + session depth, 24 h
//   calib:rule:{rule}:{bucket}    HASH  n, pctSum (×100), early, completes, right, wrong
//   calib:posture:{posture}       HASH  {dense|light}_n, _pct, _early
//   calib:hour:{h}                HASH  n, pctSum, early
//   calib:weights                 JSON  { rule: shrink 0..1 }, written by fitWeights()

import { kv } from '../core/kv.js';
import { FORMAT_VISUAL_DENSITY } from './ranking.js';
import { experimentReport } from './experiments.js';

export const RULES = ['quality', 'taste', 'diversity', 'fatigue', 'difficulty', 'freshness', 'context', 'retrieval', 'easing', 'style'];
/** Rules whose multipliers are judgement calls and may be shrunk; quality and taste are evidence-based already. */
export const SHRINKABLE = ['diversity', 'fatigue', 'difficulty', 'freshness', 'context', 'retrieval', 'easing', 'style'];
export const MIN_N = 150;          // outcomes per bucket before a weight is fitted
const DECISION_TTL = 86400;
const BUCKETS = ['up', 'flat', 'down'];

/** Which way a multiplier pushed a video. Quality is a 0..1 estimate, so its buckets are absolute. */
export function bucketOf(rule, value) {
  if (value == null || !Number.isFinite(value)) return null;
  if (rule === 'quality') return value >= 0.55 ? 'up' : value < 0.4 ? 'down' : 'flat';
  if (rule === 'taste') return value >= 1.08 ? 'up' : value <= 0.92 ? 'down' : 'flat';
  return value > 1.02 ? 'up' : value < 0.98 ? 'down' : 'flat';
}

/** The per-rule multipliers of a pick, from the score parts the ranking returns. */
export function rulesOf(parts = {}) {
  const taste = parts.formatAffinity != null ? 0.5 + 0.7 * parts.formatAffinity + 0.3 * (parts.topicAffinity ?? 0.5) : null;
  return { quality: parts.quality ?? null, taste, diversity: parts.diversity ?? null, fatigue: parts.fatigue ?? null, difficulty: parts.difficulty ?? null, freshness: parts.freshness ?? null, context: parts.context ?? null, retrieval: parts.retrieval ?? null, easing: parts.easing ?? null, style: parts.style ?? null };
}

const dkey = (userId, videoId) => `decision:${userId}:${videoId}`;

/** Remembers why a video was served to a student (one day). */
export async function noteDecision(userId, videoId, parts, { viewed = 0, unit = null } = {}) {
  if (!parts) return;
  await kv.set(dkey(userId, videoId), { rules: rulesOf(parts), unit, viewed, at: Date.now() }, { ex: DECISION_TTL });
}
export const UNIT_LEADS = ['affinity-led', 'progress-led', 'review-led', 'explored', 'interest', 'breather'];

const densityClass = (format) => ((FORMAT_VISUAL_DENSITY[format] ?? 0.5) >= 0.6 ? 'dense' : 'light');

/**
 * The outcome of a view: watch fraction, whether it was an early leave, the posture and local
 * hour it happened in. Returns the KV writes (so ingest can batch them).
 */
export async function recordOutcome(userId, video, { pct = 0, early = false, posture = null, hour = null } = {}) {
  const writes = [];
  const p100 = Math.round(Math.max(0, Math.min(1, pct)) * 100);
  const complete = pct >= 0.95;
  const decision = await kv.get(dkey(userId, video.id));
  if (decision?.rules) {
    for (const rule of RULES) {
      const b = bucketOf(rule, decision.rules[rule]);
      if (!b) continue;
      const k = `calib:rule:${rule}:${b}`;
      writes.push(kv.hincrby(k, 'n', 1), kv.hincrby(k, 'pctSum', p100));
      if (early) writes.push(kv.hincrby(k, 'early', 1));
      if (complete) writes.push(kv.hincrby(k, 'completes', 1));
    }
    // Stage one: which term chose the unit (affinity, syllabus progress, review, exploration…).
    if (decision.unit?.lead && UNIT_LEADS.includes(decision.unit.lead)) {
      const k = `calib:unit:${decision.unit.lead}`;
      writes.push(kv.hincrby(k, 'n', 1), kv.hincrby(k, 'pctSum', p100));
      if (early) writes.push(kv.hincrby(k, 'early', 1));
      if (complete) writes.push(kv.hincrby(k, 'completes', 1));
    }
  }
  if (posture && posture !== 'unknown') {
    const cls = densityClass(video.format);
    const k = `calib:posture:${posture}`;
    writes.push(kv.hincrby(k, `${cls}_n`, 1), kv.hincrby(k, `${cls}_pct`, p100));
    if (early) writes.push(kv.hincrby(k, `${cls}_early`, 1));
  }
  if (Number.isInteger(hour)) {
    const k = `calib:hour:${hour}`;
    writes.push(kv.hincrby(k, 'n', 1), kv.hincrby(k, 'pctSum', p100));
    if (early) writes.push(kv.hincrby(k, 'early', 1));
  }
  return writes;
}

/** A quick-check answer on a served video, joined to its decision. */
export async function recordQuizOutcome(userId, videoId, correct) {
  const decision = await kv.get(dkey(userId, videoId));
  if (!decision?.rules) return [];
  const writes = [];
  for (const rule of RULES) {
    const b = bucketOf(rule, decision.rules[rule]);
    if (b) writes.push(kv.hincrby(`calib:rule:${rule}:${b}`, correct ? 'right' : 'wrong', 1));
  }
  if (decision.unit?.lead && UNIT_LEADS.includes(decision.unit.lead)) writes.push(kv.hincrby(`calib:unit:${decision.unit.lead}`, correct ? 'right' : 'wrong', 1));
  return writes;
}

const num = (h, f) => Number(h?.[f]) || 0;
const row = (h) => { const n = num(h, 'n'); return { n, watch: n ? num(h, 'pctSum') / 100 / n : null, early: n ? num(h, 'early') / n : null, completion: n ? num(h, 'completes') / n : null, accuracy: num(h, 'right') + num(h, 'wrong') ? num(h, 'right') / (num(h, 'right') + num(h, 'wrong')) : null }; };

/**
 * The shrink weight for a rule from its buckets: 1 keeps the rule as designed, 0 switches it
 * off. Needs MIN_N outcomes in "up" and "flat". A rule earns its weight when the videos it
 * pushed up were watched longer than the flat ones (lift above 1) and, where the down bucket
 * exists, the ones it pushed down (still served when nothing else was ready) were watched less.
 * Exported for the tests.
 */
export function weightFrom(up, flat, down) {
  if (!up || !flat || up.n < MIN_N || flat.n < MIN_N || !flat.watch) return { weight: 1, liftUp: null, liftDown: null, evidence: 'insufficient' };
  const liftUp = up.watch / flat.watch;
  const liftDown = down && down.n >= MIN_N ? down.watch / flat.watch : null;
  const signal = liftDown == null ? liftUp - 1 : ((liftUp - 1) + (1 - liftDown)) / 2;
  const weight = Math.max(0, Math.min(1, 0.3 + 5 * signal)); // no lift → 0.3; +14 % → 1; −6 % → 0
  return { weight: +weight.toFixed(2), liftUp: +liftUp.toFixed(3), liftDown: liftDown == null ? null : +liftDown.toFixed(3), evidence: 'fitted' };
}

/** Every counter, shaped for the sheet and the admin route. */
export async function calibrationReport() {
  const rules = [];
  const weights = {};
  for (const rule of RULES) {
    const b = {};
    for (const bucket of BUCKETS) b[bucket] = row(await kv.hgetall(`calib:rule:${rule}:${bucket}`));
    const fit = SHRINKABLE.includes(rule) ? weightFrom(b.up, b.flat, b.down) : { weight: null, liftUp: b.flat.watch && b.up.n ? +(b.up.watch / b.flat.watch).toFixed(3) : null, liftDown: null, evidence: 'not shrinkable' };
    if (fit.weight != null) weights[rule] = fit.weight;
    for (const bucket of BUCKETS) rules.push({ rule, bucket, ...b[bucket], liftUp: bucket === 'up' ? fit.liftUp : null, liftDown: bucket === 'down' ? fit.liftDown : null, weight: fit.weight, evidence: fit.evidence });
  }
  const postures = [];
  for (const p of ['moving', 'hand', 'flat']) {
    const h = await kv.hgetall(`calib:posture:${p}`);
    for (const cls of ['dense', 'light']) { const n = num(h, `${cls}_n`); postures.push({ posture: p, density: cls, n, watch: n ? num(h, `${cls}_pct`) / 100 / n : null, early: n ? num(h, `${cls}_early`) / n : null }); }
  }
  const hours = [];
  for (let h = 0; h < 24; h++) { const r = row(await kv.hgetall(`calib:hour:${h}`)); hours.push({ hour: h, n: r.n, watch: r.watch, early: r.early }); }
  const units = [];
  for (const lead of UNIT_LEADS) units.push({ lead, ...row(await kv.hgetall(`calib:unit:${lead}`)) });
  const experiments = await experimentReport();
  return { rules, postures, hours, units, experiments, weights, at: new Date().toISOString() };
}

/** Fits and stores the shrink weights (nightly). Returns them. */
export async function fitWeights() {
  const { weights } = await calibrationReport();
  await kv.set('calib:weights', { ...weights, at: Date.now() });
  return weights;
}

/** The current shrink weights for the ranking (empty = the rules as designed). */
export async function getWeights() {
  const w = await kv.get('calib:weights');
  if (!w) return {};
  const { at, ...rest } = w;
  return rest;
}

/** The sheet's Calibration tab: one row per rule bucket, posture class and hour. */
export function calibrationRows(report) {
  const pct = (x) => (x == null ? '' : `${Math.round(x * 100)}%`);
  const rows = [];
  for (const r of report.rules) rows.push({ 'Row': `${r.rule} · ${r.bucket}`, 'Kind': 'rule', 'Views': r.n, 'Mean watch': pct(r.watch), 'Early leaves': pct(r.early), 'Completion': pct(r.completion), 'Quiz accuracy': pct(r.accuracy), 'Lift vs flat': r.liftUp ?? r.liftDown ?? '', 'Weight': r.weight ?? '', 'Evidence': r.evidence, 'Updated': report.at.replace('T', ' ').slice(0, 19) });
  for (const p of report.postures) rows.push({ 'Row': `posture · ${p.posture} · ${p.density} formats`, 'Kind': 'posture', 'Views': p.n, 'Mean watch': pct(p.watch), 'Early leaves': pct(p.early), 'Completion': '', 'Quiz accuracy': '', 'Lift vs flat': '', 'Weight': '', 'Evidence': p.n >= MIN_N ? 'enough' : 'collecting', 'Updated': report.at.replace('T', ' ').slice(0, 19) });
  for (const u of report.units || []) if (u.n) rows.push({ 'Row': `unit · ${u.lead}`, 'Kind': 'unit', 'Views': u.n, 'Mean watch': pct(u.watch), 'Early leaves': pct(u.early), 'Completion': pct(u.completion), 'Quiz accuracy': pct(u.accuracy), 'Lift vs flat': '', 'Weight': '', 'Evidence': u.n >= MIN_N ? 'enough' : 'collecting', 'Updated': report.at.replace('T', ' ').slice(0, 19) });
  for (const e of report.experiments || []) rows.push({ 'Row': `experiment · ${e.name} · ${e.arm} (${Object.entries(e.settings).map(([k, v]) => `${k} ${v}`).join(', ')})`, 'Kind': 'experiment', 'Views': e.n, 'Mean watch': pct(e.watch), 'Early leaves': pct(e.early), 'Completion': e.perSession == null ? '' : `${e.perSession} lessons/session`, 'Quiz accuracy': e.days ? `${e.days} active days` : '', 'Lift vs flat': '', 'Weight': '', 'Evidence': e.n >= MIN_N ? 'enough' : 'collecting', 'Updated': report.at.replace('T', ' ').slice(0, 19) });
  for (const h of report.hours) if (h.n) rows.push({ 'Row': `hour · ${String(h.hour).padStart(2, '0')}:00 local`, 'Kind': 'hour', 'Views': h.n, 'Mean watch': pct(h.watch), 'Early leaves': pct(h.early), 'Completion': '', 'Quiz accuracy': '', 'Lift vs flat': '', 'Weight': '', 'Evidence': h.n >= MIN_N ? 'enough' : 'collecting', 'Updated': report.at.replace('T', ' ').slice(0, 19) });
  return rows;
}
