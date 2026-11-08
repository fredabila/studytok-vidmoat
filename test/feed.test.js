// Feed + storage behaviour against the in-memory KV backend. Every candidate unit has ready
// library videos and prefetch is off, so nothing is generated and nothing touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-feed-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
process.env.STUDYTOK_READY_AHEAD = '0';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv, usingRedis, findRedisCredentials } = await import('../server/kv.js');
const db = await import('../server/db.js');
const { saveProfile, nextItems, recordEvent, publicVideo, library, getProgress, audienceFor } = await import('../server/feed.js');
const { lessonKey } = await import('../server/lessons/index.js');
const { CATALOG } = await import('../server/catalog.js');
const { resolveProgram } = await import('../server/curriculum.js');

const bio = CATALOG.find((p) => p.id === 'hs-biology');
const profile = { level: 'high-school', country: 'Ghana', institution: 'Achimota School', program: 'Biology', exam: 'WASSCE' };

async function seed(unitId, topic, audience, n) {
  for (let i = 0; i < n; i++) {
    const v = { id: crypto.randomUUID(), unitId, unitTitle: unitId, topic, level: audience.level, readyKey: lessonKey(unitId, audience), status: 'ready',
      createdAt: new Date(Date.now() - i * 1000).toISOString(), lesson: { title: `${unitId} ${i}`, hook: 'h' }, duration: 20,
      quiz: { question: 'q', options: ['a', 'b', 'c'], answerIndex: 1, from: 20, reveal: 23 } };
    await db.saveVideo(v);
    await db.setDocument(v.id, { version: 1, clips: [] });
    await db.markReady(v);
  }
}

const audience = audienceFor({ profile });
for (const u of bio.units) await seed(u.id, 'biology', audience, 6);
await seed('topic:space', 'space', audience, 6);

test('uses the local backend in tests', () => assert.equal(usingRedis, false));

test('local KV mimics the Redis commands used', async () => {
  await kv.sadd('s', 'a', 'b');
  assert.deepEqual(await kv.smismember('s', ['a', 'x', 'b']), [1, 0, 1]);
  await kv.zadd('z', { score: 1, member: 'one' }, { score: 3, member: 'three' }, { score: 2, member: 'two' });
  assert.deepEqual(await kv.zrange('z', 0, 1, { rev: true }), ['three', 'two']);
  assert.equal(await kv.zincrby('z', 5, 'one'), 6);
  assert.equal(await kv.hincrby('h', 'f', 2), 2);
  await kv.rpush('q', { a: 1 }, { a: 2 });
  assert.deepEqual(await kv.lpop('q'), { a: 1 });
  assert.equal(await kv.set('lock', 1, { nx: true }), 'OK');
  assert.equal(await kv.set('lock', 2, { nx: true }), null);
  const obj = { nested: [1, 2] };
  await kv.set('o', obj); obj.nested.push(3);
  assert.deepEqual(await kv.get('o'), { nested: [1, 2] }, 'values are copied, like a real store');
});

test('a catalog course resolves instantly with ordered units', async () => {
  const { program, pending } = await resolveProgram(profile);
  assert.equal(program.status, 'ready');
  assert.equal(program.key, 'cat:hs-biology');
  assert.equal(pending, null);
  assert.equal(program.units[0].title, 'Cell Biology');
});

test('feed serves course units from the library, never the same video twice', async () => {
  const user = await saveProfile(null, { profile, programKeys: ['cat:hs-biology'], units: bio.units.map((u) => u.id), interests: ['space'] });
  const a = await nextItems(user.id, 3);
  const b = await nextItems(user.id, 3);
  assert.equal(a.pending.length + b.pending.length, 0, 'nothing generated');
  const ids = [...a.items, ...b.items].map((x) => x.video.id);
  assert.equal(new Set(ids).size, 6);
  assert.ok(a.items.every((x) => x.why), 'each pick explains itself');
  const units = [...a.items, ...b.items].map((x) => x.unit.id);
  assert.ok(units.includes(bio.units[0].id), 'the first syllabus unit comes up early');
});

