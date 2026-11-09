// Web Push reminders (server/core/push.js) against the in-memory KV, with the push service
// replaced by a recording sender: nothing touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-push-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
process.env.STUDYTOK_READY_AHEAD = '0';
// Any well-formed pair works: the sender is stubbed, so the keys never sign anything.
process.env.STUDYTOK_VAPID_PUBLIC = 'BDdHjPz84S37W6x1z_ZUyu2DZRRJ5NBHvGZDyfpH1LLQnWN_pjci6YHV83Gk1yfgMRtest';
process.env.STUDYTOK_VAPID_PRIVATE = 'test-private-key';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const db = await import('../server/core/db.js');
const push = await import('../server/core/push.js');
const { emptySignals, day } = await import('../server/feed/events.js');

const DAY = 86400000, HOUR = 3600000;
const sent = []; // every call the stub receives: { endpoint, payload }
let failWith = {}; // endpoint -> status code the stub should throw
push.setSender(async (sub, body) => {
  if (failWith[sub.endpoint]) throw Object.assign(new Error('gone'), { statusCode: failWith[sub.endpoint] });
  sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body) });
});

const subFor = (n) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } });
async function student(id, { signals = {}, progress = {} } = {}) {
  const user = { id, createdAt: new Date(Date.now() - 10 * DAY).toISOString(), profile: { level: 'high-school' } };
  await db.saveUser(user);
  await db.indexUser(user);
  await kv.set(`user:${id}:signals`, { ...emptySignals(), ...signals });
  await kv.set(`user:${id}:progress`, progress);
  return id;
}
// 18:00 local in Accra (UTC+0) on a fixed day; `days` holds the UTC day keys the streak counts.
const NOW = Date.parse('2026-03-10T18:00:00Z');
const daysBefore = (n, from = NOW) => Object.fromEntries(Array.from({ length: n }, (_, i) => [day(from - (i + 1) * DAY), 1]));

test('reminders are enabled with both VAPID keys and expose the public key', () => {
  assert.equal(push.enabled(), true);
  assert.equal(push.publicKey(), process.env.STUDYTOK_VAPID_PUBLIC);
});

test('subscribe dedupes by endpoint, keeps at most five devices; unsubscribe drops one', async () => {
  const id = await student('11111111-1111-4111-8111-111111111111');
  await push.subscribe(id, subFor(1));
  await push.subscribe(id, subFor(1));
  assert.equal((await push.subscriptions(id)).length, 1, 'same endpoint twice is one device');
  for (let i = 2; i <= 7; i++) await push.subscribe(id, subFor(i));
  const list = await push.subscriptions(id);
  assert.equal(list.length, 5);
  assert.deepEqual(list.map((s) => s.endpoint), [3, 4, 5, 6, 7].map((n) => subFor(n).endpoint), 'oldest devices are dropped');
  await push.unsubscribe(id, subFor(5).endpoint);
  assert.equal((await push.subscriptions(id)).length, 4);
  await assert.rejects(push.subscribe(id, { endpoint: 'http://insecure', keys: {} }), /Invalid/);
});

test('pickReminder: streak at risk at 18:00 local with no activity today', () => {
  const signals = { ...emptySignals(), days: daysBefore(3), device: { tz: 'Africa/Accra' } };
  const r = push.pickReminder({ signals, progress: {}, now: NOW });
  assert.equal(r.body, 'Your 3-day streak ends tonight. One lesson keeps it.');
  assert.equal(r.tag, 'studytok-reminder'); assert.equal(r.url, '/#feed');
  // Already active today: nothing to save.
  assert.equal(push.pickReminder({ signals: { ...signals, days: { ...signals.days, [day(NOW)]: 1 } }, progress: {}, now: NOW }), null);
  // Same instant is 10:00 in Los Angeles: too early to nag.
  assert.equal(push.pickReminder({ signals: { ...signals, device: { tz: 'America/Los_Angeles' } }, progress: {}, now: NOW }), null);
  // A 1-day streak is not worth a push.
  assert.equal(push.pickReminder({ signals: { ...signals, days: daysBefore(1) }, progress: {}, now: NOW }), null);
});

