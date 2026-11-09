// Experiments: the thresholds that are still judgement calls (exploration rate, breather
// triggers, moment pacing) run as two arms. A student lands in an arm per experiment by a
// stable hash of their id, so the split is even, independent across experiments and never
// changes for a student. Outcomes per arm (watch fraction, early leaves, sessions, active days,
// lessons per session) are counted into calib:exp:{name}:{arm} and reported in the sheet's
// Calibration tab; a human reads them and promotes the better arm by editing EXPERIMENTS.

import { kv } from '../core/kv.js';

export const EXPERIMENTS = {
  // Exploration share after the first 8 videos: start, decaying towards floor.
  explore: { A: { start: 0.15, floor: 0.03 }, B: { start: 0.1, floor: 0.02 } },
  // Breather triggers: early leaves in a row, wrong answers in a row, videos between breathers.
  breather: { A: { early: 2, wrong: 3, gap: 6 }, B: { early: 3, wrong: 4, gap: 8 } },
  // Moments: lessons between two moments.
  moments: { A: { gap: 6 }, B: { gap: 9 } },
};
export const NAMES = Object.keys(EXPERIMENTS);

/** FNV-1a over a string, 32-bit. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  // A final avalanche (murmur3 fmix) so neighbouring inputs land in unrelated arms.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
  return h >>> 0;
}

/** The arm a student is in for one experiment: stable, even, independent per experiment. */
// STUDYTOK_EXPERIMENTS=off puts everyone in arm A (the designed thresholds); the tests use it.
export const armOf = (userId, name) => (process.env.STUDYTOK_EXPERIMENTS === 'off' ? 'A' : hash(`${name}:${userId || ''}`) % 1000 < 500 ? 'A' : 'B');

/** Every experiment's settings for a student, plus the arms for the record. */
export function settingsFor(userId) {
  const arms = Object.fromEntries(NAMES.map((n) => [n, armOf(userId, n)]));
  return { arms, ...Object.fromEntries(NAMES.map((n) => [n, EXPERIMENTS[n][arms[n]]])) };
}

const key = (name, arm) => `calib:exp:${name}:${arm}`;

/** A view's outcome, credited to the student's arm in every experiment. Returns KV writes. */
export function armOutcomeWrites(userId, { pct = 0, early = false } = {}) {
  const p100 = Math.round(Math.max(0, Math.min(1, pct)) * 100);
  const writes = [];
  for (const n of NAMES) {
    const k = key(n, armOf(userId, n));
    writes.push(kv.hincrby(k, 'n', 1), kv.hincrby(k, 'pctSum', p100));
    if (early) writes.push(kv.hincrby(k, 'early', 1));
  }
  return writes;
}
/** A new session or a new active day for the student, per arm. */
export const armCountWrites = (userId, field) => NAMES.map((n) => kv.hincrby(key(n, armOf(userId, n)), field, 1));

/** The per-arm numbers for the report. */
export async function experimentReport() {
  const rows = [];
  for (const n of NAMES) {
    for (const arm of ['A', 'B']) {
      const h = (await kv.hgetall(key(n, arm))) || {};
      const views = Number(h.n) || 0, sessions = Number(h.sessions) || 0;
      rows.push({ name: n, arm, settings: EXPERIMENTS[n][arm], n: views, watch: views ? (Number(h.pctSum) || 0) / 100 / views : null, early: views ? (Number(h.early) || 0) / views : null,
        sessions, days: Number(h.days) || 0, perSession: sessions ? +(views / sessions).toFixed(2) : null });
    }
  }
  return rows;
}
