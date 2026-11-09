// Web Push reminders for installed (PWA) users: "your streak ends tonight" and "N units are due
// for review". Subscriptions come from public/push.js and are stored per student; the cron calls
// remindDue() which picks at most one message per student per 20 hours, or none.
//
// Keys:  push:<userId>        JSON array of PushSubscription objects (max 5, one per device)
//        push:last:<userId>   ms timestamp of the last reminder sent to that student
//
// Off unless both VAPID keys are set (`npx web-push generate-vapid-keys`): every function then
// degrades to a no-op so the app, the routes and the cron keep working without reminders.

import * as webpush from 'web-push';
import { kv } from './kv.js';
import { config } from './config.js';
import { getSignals, streakOf, hourOf, day } from '../feed/events.js';
import { getProgress } from '../feed/index.js';

const MAX_SUBSCRIPTIONS = 5;
const THROTTLE_MS = 20 * 60 * 60 * 1000; // one push per student per 20 hours, whatever the reason
const TTL_SECONDS = 6 * 60 * 60; // a reminder that cannot be delivered within 6 hours is stale

export const enabled = () => Boolean(config.push.publicKey && config.push.privateKey);
export const publicKey = () => (enabled() ? config.push.publicKey : null);

const subsKey = (userId) => `push:${userId}`;
const lastKey = (userId) => `push:last:${userId}`;

let vapidSet = false;
function defaultSender(subscription, payload, options) {
  if (!vapidSet) { webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey); vapidSet = true; }
  return webpush.sendNotification(subscription, payload, options);
}
// The sender is swappable so tests can run without network (and so a future provider can plug in).
let sender = defaultSender;
export function setSender(fn) { sender = fn || defaultSender; }

/** A browser PushSubscription as JSON, reduced to what web-push needs. Null when malformed. */
function cleanSubscription(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const endpoint = String(sub.endpoint || '');
  const p256dh = String(sub.keys?.p256dh || ''), auth = String(sub.keys?.auth || '');
  if (!/^https:\/\/\S{1,2000}$/.test(endpoint) || !p256dh || !auth || p256dh.length > 256 || auth.length > 64) return null;
  return { endpoint, keys: { p256dh, auth }, ...(sub.expirationTime ? { expirationTime: Number(sub.expirationTime) || null } : {}) };
}

export async function subscriptions(userId) {
  const list = await kv.get(subsKey(userId));
  return Array.isArray(list) ? list : [];
}

/** Adds (or refreshes) one device's subscription. Returns the stored list. */
export async function subscribe(userId, subscription) {
  const sub = cleanSubscription(subscription);
  if (!sub) throw Object.assign(new Error('Invalid push subscription'), { status: 400 });
  const list = (await subscriptions(userId)).filter((s) => s.endpoint !== sub.endpoint);
  list.push({ ...sub, addedAt: Date.now() });
  // Newest devices win: a student re-subscribing a sixth browser drops the oldest one.
  const kept = list.slice(-MAX_SUBSCRIPTIONS);
  await kv.set(subsKey(userId), kept);
  return kept;
}

export async function unsubscribe(userId, endpoint) {
  const list = await subscriptions(userId);
  const kept = list.filter((s) => s.endpoint !== String(endpoint || ''));
  if (kept.length) await kv.set(subsKey(userId), kept); else await kv.del(subsKey(userId));
  return kept;
}

/**
 * Sends one payload to every device of a student. Subscriptions the push service reports as gone
 * (404 / 410) are dropped; other failures are logged and kept (transient). Returns how many went.
 */
export async function sendTo(userId, payload) {
  if (!enabled()) return 0;
  const list = await subscriptions(userId);
  if (!list.length) return 0;
  const body = JSON.stringify(payload);
  const dead = new Set();
  let sent = 0;
  await Promise.all(list.map(async (sub) => {
    try {
      await sender({ endpoint: sub.endpoint, keys: sub.keys }, body, { TTL: TTL_SECONDS, urgency: 'normal' });
      sent++;
    } catch (err) {
      const status = err?.statusCode || err?.status;
      if (status === 404 || status === 410) dead.add(sub.endpoint);
      else console.warn('[push]', status || '', err?.message || err);
    }
  }));
  if (dead.size) {
    const kept = list.filter((s) => !dead.has(s.endpoint));
    if (kept.length) await kv.set(subsKey(userId), kept); else await kv.del(subsKey(userId));
  }
  return sent;
}

/**
 * The local hour a student usually studies at: the mode of their hour-of-day counts once there
 * are ten views, else 18:00. Reminders go out at that hour, not at a fixed time for everyone.
 */