test('events update stats, progress and the library', async () => {
  const user = await saveProfile(null, { profile, programKeys: ['cat:hs-biology'], units: bio.units.map((u) => u.id) });
  const [{ video }] = (await nextItems(user.id, 1)).items;
  for (const type of ['view', 'view', 'like', 'like', 'save', 'complete']) await recordEvent(user.id, { videoId: video.id, type });
  await recordEvent(user.id, { videoId: video.id, type: 'quiz_answer', correct: true });
  await recordEvent(user.id, { videoId: video.id, type: 'quiz_answer', correct: false }); // only the first answer counts
  const s = await db.getStats(video.id);
  assert.deepEqual([s.views, s.likes, s.saves, s.completes, s.quizRight, s.quizWrong], [1, 1, 1, 1, 1, 0]);
  const progress = (await getProgress(user.id))[video.unitId];
  assert.equal(progress.quizRight, 1);
  assert.ok(progress.box >= 1);
  await recordEvent(user.id, { videoId: video.id, type: 'unlike' });
  assert.equal((await db.getStats(video.id)).likes, 0);
  const lib = await library(user.id);
  assert.equal(lib.saved.length, 1);
  assert.equal(lib.history[0].id, video.id);
  assert.equal(lib.units.length, bio.units.length);
  assert.equal(await recordEvent(user.id, { videoId: 'nope', type: 'view' }), false);
});

test('a profile with nothing chosen falls back to every interest topic', async () => {
  const user = await saveProfile(null, { profile: { level: 'lifelong' } });
  assert.ok(user.interests.length >= 10);
  assert.equal(user.profile.level, 'lifelong');
  const bad = await saveProfile(null, { profile: { level: 'nonsense', program: 'x'.repeat(500) }, interests: ['space', 'hacking'] });
  assert.equal(bad.profile.level, 'lifelong');
  assert.ok(bad.profile.program.length <= 120);
  assert.deepEqual(bad.interests, ['space']);
});

test('publicVideo includes the document and quiz only when ready', async () => {
  const user = await saveProfile(null, { profile, units: [bio.units[0].id] });
  const [{ video }] = (await nextItems(user.id, 1)).items;
  const pub = await publicVideo(video, user.id);
  assert.ok(pub.document && pub.quiz && pub.unit);
  const gen = { id: crypto.randomUUID(), topic: 'math', status: 'generating', createdAt: new Date().toISOString() };
  await db.saveVideo(gen);
  const p2 = await publicVideo(gen, user.id);
  assert.equal(p2.document, undefined);
  assert.equal(p2.quiz, null);
});

test('a generation stuck for minutes reads as failed', async () => {
  const v = { id: crypto.randomUUID(), topic: 'math', status: 'generating', createdAt: new Date(Date.now() - 10 * 60_000).toISOString() };
  await db.saveVideo(v);
  assert.equal((await db.getVideo(v.id)).status, 'failed');
});

test('finds Upstash credentials under default, Upstash and custom prefixes', () => {
  const u = 'https://x.upstash.io';
  assert.equal(findRedisCredentials({ KV_REST_API_URL: u, KV_REST_API_TOKEN: 't' }).urlVar, 'KV_REST_API_URL');
  assert.equal(findRedisCredentials({ UPSTASH_REDIS_REST_URL: u, UPSTASH_REDIS_REST_TOKEN: 't' }).urlVar, 'UPSTASH_REDIS_REST_URL');
  assert.equal(findRedisCredentials({ STORAGE_KV_REST_API_URL: u, STORAGE_KV_REST_API_TOKEN: 't' }).urlVar, 'STORAGE_KV_REST_API_URL');
  assert.equal(findRedisCredentials({ KV_REST_API_URL: u }), null, 'needs a token');
  assert.equal(findRedisCredentials({ REDIS_URL: 'rediss://x' }), null, 'TCP URLs are not REST credentials');
});
