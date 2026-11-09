// Exam mode: the exam date the student gave at setup, made visible and useful.
//   examPlan  → countdown, readiness per unit (mastery, feed/ranking.js) and today's focus: the
//               weakest units, more of them as the exam gets closer;
//   mockExam  → up to N questions from lessons the student has watched, weakest units first,
//               so practice is retrieval of what they have seen (the strongest way to remember).
// The answers come back as ordinary quiz events, so a mock exam feeds mastery and the feed.

import * as db from '../core/db.js';
import { kv } from '../core/kv.js';
import { getUnit } from '../curriculum/index.js';
import { mastery } from './ranking.js';
import { getProgress, notesOf } from './index.js';

export const MOCK_SIZE = 10;
const DAY = 86400000;

export function daysUntil(examDate, now = Date.now()) {
  const t = Date.parse(examDate || '');
  return Number.isFinite(t) ? Math.ceil((t - now) / DAY) : null;
}

/** Readiness label for a mastery 0..1. */
export const readinessOf = (m) => (m >= 0.75 ? 'ready' : m >= 0.4 ? 'getting there' : 'needs work');

/** { exam, examDate, days, readiness, units: [{ id, title, mastery, label }], focus: [...] } */
export async function examPlan(user, { now = Date.now() } = {}) {
  const p = user.profile || {};
  const days = daysUntil(p.examDate, now);
  const states = await getProgress(user.id);
  // A course's units; students who only follow topics are measured on those topics.
  const ids = user.units?.length ? user.units : (user.interests || []).map((t) => `topic:${t}`);
  const units = (await Promise.all(ids.slice(0, 60).map(async (id) => {
    const u = await getUnit(id).catch(() => null);
    if (!u) return null;
    const m = mastery(states[id]);
    return { id, title: u.title, mastery: m, label: readinessOf(m), watched: states[id]?.views || 0 };
  }))).filter(Boolean);
  const readiness = units.length ? Math.round((units.reduce((n, u) => n + u.mastery, 0) / units.length) * 100) / 100 : 0;
  // Closer to the exam, more units a day: from 1 (months away) to 4 (the final week).
  const perDay = days == null ? 2 : days <= 7 ? 4 : days <= 30 ? 3 : days <= 90 ? 2 : 1;
  const focus = [...units].sort((a, b) => a.mastery - b.mastery || b.watched - a.watched).slice(0, perDay);
  return { exam: p.exam || null, examDate: p.examDate || null, days, readiness, units, focus };
}

/** Questions from watched lessons: [{ videoId, unitId, unit, title, question, options, answerIndex, explanation }]. */
export async function mockExam(user, { n = MOCK_SIZE, random = Math.random } = {}) {
  const seen = await kv.smembers(`user:${user.id}:seen`);
  const states = await getProgress(user.id);
  const vids = (await Promise.all(seen.slice(-300).map((id) => db.getVideo(id)))).filter((v) => v?.status === 'ready');
  const pool = [];
  for (const v of vids) {
    const q = notesOf(v).quiz;
    if (!q || q.options.length < 2) continue;
    pool.push({ videoId: v.id, unitId: v.unitId || null, unit: v.unitTitle || null, title: v.lesson?.title || null, question: q.question, options: q.options, answerIndex: q.answerIndex, explanation: q.explanation, weight: 1 - mastery(states[v.unitId]) + random() * 0.5 });
  }
  // Weakest units first, one question per lesson, at most three per unit so it stays broad.
  pool.sort((a, b) => b.weight - a.weight);
  const perUnit = new Map();
  const out = [];
  for (const q of pool) {
    const k = q.unitId || q.videoId;
    if ((perUnit.get(k) || 0) >= 3) continue;
    perUnit.set(k, (perUnit.get(k) || 0) + 1);
    const { weight, ...rest } = q;
    out.push(rest);
    if (out.length >= n) break;
  }
  return out;
}
