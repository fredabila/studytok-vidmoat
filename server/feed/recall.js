// Recall cards: a quick-check question the student got wrong comes back later as a card in the
// feed (no video, rendered by the app). Getting it right twice, spaced out, retires it; getting
// it wrong again brings it back sooner. The list lives in `user:{id}:misses` (at most 40, oldest
// dropped), the pacing marker in `user:{id}:recallAt`.

import { kv } from '../core/kv.js';
import { TOPIC_BY_ID } from '../curriculum/topics.js';

export const MAX_MISSES = 40;
export const FIRST_DUE_MS = 30 * 60 * 1000;      // a miss comes back after half an hour (or next session)
export const SECOND_DUE_MS = 2 * 86400000;       // right once: again in two days, then retired
export const MIN_VIEWED = 2;                     // lessons into the session before a recall card
export const GAP = 4;                            // lessons between recall cards

const key = (userId) => `user:${userId}:misses`;

export async function getMisses(userId) {
  const list = await kv.get(key(userId));
  return Array.isArray(list) ? list : [];
}

/** A wrong quick-check answer: remember the question so it can come back. */
export async function recordMiss(userId, video, now = Date.now()) {
  const q = video?.quiz;
  if (!q?.question || !Array.isArray(q.options) || q.options.length < 2) return null;
  const list = (await getMisses(userId)).filter((m) => m.videoId !== video.id);
  const miss = {
    videoId: video.id, unitId: video.unitId || null, unitTitle: video.unitTitle || null, topic: video.topic || null,
    question: q.question, options: q.options.slice(0, 3), answerIndex: q.answerIndex ?? 0, explanation: q.explanation || video.lesson?.hook || '',
    at: now, box: 0, due: now + FIRST_DUE_MS, misses: 1,
  };
  list.unshift(miss);
  await kv.set(key(userId), list.slice(0, MAX_MISSES));
  return miss;
}

/** The answer on a recall card. Returns what happened: 'retired' | 'advanced' | 'reset' | null (unknown). */
export async function recordRecall(userId, videoId, correct, now = Date.now()) {
  const list = await getMisses(userId);
  const i = list.findIndex((m) => m.videoId === videoId);
  if (i < 0) return null;
  const m = list[i];
  let outcome;
  if (correct && m.box >= 1) { list.splice(i, 1); outcome = 'retired'; }
  else if (correct) { list[i] = { ...m, box: 1, due: now + SECOND_DUE_MS, lastAt: now }; outcome = 'advanced'; }
  else { list[i] = { ...m, box: 0, due: now + FIRST_DUE_MS, misses: (m.misses || 1) + 1, lastAt: now }; outcome = 'reset'; }
  await kv.set(key(userId), list);
  return outcome;
}

export const dueMisses = (list, now = Date.now()) => list.filter((m) => (m.due || 0) <= now).sort((a, b) => (a.due || 0) - (b.due || 0));

/** What the app renders. */
export function recallItem(m) {
  const look = TOPIC_BY_ID[m.topic] || { id: m.topic || 'general', label: 'Lesson', emoji: '📚', accent: '#ffd93d' };
  return {
    id: `recall:${m.videoId}`, kind: 'recall', status: 'ready',
    recall: { videoId: m.videoId, question: m.question, options: m.options, answerIndex: m.answerIndex, explanation: m.explanation || '', unit: m.unitTitle || null, box: m.box || 0, misses: m.misses || 1 },
    topic: { id: look.id, label: look.label, emoji: look.emoji, accent: look.accent },
  };
}

/** The recall card for this page, if one is due and the pacing allows it. */
export async function pickRecall(userId, { session = {}, now = Date.now() } = {}) {
  const viewed = session.lastAt && now - session.lastAt > 12 * 3600000 ? 0 : session.viewed || 0; // a stale session is over
  if (viewed < MIN_VIEWED) return null;
  const mark = (await kv.get(`user:${userId}:recallAt`)) || { at: -GAP, sid: '' };
  if (mark.sid === (session.sid || '') && viewed - mark.at < GAP) return null;
  const due = dueMisses(await getMisses(userId), now);
  if (!due.length) return null;
  return due[0];
}

export async function noteRecall(userId, session = {}) {
  await kv.set(`user:${userId}:recallAt`, { at: session.viewed || 0, sid: session.sid || '', lastAt: Date.now() });
}
