// What a notification can say about this student right now (the extras core/push.js pickReminder
// uses), and the notifications triggered by something happening (a reply, a tutor answer).
// Every notification carries a `kind`; the service worker adds ?n=<kind> to the link it opens, so
// the app can count which kinds students actually open (events: push_open).

import * as db from '../core/db.js';
import { kv } from '../core/kv.js';
import * as push from '../core/push.js';
import { lessonKey } from '../lessons/index.js';
import { audienceFor } from './index.js';
import { examPlan } from './exam.js';
import { getMisses, dueMisses } from './recall.js';
import { followingOf, getChannel, channelLessonIds } from './channels.js';

/** { exam, misses, fresh, nextTitle } for pickReminder. Each part is optional and fails soft. */
export async function reminderContext(userId, user, signals, now = Date.now()) {
  if (!user) return {};
  const out = {};
  const soft = (p) => p.catch(() => null);
  const [plan, misses, fresh, nextTitle] = await Promise.all([
    user.profile?.examDate ? soft(examPlan(user, { now })) : null,
    soft(getMisses(userId).then((l) => dueMisses(l, now).length)),
    soft(freshInFollowed(userId, signals?.lastSeenAt || 0)),
    soft(nextLessonTitle(user)),
  ]);
  if (plan?.days != null) out.exam = { name: plan.exam, days: plan.days, weak: plan.focus?.[0]?.title || null };
  if (misses) out.misses = misses;
  if (fresh) out.fresh = fresh;
  if (nextTitle) out.nextTitle = nextTitle;
  return out;
}

/** The followed course with the most lessons made since the student was last here: { handle, count }. */
async function freshInFollowed(userId, since) {
  if (!since) return null;
  let best = null;
  for (const handle of (await followingOf(userId)).slice(0, 10)) {
    const ch = await getChannel(handle);
    if (!ch) continue;
    const count = (await channelLessonIds(ch, { limit: 20 })).filter((x) => x.at > since).length;
    if (count && (!best || count > best.count)) best = { handle: ch.handle, count };
  }
  return best;
}

/** The title of a ready lesson the student has not seen, in their first unit. */
async function nextLessonTitle(user) {
  const unitId = user.units?.[0] || (user.interests?.[0] ? `topic:${user.interests[0]}` : null);
  if (!unitId) return null;
  const ids = await db.readyIds(lessonKey(unitId, audienceFor(user)), 12);
  for (const id of ids) {
    if (await db.inSet(user.id, 'seen', id)) continue;
    const v = await db.getVideo(id);
    if (v?.lesson?.title) return v.lesson.title;
  }
  return null;
}

const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s));
const commentsUrl = (videoId) => `/?talk=1#v=${videoId}`;

/** The tutor answered a student's question in the comments. */
export function notifyTutorAnswer({ comment, reply }) {
  if (!comment?.userId) return Promise.resolve('off');
  return push.notifyNow(comment.userId, { kind: 'tutor', title: 'The tutor answered your question', body: clip(reply.text, 120), url: commentsUrl(comment.videoId), tag: `studygraph-c-${comment.id}` });
}

/** Someone replied to a student's comment. */
export function notifyReply({ parent, reply }) {
  if (!parent?.userId || parent.userId === reply.userId) return Promise.resolve('off');
  return push.notifyNow(parent.userId, { kind: 'reply', title: `${reply.name} replied to your comment`, body: clip(reply.text, 120), url: commentsUrl(parent.videoId), tag: `studygraph-c-${parent.id}` });
}

/** The cron entry point: smart study nudges with the context above. */
export const remindAll = (opts = {}) => push.remindDue({ ...opts, context: reminderContext });

/** For the admin numbers: which kinds were sent and opened today. */
export async function notificationStats(dayKey) {
  const h = (await kv.hgetall(`events:day:${dayKey}`)) || {};
  return Object.fromEntries(Object.entries(h).filter(([k]) => k.startsWith('push_')));
}
