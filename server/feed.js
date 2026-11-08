// The "For You" logic: which topic comes next for a viewer, whether to reuse a library video or
// generate a new one, and how watching behaviour moves their interest weights.

import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { TOPICS, TOPIC_BY_ID } from './topics.js';
import { users, videos } from './store.js';
import { startVideo } from './generator.js';

const EXPLORE = 0.15;          // share of picks drawn from topics the viewer did not choose
const MIN_W = 0.05, MAX_W = 6;

export function createUser(interestIds = []) {
  const id = randomUUID();
  return users.set(id, { id, createdAt: new Date().toISOString(), interests: weightsFor(interestIds), seen: [], served: [], liked: [] });
}

function weightsFor(ids) {
  const chosen = ids.filter((t) => TOPIC_BY_ID[t]);
  return Object.fromEntries(TOPICS.map((t) => [t.id, chosen.length === 0 || chosen.includes(t.id) ? 1 : 0]));
}

export function setInterests(userId, ids) {
  return users.update(userId, (u) => {
    const next = weightsFor(ids);
    // Keep what was learned for topics that stay selected.
    for (const t of Object.keys(next)) if (next[t] && u.interests[t] > 0) next[t] = u.interests[t];
    return { ...u, interests: next };
  });
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

/**
 * Returns `count` feed items for the viewer. Ready, unseen library videos are reused first
 * (instant and free); otherwise a new video is started and returned with status "generating".
 */
export function nextItems(userId, count = 3) {
  const user = users.get(userId);
  const items = [];
  const blocked = new Set([...user.seen, ...user.served]);
  for (let i = 0; i < count; i++) {
    const topicId = pickTopic(user);
    let video = null;
    if (config.generation.reuseLibrary) {
      const pool = videos.all().filter((v) => v.topic === topicId && v.status === 'ready' && !blocked.has(v.id));
      // Better-performing videos first, newest as tie-breaker.
      pool.sort((a, b) => score(b) - score(a) || b.createdAt.localeCompare(a.createdAt));
      video = pool[0] || null;
    }
    if (!video) video = startVideo(topicId, { requestedBy: userId });
    blocked.add(video.id);
    items.push(video);
  }
  users.update(userId, (u) => ({ ...u, served: [...u.served, ...items.map((v) => v.id)].slice(-500) }));
  return items;
}

const score = (v) => (v.stats.completes * 2 + v.stats.likes * 3 - v.stats.skips) / Math.max(1, v.stats.views);

/** Engagement -> interest weights. Kept deliberately simple and transparent. */
const DELTAS = { complete: 0.25, like: 0.8, unlike: -0.8, skip: -0.15, less: -1.5, quiz_correct: 0.1 };

export function recordEvent(userId, { videoId, type, watchedSec = 0 }) {
  const video = videos.get(videoId);
  if (!video) return null;
  const t = video.topic;

  videos.update(videoId, (v) => {
    const s = { ...v.stats };
    if (type === 'view') s.views++;
    if (type === 'complete') s.completes++;
    if (type === 'like') s.likes++;
    if (type === 'unlike') s.likes = Math.max(0, s.likes - 1);
    if (type === 'skip') s.skips++;
    if (watchedSec > 0 && type === 'leave') s.watchSec += Math.min(watchedSec, 600);
    return { ...v, stats: s };
  });

  const delta = DELTAS[type] || 0;
  return users.update(userId, (u) => {
    const interests = { ...u.interests };
    if (delta) {
      // An explored topic the viewer engages with joins their interests.
      const base = interests[t] > 0 ? interests[t] : delta > 0 ? 0.3 : 0;
      interests[t] = base > 0 ? Math.min(MAX_W, Math.max(MIN_W, base + delta)) : 0;
    }
    const seen = type === 'view' && !u.seen.includes(videoId) ? [...u.seen, videoId].slice(-2000) : u.seen;
    const liked = type === 'like' ? [...new Set([...u.liked, videoId])] : type === 'unlike' ? u.liked.filter((x) => x !== videoId) : u.liked;
    return { ...u, interests, seen, liked };
  });
}

/** What the browser gets. The Vidmoat document is included only once the video is ready. */
export function publicVideo(v, userId) {
  const look = TOPIC_BY_ID[v.topic];
  const u = userId ? users.get(userId) : null;
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
    liked: u ? u.liked.includes(v.id) : false,
    likes: v.stats?.likes || 0,
    document: v.status === 'ready' ? v.document : undefined,
  };
}
