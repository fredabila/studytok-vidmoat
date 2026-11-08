// Feed + storage behaviour against the in-memory KV backend (no network: every requested topic
// has ready library videos, so nothing is generated).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-feed-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.KV_REST_API_URL;

const { kv, usingRedis } = await import('../server/kv.js');
const db = await import('../server/db.js');
const { createUser, nextItems, recordEvent, publicVideo, setInterests } = await import('../server/feed.js');
const { TOPICS } = await import('../server/topics.js');

async function seed(topic, n) {
  for (let i = 0; i < n; i++) {
    const v = { id: crypto.randomUUID(), topic, status: 'ready', createdAt: new Date(Date.now() - i * 1000).toISOString(), lesson: { title: `${topic} ${i}`, hook: 'h' }, duration: 20 };
    await db.saveVideo(v);
    await db.setDocument(v.id, { version: 1, clips: [] });
    await db.markReady(v);
  }
}
for (const t of TOPICS) await seed(t.id, 4);

test('uses the local backend in tests', () => assert.equal(usingRedis, false));

test('local KV mimics the Redis commands used', async () => {
  await kv.sadd('s', 'a', 'b');
  assert.deepEqual(await kv.smismember('s', ['a', 'x', 'b']), [1, 0, 1]);
  await kv.zadd('z', { score: 1, member: 'one' }, { score: 3, member: 'three' }, { score: 2, member: 'two' });
  assert.deepEqual(await kv.zrange('z', 0, 1, { rev: true }), ['three', 'two']);
  assert.equal(await kv.hincrby('h', 'f', 2), 2);
  assert.deepEqual(await kv.hgetall('h'), { f: 2 });
  await kv.lpush('l', 'a'); await kv.lpush('l', 'b', 'c');
  assert.deepEqual(await kv.lrange('l', 0, -1), ['c', 'b', 'a']);
  const obj = { nested: [1, 2] };
  await kv.set('o', obj); obj.nested.push(3);
  assert.deepEqual(await kv.get('o'), { nested: [1, 2] }, 'values are copied, like a real store');
});

test('feed reuses ready library videos and never serves one twice', async () => {
  const user = await createUser(['biology', 'space']);
  const first = await nextItems(user.id, 3);
  const second = await nextItems(user.id, 3);
  assert.equal(first.pending.length + second.pending.length, 0, 'nothing generated');
  const ids = [...first.items, ...second.items].map((v) => v.id);
  assert.equal(new Set(ids).size, 6, 'no duplicates across pages');
  for (const id of ids) assert.ok(await db.inSet(user.id, 'served', id));
});

test('events: views and likes count once per viewer, unlike reverses', async () => {
  const user = await createUser(['math']);
  const [video] = (await nextItems(user.id, 1)).items;
  await recordEvent(user.id, { videoId: video.id, type: 'view' });
  await recordEvent(user.id, { videoId: video.id, type: 'view' });
  await recordEvent(user.id, { videoId: video.id, type: 'like' });
  await recordEvent(user.id, { videoId: video.id, type: 'like' });
  let s = await db.getStats(video.id);
  assert.equal(s.views, 1);
  assert.equal(s.likes, 1);
  await recordEvent(user.id, { videoId: video.id, type: 'unlike' });
  s = await db.getStats(video.id);
  assert.equal(s.likes, 0);
  assert.equal(await recordEvent(user.id, { videoId: 'nope', type: 'view' }), false);
});

test('engagement moves interest weights; "less" turns a topic down', async () => {
  const user = await createUser(['history']);
  const video = { id: crypto.randomUUID(), topic: 'history', status: 'ready', createdAt: new Date().toISOString() };
  await db.saveVideo(video);
  await recordEvent(user.id, { videoId: video.id, type: 'like' });
  assert.ok((await db.getUser(user.id)).interests.history > 1);
  await recordEvent(user.id, { videoId: video.id, type: 'less' });
  await recordEvent(user.id, { videoId: video.id, type: 'less' });
  assert.ok((await db.getUser(user.id)).interests.history <= 0.05 + 1e-9);
  const updated = await setInterests(user.id, ['history', 'math']);
  assert.ok(updated.interests.math === 1 && updated.interests.history > 0);
});

test('publicVideo includes the document only when ready', async () => {
  const user = await createUser([]);
  const [ready] = (await nextItems(user.id, 1)).items;
  assert.ok((await publicVideo(ready, user.id)).document);
  const gen = { id: crypto.randomUUID(), topic: 'math', status: 'generating', createdAt: new Date().toISOString() };
  await db.saveVideo(gen);
  assert.equal((await publicVideo(gen, user.id)).document, undefined);
});

test('a generation stuck for minutes reads as failed', async () => {
  const v = { id: crypto.randomUUID(), topic: 'math', status: 'generating', createdAt: new Date(Date.now() - 10 * 60_000).toISOString() };
  await db.saveVideo(v);
  assert.equal((await db.getVideo(v.id)).status, 'failed');
});
