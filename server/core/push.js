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

/** The one reminder a student should get right now, or null. Pure: easy to test, no storage. */
export function pickReminder({ signals, progress, now = Date.now() }) {
  const streak = streakOf(signals, now);
  const activeToday = Boolean(signals?.days?.[day(now)]);
  const hour = hourOf(now, signals?.device?.tz);
  if (streak >= 2 && !activeToday && hour >= 17 && hour <= 21) {
    return { title: 'StudyTok', body: `Your ${streak}-day streak ends tonight. One lesson keeps it.`, url: '/#feed', tag: 'studytok-reminder' };
  }
  const due = Object.values(progress || {}).filter((s) => s && s.box >= 0 && s.due && s.due <= now).length;
  if (due >= 2) {
    return { title: 'StudyTok', body: `${due} units are due for review. 5 minutes brings them back.`, url: '/#feed', tag: 'studytok-reminder' };
  }
  return null;
}

/**
 * Walks every student with a subscription and sends at most one reminder each (cron). Returns
 * { users: students with a subscription, sent: notifications delivered }.
 */
export async function remindDue({ now = Date.now() } = {}) {
  if (!enabled()) return { users: 0, sent: 0 };
  const ids = await kv.zrange('users', 0, -1);
  let users = 0, sent = 0;
  for (const userId of ids) {
    const list = await subscriptions(userId);
    if (!list.length) continue;
    users++;
    const last = Number(await kv.get(lastKey(userId))) || 0;
    if (now - last < THROTTLE_MS) continue;
    const [signals, progress] = await Promise.all([getSignals(userId), getProgress(userId)]);
    const payload = pickReminder({ signals, progress, now });
    if (!payload) continue;
    // Mark before sending so two overlapping cron runs cannot both remind the same student.
    await kv.set(lastKey(userId), now);
    const n = await sendTo(userId, payload);
    if (n) { sent += n; await kv.hincrby(`events:day:${day(now)}`, 'push_sent', n); }
  }
  return { users, sent };
}