test('pickReminder: reviews due when two or more units are overdue', () => {
  const progress = { a: { box: 1, due: NOW - HOUR }, b: { box: 0, due: NOW - DAY }, c: { box: 2, due: NOW + DAY }, d: { box: -1, due: 0 } };
  const r = push.pickReminder({ signals: emptySignals(), progress, now: NOW });
  assert.equal(r.body, '2 units are due for review. 5 minutes brings them back.');
  assert.equal(push.pickReminder({ signals: emptySignals(), progress: { a: progress.a }, now: NOW }), null, 'one unit is not enough');
});

test('remindDue sends one message per student, skips students without devices, throttles for 20 hours', async () => {
  sent.length = 0;
  const streaky = await student('22222222-2222-4222-8222-222222222222', { signals: { days: daysBefore(4), device: { tz: 'Africa/Accra' } } });
  const reviewer = await student('33333333-3333-4333-8333-333333333333', { progress: { a: { box: 1, due: NOW - HOUR }, b: { box: 0, due: NOW - HOUR } } });
  const quiet = await student('44444444-4444-4444-8444-444444444444', { progress: { a: { box: 1, due: NOW - HOUR }, b: { box: 0, due: NOW - HOUR } } });
  await student('55555555-5555-4555-8555-555555555555', { signals: { days: daysBefore(4) } }); // no subscription
  await push.subscribe(streaky, subFor('s1'));
  await push.subscribe(streaky, subFor('s2'));
  await push.subscribe(reviewer, subFor('r1'));
  await push.subscribe(quiet, subFor('q1'));
  await kv.set(`push:last:${quiet}`, NOW - 2 * HOUR); // reminded two hours ago

  const r = await push.remindDue({ now: NOW });
  assert.equal(r.users, 4, 'four students have a device (the first test left one)');
  assert.equal(r.sent, 3, 'two devices for the streak, one for the reviews');
  assert.ok(sent.find((s) => s.endpoint === subFor('s1').endpoint).payload.body.startsWith('Your 4-day streak'));
  assert.ok(sent.find((s) => s.endpoint === subFor('r1').endpoint).payload.body.startsWith('2 units are due'));
  assert.equal(sent.some((s) => s.endpoint === subFor('q1').endpoint), false, 'throttled student got nothing');
  assert.equal(Number(await kv.get(`push:last:${streaky}`)), NOW);
  assert.equal(Number((await kv.hgetall(`events:day:${day(NOW)}`)).push_sent), 3);

  // Twelve hours later nothing goes out (throttled); twenty-one hours later it is 15:00, nobody's
  // usual hour and outside the evening window, so still nothing; at 18:00 the next day the
  // reviews are due again.
  sent.length = 0;
  assert.equal((await push.remindDue({ now: NOW + 12 * HOUR })).sent, 0);
  assert.equal((await push.remindDue({ now: NOW + 21 * HOUR })).sent, 0, 'reminders wait for the student\'s usual hour');
  const later = await push.remindDue({ now: NOW + 24 * HOUR });
  assert.ok(later.sent >= 1);
  assert.ok(sent.some((s) => s.payload.body.includes('due for review')));
});

test('a 410 from the push service removes that subscription and keeps the others', async () => {
  sent.length = 0;
  const id = await student('66666666-6666-4666-8666-666666666666');
  await push.subscribe(id, subFor('dead'));
  await push.subscribe(id, subFor('alive'));
  failWith = { [subFor('dead').endpoint]: 410 };
  const n = await push.sendTo(id, { title: 'StudyTok', body: 'test', url: '/', tag: 'studytok-reminder' });
  failWith = {};
  assert.equal(n, 1);
  assert.deepEqual((await push.subscriptions(id)).map((s) => s.endpoint), [subFor('alive').endpoint]);
  // A transient failure (500) keeps the device.
  failWith = { [subFor('alive').endpoint]: 500 };
  assert.equal(await push.sendTo(id, { title: 't', body: 'b' }), 0);
  failWith = {};
  assert.equal((await push.subscriptions(id)).length, 1);
});
