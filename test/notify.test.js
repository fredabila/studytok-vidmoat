// Smart notifications (core/push.js pickReminder, backoffGap, notifyNow; feed/notify.js) with a
// recording sender instead of the push service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-notify-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
process.env.STUDYTOK_READY_AHEAD = '0';
process.env.STUDYTOK_VAPID_PUBLIC = 'BDdHjPz84S37W6x1z_ZUyu2DZRRJ5NBHvGZDyfpH1LLQnWN_pjci6YHV83Gk1yfgMRtest';
process.env.STUDYTOK_VAPID_PRIVATE = 'test-private-key';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const db = await import('../server/core/db.js');
const push = await import('../server/core/push.js');
const { emptySignals, day } = await import('../server/feed/events.js');
const comments = await import('../server/feed/comments.js');

const DAY = 86400000, HOUR = 3600000;
const sent = [];
push.setSender(async (sub, body) => { sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body) }); });
const at = (h, d = 10) => Date.UTC(2026, 2, d, h); // UTC = Accra
const base = (extra = {}) => ({ ...emptySignals(), device: { tz: 'Africa/Accra' }, ...extra });

test('quiet hours: adults 22-07, teens 21-07, under-13s 20-08', () => {
  assert.equal(push.isQuiet(23, 30), true);
  assert.equal(push.isQuiet(21, 30), false);
  assert.equal(push.isQuiet(21, 15), true);
  assert.equal(push.isQuiet(7, 10), true);
  assert.equal(push.isQuiet(8, 10), false);
  assert.equal(push.isQuiet(20, 10), true);
  // Nothing at all in quiet hours, even a streak at risk.
  const signals = base({ days: { [day(at(21) - DAY)]: 1, [day(at(21) - 2 * DAY)]: 1 } });
  assert.equal(push.pickReminder({ signals, progress: {}, now: at(21), age: 15 }), null);
  assert.equal(push.pickReminder({ signals, progress: {}, now: at(21), age: 30 }).kind, 'streak');
});

test('pickReminder: exam milestones name the weakest unit; questions to fix; new lessons; comeback with the next lesson', () => {
  const s = base();
  const exam = { name: 'WASSCE', days: 7, weak: 'Electricity' };
  const r = push.pickReminder({ signals: s, progress: {}, now: at(18), exam });
  assert.equal(r.kind, 'exam');
  assert.equal(r.title, 'WASSCE is in 7 days');
  assert.match(r.body, /Electricity needs the most work/);
  assert.equal(push.pickReminder({ signals: s, progress: {}, now: at(18), exam: { ...exam, days: 20 } }), null, 'not a milestone, far away');
  assert.equal(push.pickReminder({ signals: s, progress: {}, now: at(18), exam: { ...exam, days: 1 } }).title, 'WASSCE is tomorrow');
  assert.equal(push.pickReminder({ signals: s, progress: {}, now: at(18), misses: 4 }).kind, 'fix');
  const fresh = push.pickReminder({ signals: s, progress: {}, now: at(18), fresh: { handle: 'hs-biology', count: 3 } });
  assert.equal(fresh.kind, 'fresh');
  assert.equal(fresh.url, '/?c=hs-biology');
  const away = base({ lastSeenAt: at(18) - 4 * DAY });
  const cb = push.pickReminder({ signals: away, progress: {}, now: at(18), nextTitle: 'Why the sky is blue' });
  assert.equal(cb.kind, 'comeback');
  assert.match(cb.body, /Why the sky is blue/);
  assert.equal(push.pickReminder({ signals: base({ lastSeenAt: at(18) - 20 * DAY }), progress: {}, now: at(18) }), null, 'gone three weeks: no comeback nag');
  // Already studied today: no study nudge (a countdown milestone still goes).
  const active = base({ days: { [day(at(18))]: 1 } });
  assert.equal(push.pickReminder({ signals: active, progress: {}, now: at(18), misses: 5 }), null);
  assert.equal(push.pickReminder({ signals: active, progress: {}, now: at(18), exam }).kind, 'exam');
});

test('back-off: ignored nudges space out, ten stop them', () => {
  assert.equal(push.backoffGap(0), 20 * HOUR);
  assert.equal(push.backoffGap(3), 2 * DAY);
  assert.equal(push.backoffGap(6), 7 * DAY);
  assert.equal(push.backoffGap(10), Infinity);
});