export function preferredHour(signals) {
  const hours = signals?.hours || [];
  const total = hours.reduce((a, b) => a + (b || 0), 0);
  if (total < 10) return 18;
  let best = 18, max = -1;
  hours.forEach((n, h) => { if ((n || 0) > max) { max = n || 0; best = h; } });
  return best;
}

/**
 * Quiet hours in the student's own time: no study nudge and no social notification then.
 * Adults 22:00-07:00, under-18s 21:00-07:00, under-13s 20:00-07:30 (rounded to 08:00 here).
 */
export function isQuiet(hour, age) {
  const a = Number(age);
  const [from, to] = Number.isFinite(a) && a > 0 && a < 13 ? [20, 8] : Number.isFinite(a) && a > 0 && a < 18 ? [21, 7] : [22, 7];
  return hour >= from || hour < to;
}

const EXAM_MILESTONES = new Set([30, 14, 7, 3, 2, 1]);

/**
 * The one study nudge a student should get right now, or null. Pure (no storage), so it is easy to
 * test. In priority order, each at the student's usual hour unless said otherwise:
 *   streak about to end (also any evening hour) · exam countdown on milestone days (naming the
 *   weakest unit) · units due for review · quick-check questions to fix · new lessons in a course
 *   they follow · a comeback after 3-13 quiet days (naming the next lesson when there is one).
 * Nothing in quiet hours, nothing when they already studied today (except a countdown on its day).
 * Extras: { age, exam: { name, days, weak }, misses, fresh: { handle, count }, nextTitle }.
 */
export function pickReminder({ signals, progress, now = Date.now(), age = null, exam = null, misses = 0, fresh = null, nextTitle = null }) {
  const hour = hourOf(now, signals?.device?.tz);
  if (isQuiet(hour, age)) return null;
  const streak = streakOf(signals, now);
  const activeToday = Boolean(signals?.days?.[day(now)]);
  const mine = preferredHour(signals);
  const atMine = hour === mine;
  // The cron runs hourly: a student is reminded in their own usual hour (or the evening for a streak at risk).
  if (streak >= 2 && !activeToday && (atMine || (hour >= 17 && hour <= 21))) {
    return { kind: 'streak', title: 'StudyGraph', body: `Your ${streak}-day streak ends tonight. One lesson keeps it.`, url: '/#feed', tag: 'studygraph-reminder' };
  }
  if (exam && exam.days > 0 && atMine && (EXAM_MILESTONES.has(exam.days) || (exam.days <= 7 && !activeToday))) {
    const when = exam.days === 1 ? 'is tomorrow' : `is in ${exam.days} days`;
    return { kind: 'exam', title: `${exam.name || 'Your exam'} ${when}`, body: exam.weak ? `${exam.weak} needs the most work. A mock exam or two lessons now?` : 'A quick mock exam shows what still needs work.', url: '/#library', tag: 'studygraph-exam' };
  }
  if (activeToday || !atMine) return null;
  const due = Object.values(progress || {}).filter((s) => s && s.box >= 0 && s.due && s.due <= now).length;
  // Due reviews: at the student's usual hour (18:00 until there is a pattern); the hourly cron finds it.
  if (due >= 2) {
    return { kind: 'review', title: 'StudyGraph', body: `${due} units are due for review. 5 minutes brings them back.`, url: '/#feed', tag: 'studygraph-reminder' };
  }
  if (misses >= 3) {
    return { kind: 'fix', title: `${misses} questions to fix`, body: 'Quick checks you got wrong. Get each one right twice and it is yours for good.', url: '/#library', tag: 'studygraph-fix' };
  }
  if (fresh?.count >= 2 && fresh.handle) {
    return { kind: 'fresh', title: `New in @${fresh.handle}`, body: `${fresh.count} new lessons since you last looked.`, url: `/?c=${encodeURIComponent(fresh.handle)}`, tag: 'studygraph-fresh' };
  }
  const away = signals?.lastSeenAt ? Math.floor((now - signals.lastSeenAt) / 86400000) : 0;
  if (away >= 3 && away <= 13) {
    return { kind: 'comeback', title: nextTitle ? 'Your next lesson is ready' : 'StudyGraph', body: nextTitle ? `“${nextTitle.slice(0, 80)}”. It takes under a minute.` : `It has been ${away} days. One short lesson gets you back in.`, url: '/#feed', tag: 'studygraph-comeback' };
  }
  return null;
}

