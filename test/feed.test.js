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

const { kv, usingRedis, findRedisCredentials } = await import('../server/core/kv.js');
const db = await import('../server/core/db.js');
const { saveProfile, nextItems, recordEvent, publicVideo, library, getProgress, audienceFor } = await import('../server/feed/index.js');
const { lessonKey } = await import('../server/lessons/index.js');
const { CATALOG } = await import('../server/curriculum/catalog.js');
const { resolveProgram } = await import('../server/curriculum/index.js');

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

test('under-18s must be set up by a parent or guardian, with consent; children get their own lesson key', async () => {
  const { checkAgeRules, cleanProfile } = await import('../server/feed/index.js');
  assert.equal(cleanProfile({ age: '16', managedBy: 'guardian' }).age, 16);
  assert.equal(cleanProfile({ age: 3 }).age, null, 'out-of-range ages are dropped');
  assert.throws(() => checkAgeRules(cleanProfile({ age: 15 })), /parent or guardian/);
  assert.throws(() => checkAgeRules(cleanProfile({ age: 15, managedBy: 'guardian' })), /confirm/);
  checkAgeRules(cleanProfile({ age: 15, managedBy: 'guardian' }), { guardianConsent: true });
  checkAgeRules(cleanProfile({ age: 30 }));
  await assert.rejects(saveProfile(null, { profile: { level: 'high-school', age: 12 } }), /parent or guardian/);
  const kid = await saveProfile(null, { profile: { level: 'middle-school', age: 11, managedBy: 'guardian' }, guardianConsent: true });
  assert.ok(kid.guardianConsentAt);
  const a = audienceFor(kid);
  assert.ok(a.child && a.minor && a.lessonStyle.includes('age:child'), 'children get separate lessons');
  assert.ok(!audienceFor(await saveProfile(null, { profile: { level: 'university', age: 19 } })).minor);
  const again = await saveProfile(kid.id, { profile: { ...kid.profile }, units: [] });
  assert.ok(again.guardianConsentAt, 'consent is kept on later edits without re-asking');
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
  // Videos made before the quiz hold existed get a hold point 3 s before the reveal (their think pause).
  assert.equal(pub.quiz.hold, 20, 'legacy quiz {from: 20, reveal: 23} holds at reveal - 3, never before from');
  const held = { ...gen, id: crypto.randomUUID(), status: 'ready', quiz: { question: 'q', options: ['a', 'b', 'c'], answerIndex: 0, from: 10, hold: 14.5, reveal: 18 } };
  await db.saveVideo(held);
  assert.equal((await publicVideo(held, user.id, { withDocument: false })).quiz.hold, 14.5, 'a stored hold is kept');
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

test('students can add their own topics, file them in a course, and toggle units', async () => {
  const { editProfile, DEFAULT_PREFS, audienceFor } = await import('../server/feed/index.js');
  const user = await saveProfile(null, { profile, programKeys: ['cat:hs-biology'], units: bio.units.map((u) => u.id) });
  const { user: u1, added } = await editProfile(user.id, { addCustom: { title: 'Python decorators', programKey: 'cat:hs-biology' } });
  assert.ok(added.id.startsWith('cu:'));
  assert.equal(added.topic, 'computer-science', 'topic guessed from the title');
  assert.ok(u1.units.includes(added.id));
  assert.equal(u1.unitGroups[added.id], 'cat:hs-biology');
  const { added: again } = await editProfile(user.id, { addCustom: { title: 'python decorators' } });
  assert.equal(again.id, added.id, 'the same topic typed by anyone shares one unit');
  const { user: u2 } = await editProfile(user.id, { units: [bio.units[0].id, added.id], removeUnit: added.id, prefs: { voice: 'off', length: 'deep', difficulty: 'bogus' } });
  assert.deepEqual(u2.units, [bio.units[0].id]);
  assert.deepEqual(u2.prefs, { ...DEFAULT_PREFS, voice: 'off', length: 'deep' });
  const a = audienceFor(u2);
  assert.equal(a.lessonStyle, '|l:deep', 'only non-default lesson preferences change the lesson key');
  assert.equal(lessonKey('x', a), 'x|high-school|wassce|l:deep');
  const lib = await library(user.id);
  assert.equal(lib.units.filter((u) => u.active).length, 1);
  assert.equal(lib.units.length, bio.units.length, 'inactive course units stay listed so they can be re-added');
});

test('ready-first: a generating unit never blocks the page when another unit is ready', async () => {
  const { readyKeyFor } = await import('../server/video/generator.js');
  // A course whose units 2.. have ready videos but unit 1 has none. Generation is stubbed by
  // leaving the library empty for that unit and checking the page order.
  const prof = { level: 'university', program: 'Law', exam: '' };
  const law = CATALOG.find((p) => p.id === 'uni-law');
  const aud = audienceFor({ profile: prof });
  for (const u of law.units.slice(1)) await seed(u.id, 'law', aud, 2);
  const user = await saveProfile(null, { profile: prof, programKeys: ['cat:uni-law'], units: law.units.map((u) => u.id) });
  process.env.STUDYTOK_READY_AHEAD = '0';
  const { items, pending } = await nextItems(user.id, 3);
  const statuses = items.map((x) => x.video.status);
  assert.equal(statuses[0], 'ready', 'the page opens with a ready video');
  assert.ok(statuses.every((st) => st === 'ready'), 'nothing on the page is still being made when ready videos exist');
  assert.equal(pending.length, 1, 'the missing unit 1 is started in the background');
  const generating = await kv.lrange(`user:${user.id}:generating`, 0, 5);
  const v = await db.getVideo(generating[0]);
  assert.equal(v.unitId, law.units[0].id);
  assert.equal(readyKeyFor(law.units[0].id, { ...aud, prefs: { voice: 'off' } }).endsWith('|novoice'), true);
});

test('a flagging session gets one breather first, which never touches progress, then the syllabus continues', async () => {
  const { breatherUnits } = await import('../server/feed/breathers.js');
  const user = await saveProfile(null, { profile, programKeys: ['cat:hs-biology'], units: bio.units.map((u) => u.id) });
  const funUnits = breatherUnits('biology');
  for (const u of funUnits) await seed(u.id, 'biology', audience, 2);
  await kv.set(`user:${user.id}:session`, { sid: 's', startedAt: Date.now(), lastAt: Date.now(), viewed: 8, earlyStreak: 2, lastFormats: [], lastTopics: ['biology'] });
  const page = await nextItems(user.id, 3);
  assert.equal(page.pending.length, 0, 'the breather came from the library');
  assert.equal(page.items[0].why.kind, 'breather');
  assert.equal(page.items[0].why.reason, 'leaving-early');
  const fun = funUnits.find((u) => u.id === page.items[0].unit.id);
  assert.ok(fun, 'a biology breather');
  const pub = await publicVideo(page.items[0].video, user.id, { why: page.items[0].why, withDocument: false });
  assert.equal(pub.breather.reason, 'leaving-early'); assert.match(pub.breather.text, /fun one next door/);
  assert.equal((await getProgress(user.id))[fun.id], undefined, 'a breather is not syllabus progress');
  await recordEvent(user.id, { videoId: page.items[0].video.id, type: 'view' });
  await recordEvent(user.id, { videoId: page.items[0].video.id, type: 'leave', pct: 0.9, watched: 18 });
  assert.equal((await getProgress(user.id))[fun.id], undefined, 'events on it do not create progress either');
  const mark = await kv.get(`user:${user.id}:breather`);
  assert.equal(mark.count, 1); assert.equal(mark.at, 8, 'the marker remembers where in the session it fired');
  assert.equal((await db.getUser(user.id)).billing?.houseUsed || 0, 0, 'a breather never touches the free allowance');
  // An events batch rewrites the whole session; the breather marker must survive it.
  await recordEvent(user.id, { videoId: page.items[1].video.id, type: 'view' });
  assert.equal((await kv.get(`user:${user.id}:breather`)).count, 1, 'the marker is outside the session object');
  const next = await nextItems(user.id, 3);
  assert.ok(next.items.every((x) => x.why.kind !== 'breather'), 'no second breather right away');
});