test('remindDue: counts ignored nudges and resets them when the student comes back', async () => {
  const id = '21111111-1111-4111-8111-111111111111';
  await db.saveUser({ id, createdAt: new Date().toISOString(), profile: { level: 'university', age: 30 } });
  await db.indexUser({ id, createdAt: new Date().toISOString() });
  await push.subscribe(id, { endpoint: 'https://push.example/n1', keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } });
  const progress = { a: { box: 1, due: 1 }, b: { box: 1, due: 1 } };
  await kv.set(`user:${id}:progress`, progress);
  await kv.set(`user:${id}:signals`, base({ lastSeenAt: at(10, 1) }));
  for (let d = 2; d <= 5; d++) await push.remindDue({ now: at(18, d) });
  let state = await kv.get(`push:state:${id}`);
  assert.equal(state.ignored, 3, 'three nudges after the first without a visit');
  const before = sent.length;
  await push.remindDue({ now: at(18, 6) });
  assert.equal(sent.length, before, 'three ignored: the next one waits two days');
  await kv.set(`user:${id}:signals`, base({ lastSeenAt: at(19, 6) })); // came back
  await push.remindDue({ now: at(18, 7) });
  state = await kv.get(`push:state:${id}`);
  assert.equal(state.ignored, 0);
  assert.equal(sent.length, before + 1);
});

test('notifyNow: sends at once, holds during quiet hours and delivers in the morning, caps a day', async () => {
  const id = '31111111-1111-4111-8111-111111111111';
  await db.saveUser({ id, createdAt: new Date().toISOString(), profile: { level: 'university', age: 30 } });
  await db.indexUser({ id, createdAt: new Date().toISOString() });
  await kv.set(`user:${id}:signals`, base({ lastSeenAt: at(12, 9) }));
  await push.subscribe(id, { endpoint: 'https://push.example/n2', keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } });
  assert.equal(await push.notifyNow(id, { kind: 'reply', title: 'x', body: 'y', url: '/' }, { now: at(12, 9) }), 'sent');
  assert.equal(await push.notifyNow(id, { kind: 'reply', title: 'late', body: 'night reply', url: '/' }, { now: at(23, 9) }), 'queued');
  const n = sent.length;
  await push.remindDue({ now: at(7, 10) }); // still quiet for nobody: 07:00 is open for adults
  assert.equal(sent.at(-1).payload.body, 'night reply');
  assert.ok(sent.length > n);
  for (let i = 0; i < 3; i++) await push.notifyNow(id, { kind: 'reply', title: 't', body: 'b', url: '/' }, { now: at(13, 11) });
  assert.equal(await push.notifyNow(id, { kind: 'reply', title: 't', body: 'b', url: '/' }, { now: at(13, 11) }), 'sent');
  assert.equal(await push.notifyNow(id, { kind: 'reply', title: 't', body: 'b', url: '/' }, { now: at(13, 11) }), 'capped');
});

test('comments: a reply and a tutor answer notify the author (not themselves)', async () => {
  const author = { id: '41111111-1111-4111-8111-111111111111', vidmoat: { name: 'Ama Kumi' }, profile: { age: 30 } };
  const other = { id: '51111111-1111-4111-8111-111111111111', vidmoat: { name: 'Kofi Boateng' }, profile: { age: 30 } };
  for (const u of [author, other]) { await db.saveUser({ ...u, createdAt: new Date().toISOString() }); await kv.set(`user:${u.id}:signals`, base()); }
  await push.subscribe(author.id, { endpoint: 'https://push.example/author', keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } });
  const ok = async () => ({ ok: true });
  const vid = crypto.randomUUID();
  const now = Date.now();
  const q = await comments.postComment({ user: author, videoId: vid, text: 'Why is the sky blue?', moderate: ok, now });
  const before = sent.filter((x) => x.endpoint.endsWith('/author')).length;
  await comments.postComment({ user: other, videoId: vid, text: 'Good question', parentId: q.comment.id, moderate: ok, now: now + 1000 });
  await comments.tutorReply({ commentId: q.comment.id, video: { id: vid }, answer: async () => ({ answer: 'Shorter blue wavelengths scatter more in the air.', onTopic: true }) });
  await comments.postComment({ user: author, videoId: vid, text: 'Thanks both', parentId: q.comment.id, moderate: ok, now: now + 30_000 });
  const mine = sent.filter((x) => x.endpoint.endsWith('/author')).slice(before).map((x) => x.payload);
  const hour = new Date().getUTCHours();
  if (!push.isQuiet(hour, 30)) {
    assert.deepEqual(mine.map((p) => p.kind), ['reply', 'tutor'], 'their own reply does not notify them');
    assert.equal(mine[0].title, 'Kofi B. replied to your comment');
    assert.equal(mine[1].url, `/?talk=1#v=${vid}`);
  }
});
