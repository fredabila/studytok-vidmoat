// The "For You" logic: which topic comes next for a viewer, whether to reuse a library video or
// generate a new one, and how watching behaviour moves their interest weights.

import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { TOPICS, TOPIC_BY_ID } from './topics.js';
import { startVideo } from './generator.js';
import * as db from './db.js';

const EXPLORE = 0.15;          // share of picks drawn from topics the viewer did not choose
const MIN_W = 0.05, MAX_W = 6;

export function weightsFor(ids) {
  const chosen = ids.filter((t) => TOPIC_BY_ID[t]);
  return Object.fromEntries(TOPICS.map((t) => [t.id, chosen.length === 0 || chosen.includes(t.id) ? 1 : 0]));
}

export async function createUser(interestIds = []) {
  const user = { id: randomUUID(), createdAt: new Date().toISOString(), interests: weightsFor(interestIds) };
  await db.saveUser(user);
  return user;
}

export async function setInterests(userId, ids) {
  const u = await db.getUser(userId);
  const next = weightsFor(ids);
  // Keep what was learned for topics that stay selected.
  for (const t of Object.keys(next)) if (next[t] && u.interests[t] > 0) next[t] = u.interests[t];
  const user = { ...u, interests: next };
  await db.saveUser(user);
  return user;
}

/** Weighted random topic, with a little exploration outside the chosen set. */
export function pickTopic(user, rand = Math.random) {
  const chosen = TOPICS.filter((t) => (user.interests[t.id] || 0) > 0);
  const others = TOPICS.filter((t) => !(user.interests[t.id] > 0));
  if (others.length && (rand() < EXPLORE || !chosen.length)) return others[Math.floor(rand() * others.length)].id;
  const total = chosen.reduce((s, t) => s + user.interests[t.id], 0);
  let r = rand() * total;
  for (const t of chosen) if ((r -= user.interests[t.id]) <= 0) return t.id;
  return chosen[chosen.length - 1].id;
}

const score = (s) => (s.completes * 2 + s.likes * 3 - s.skips) / Math.max(1, s.views);

/** Best ready video for this topic that the viewer has not seen or been served. */
async function reusable(userId, topicId, taken) {
  const ids = (await db.readyIds(topicId, 60)).filter((id) => !taken.has(id));
  if (!ids.length) return null;
  const blocked = await db.inAnySet(userId, ['seen', 'served'], ids);
  const candidates = ids.filter((_, i) => !blocked[i]).slice(0, 12);
  if (!candidates.length) return null;
  const stats = await Promise.all(candidates.map((id) => db.getStats(id)));
  let best = 0;
  for (let i = 1; i < candidates.length; i++) if (score(stats[i]) > score(stats[best])) best = i;
  return db.getVideo(candidates[best]);
}

/**
 * Returns `count` feed items for the viewer, plus the promises of any generation it started
 * (pass those to waitUntil on serverless). Ready, unseen library videos are reused first
 * (instant and free); otherwise a new video is started with status "generating".
 */
export async function nextItems(userId, count = 3) {
  const user = await db.getUser(userId);
  const items = [];
  const pending = [];
  const taken = new Set();
  for (let i = 0; i < count; i++) {
    const topicId = pickTopic(user);
    let video = config.generation.reuseLibrary ? await reusable(userId, topicId, taken) : null;
    if (!video || video.status !== 'ready') {
      const started = await startVideo(topicId, { requestedBy: userId });
      video = started.video;
      pending.push(started.done);
    }
    taken.add(video.id);
    items.push(video);
  }
  await db.addToSet(userId, 'served', ...items.map((v) => v.id));
  return { items, pending };
}

/** Engagement -> interest weights. Kept deliberately simple and transparent. */
const DELTAS = { complete: 0.25, like: 0.8, unlike: -0.8, skip: -0.15, less: -1.5, quiz_correct: 0.1 };
const STAT_FOR = { view: 'views', complete: 'completes', like: 'likes', skip: 'skips' };

export async function recordEvent(userId, { videoId, type, watchedSec = 0 }) {
  const video = await db.getVideo(videoId);
  if (!video) return false;

  if (type === 'view') {
    // Count a view once per viewer.
    if (await db.inSet(userId, 'seen', videoId)) return true;
    await db.addToSet(userId, 'seen', videoId);
  }
  if (type === 'like') {
    if (await db.inSet(userId, 'liked', videoId)) return true;
    await db.addToSet(userId, 'liked', videoId);
  }
  if (type === 'unlike') {
    if (!(await db.inSet(userId, 'liked', videoId))) return true;
    await db.removeFromSet(userId, 'liked', videoId);
    await db.incrStat(videoId, 'likes', -1);
  }
  if (STAT_FOR[type]) await db.incrStat(videoId, STAT_FOR[type], 1);
  if (type === 'leave' && watchedSec > 0) await db.incrStat(videoId, 'watchSec', Math.min(Math.round(watchedSec), 600));

  const delta = DELTAS[type] || 0;
  if (delta) {
    const u = await db.getUser(userId);
    const interests = { ...u.interests };
    const t = video.topic;
    // An explored topic the viewer engages with joins their interests.
    const base = interests[t] > 0 ? interests[t] : delta > 0 ? 0.3 : 0;
    interests[t] = base > 0 ? Math.min(MAX_W, Math.max(MIN_W, base + delta)) : 0;
    await db.saveUser({ ...u, interests });
  }
  return true;
}

/** What the browser gets. The Vidmoat document is included only once the video is ready. */
export async function publicVideo(v, userId, { withDocument = true } = {}) {
  const look = TOPIC_BY_ID[v.topic];
  const ready = v.status === 'ready';
  const [stats, liked, document] = await Promise.all([
    db.getStats(v.id),
    userId ? db.inSet(userId, 'liked', v.id) : false,
    ready && withDocument ? db.getDocument(v.id) : undefined,
  ]);
  return {
    id: v.id,
    status: v.status,
    error: v.status === 'failed' ? 'This video could not be generated.' : undefined,
    topic: { id: look.id, label: look.label, emoji: look.emoji, accent: look.accent },
    title: v.lesson?.title || null,
    hook: v.lesson?.hook || null,
    subtopic: v.lesson?.subtopic || null,
    duration: v.duration || null,
    poster: v.poster || null,
    credits: v.credits || [],
    liked,
    likes: stats.likes,
    document: document || undefined,
  };
}