/**
 * How often a student who does not respond may still be nudged. Every nudge sent without the
 * student opening the app afterwards counts as ignored; any visit resets it.
 *   0-2 ignored: once a day · 3-5: every 2 days · 6-9: weekly · 10+: no more until they come back.
 */
export function backoffGap(ignored) {
  if (ignored >= 10) return Infinity;
  if (ignored >= 6) return 7 * 86400000;
  if (ignored >= 3) return 2 * 86400000;
  return THROTTLE_MS;
}

/**
 * Walks every student with a subscription and sends at most one study nudge each (hourly cron),
 * after delivering any social notification that waited for quiet hours to end. Returns
 * { users: students with a subscription, sent: notifications delivered }.
 * `context(userId, user)` loads the extras pickReminder can use (feed/notify.js).
 */
export async function remindDue({ now = Date.now(), context = null } = {}) {
  if (!enabled()) return { users: 0, sent: 0 };
  const ids = await kv.zrange('users', 0, -1);
  let users = 0, sent = 0;
  for (const userId of ids) {
    const list = await subscriptions(userId);
    if (!list.length) continue;
    users++;
    const [signals, user] = await Promise.all([getSignals(userId), kv.get(`user:${userId}`)]);
    const age = user?.profile?.age ?? null;
    if (isQuiet(hourOf(now, signals?.device?.tz), age)) continue;
    sent += await flushQueued(userId, now);
    const state = (await kv.get(stateKey(userId))) || { ignored: 0, lastSent: Number(await kv.get(lastKey(userId))) || 0 };
    // Came back since the last nudge: it worked (or was not needed); start counting again.
    if (state.lastSent && (signals?.lastSeenAt || 0) > state.lastSent) state.ignored = 0;
    if (now - (state.lastSent || 0) < backoffGap(state.ignored)) continue;
    const progress = await getProgress(userId);
    const extras = context ? await context(userId, user, signals, now).catch(() => ({})) : {};
    const payload = pickReminder({ signals, progress, now, age, ...extras });
    if (!payload) continue;
    // Mark before sending so two overlapping cron runs cannot both remind the same student.
    const ignoredBefore = state.lastSent && (signals?.lastSeenAt || 0) <= state.lastSent;
    await kv.set(stateKey(userId), { ignored: (ignoredBefore ? state.ignored + 1 : 0), lastSent: now, lastKind: payload.kind });
    await kv.set(lastKey(userId), now);
    const n = await sendTo(userId, payload);
    if (n) { sent += n; await kv.hincrby(`events:day:${day(now)}`, 'push_sent', n); await kv.hincrby(`events:day:${day(now)}`, `push_sent_${payload.kind}`, 1); }
  }
  return { users, sent };
}

// ---- Social notifications (replies, tutor answers): sent at once, held during quiet hours ------
const SOCIAL_PER_DAY = 4;
const stateKey = (userId) => `push:state:${userId}`;
const queueKey = (userId) => `push:queue:${userId}`;

/**
 * Sends a notification that something happened for this student (a reply, a tutor answer) right
 * away, or holds it until their quiet hours end. At most SOCIAL_PER_DAY a day.
 * Returns 'sent' | 'queued' | 'capped' | 'off'.
 */
export async function notifyNow(userId, payload, { now = Date.now() } = {}) {
  if (!enabled() || !userId || !(await subscriptions(userId)).length) return 'off';
  const [signals, user] = await Promise.all([getSignals(userId), kv.get(`user:${userId}`)]);
  if ((await kv.hincrby('push:social', `${userId}:${day(now)}`, 1)) > SOCIAL_PER_DAY) return 'capped';
  if (isQuiet(hourOf(now, signals?.device?.tz), user?.profile?.age)) {
    await kv.lpush(queueKey(userId), { ...payload, at: now });
    await kv.ltrim(queueKey(userId), 0, 9);
    return 'queued';
  }
  const n = await sendTo(userId, payload);
  if (n) { await kv.hincrby(`events:day:${day(now)}`, 'push_sent', n); await kv.hincrby(`events:day:${day(now)}`, `push_sent_${payload.kind || 'social'}`, 1); }
  return n ? 'sent' : 'off';
}

/** Delivers what waited for the morning: one notification (the newest, with a count). */
async function flushQueued(userId, now) {
  const queued = (await kv.lrange(queueKey(userId), 0, 9)).filter((q) => q && now - (q.at || 0) < 36 * 3600000);
  if (!queued.length) return 0;
  await kv.del(queueKey(userId));
  const [latest] = queued;
  const payload = queued.length > 1 ? { ...latest, title: `${queued.length} new replies`, body: latest.body } : latest;
  return sendTo(userId, payload);
}
