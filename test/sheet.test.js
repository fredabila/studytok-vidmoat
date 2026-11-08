// The Google Sheet mirror: row shapes and the throttled, never-throwing sync (fetch is faked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-sheet-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
process.env.STUDYTOK_READY_AHEAD = '0';
process.env.STUDYTOK_SHEET_URL = 'https://script.google.com/macros/s/fake/exec';
process.env.STUDYTOK_SHEET_SECRET = 'shh';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const db = await import('../server/core/db.js');
const { ingest } = await import('../server/feed/events.js');
const { saveProfile, linkVidmoat } = await import('../server/feed/index.js');
const sheet = await import('../server/core/sheet.js');

const calls = [];
globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ ok: true, results: [] }), { status: 200 }); };

test('userRow flattens a student into the sheet columns', async () => {
  const { user: u0 } = await linkVidmoat(null, { id: 'vm-1', name: 'Ama', email: 'ama@example.com' });
  const user = await saveProfile(u0.id, { profile: { level: 'high-school', program: 'Biology', country: 'Ghana', age: 20 }, units: ['hs-biology-1'] });
  const v = { id: crypto.randomUUID(), unitId: 'hs-biology-1', unitTitle: 'Cells', topic: 'biology', level: 'high-school', readyKey: 'k', status: 'ready', format: 'explain', createdAt: new Date().toISOString(), duration: 40 };
  await db.saveVideo(v);
  const now = Date.now();
  await ingest(user.id, { ctx: { sid: 's1', platform: 'Android', standalone: true, tz: 'Africa/Accra', lang: 'en-GB' }, events: [
    { type: 'view', videoId: v.id, at: now }, { type: 'quiz_answer', videoId: v.id, correct: true, choice: 0, ms: 900, at: now + 1000 },
    { type: 'like', videoId: v.id, at: now + 2000 }, { type: 'profile_share', at: now + 3000 },
  ] });
  const row = await sheet.userRow(await db.getUser(user.id));
  assert.equal(row['Member #'], 1); assert.equal(row.Name, 'Ama'); assert.equal(row.Email, 'ama@example.com');
  assert.equal(row.Level, 'High School / Senior High'); assert.equal(row.Course, 'Biology'); assert.equal(row.Age, 20); assert.equal(row['Managed by'], 'self');
  assert.equal(row['Lessons watched'], 1); assert.equal(row.Quizzes, 1); assert.equal(row['Quiz accuracy'], '100%'); assert.equal(row.Likes, 1); assert.equal(row.Shares, 1);
  assert.equal(row['Day streak'], 1); assert.equal(row.Device, 'installed app'); assert.equal(row.Platform, 'Android'); assert.equal(row['Time zone'], 'Africa/Accra');
  assert.equal(row['Billing mode'], 'free allowance'); assert.equal(row['Set up'], 'yes');
  assert.match(row.Joined, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
});

test('syncUser posts an upsert (and a Joins line for an event), throttles repeats, indexes the user', async () => {
  const id = (await kv.zrange('users:active', 0, -1))[0];
  calls.length = 0;
  await sheet.syncUser(id, { event: 'joined', detail: 'ama@example.com' });
  assert.equal(calls.length, 1);
  const { body } = calls[0];
  assert.equal(body.secret, 'shh');
  assert.deepEqual(body.ops.map((o) => [o.op, o.tab]), [['upsert', 'Users'], ['append', 'Joins']]);
  assert.equal(body.ops[0].key, 'User ID'); assert.equal(body.ops[0].rows[0]['User ID'], id);
  assert.equal(body.ops[1].rows[0].Event, 'joined');
  await sheet.syncUser(id); // within ten minutes, no event: skipped
  assert.equal(calls.length, 1);
  await sheet.syncUser(id, { force: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(await kv.zrange('users', 0, -1), [id]);
});

test('dailyRow counts the day; resyncAll walks the index; a failing sheet never throws', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const row = await sheet.dailyRow(today);
  assert.equal(row.Date, today); assert.equal(row['New students'], 1); assert.equal(row['Total students'], 1); assert.equal(row['Active students'], 1);
  assert.equal(row['Lessons watched'], 1); assert.equal(row['Quiz accuracy'], '100%'); assert.equal(row.Shares, 1);
  calls.length = 0;
  const r = await sheet.resyncAll();
  assert.deepEqual([r.users, r.sent], [1, 1]);
  assert.equal(calls.at(-1).body.ops[0].tab, 'Daily');
  globalThis.fetch = async () => { throw new Error('boom'); };
  const bad = await sheet.syncUser((await kv.zrange('users', 0, -1))[0], { force: true });
  assert.equal(bad.ok, false);
});
