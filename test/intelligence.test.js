// Using what students do: searches lean their feed and Explore, searches that find nothing
// become courses (with safeguards), care moments look after the student, and the admin
// insights report adds it all up. Also: the third-wave formats keep to their rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-intel-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
process.env.STUDYTOK_READY_AHEAD = '0';
process.env.STUDYTOK_EXPERIMENTS = 'off';
process.env.STUDYTOK_REQUIRE_SIGNIN = 'false';
process.env.STUDYTOK_SHEET_SECRET = 'test-secret';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const db = await import('../server/core/db.js');
const { saveProfile, searchIntent, publicVideo } = await import('../server/feed/index.js');
const { ingest, getSignals } = await import('../server/feed/events.js');
const d = await import('../server/feed/discover.js');
const gaps = await import('../server/feed/gaps.js');
const { careMoment, BREAK_AFTER_MS } = await import('../server/feed/moments.js');
const { sanitizeLesson } = await import('../server/lessons/schema.js');
const { SAMPLES } = await import('../server/lessons/samples.js');
const { handleApi } = await import('../server/app.js');

async function call(method, url, headers = {}) {
  const req = { method, url, headers: { host: 'sg.example', 'x-forwarded-proto': 'https', ...headers }, async *[Symbol.asyncIterator]() {} };
  const out = { status: 0, body: '' };
  const res = { headersSent: false, writeHead(s) { out.status = s; this.headersSent = true; }, end(b) { out.body = b == null ? '' : b.toString(); } };
  await handleApi(req, res);
  return out;
}
const student = () => saveProfile(null, { profile: { level: 'high-school', age: 21, managedBy: 'self' }, units: [], interests: ['space'] });

test('a search leans the student: kept in their signals, Explore taste and a day of feed intent', async () => {
  const s = await student();
  await ingest(s.id, { events: [{ type: 'search_submit', q: 'Photosynthesis in leaves', results: 4, where: 'enter' }, { type: 'search_submit', q: 'qwzx', results: 0 }] });
  const sig = await getSignals(s.id);
  assert.equal(sig.searches[0].q, 'qwzx');
  assert.equal(sig.searches[1].topic, 'biology');
  assert.equal(sig.explore.biology, 2);
  const intent = searchIntent(sig);
  assert.ok(intent.biology > 0.3);
  assert.deepEqual(searchIntent(sig, Date.now() + 2 * 86400000), {}, 'gone after a day');
  const day = new Date().toISOString().slice(0, 10);
  assert.equal(Number((await kv.hgetall(`events:day:${day}`)).search_zero), 1);
});

test('searches that find nothing become demand, counted by different students', async () => {
  const [a, b, c] = [await student(), await student(), await student()];
  await d.noteSearch(a.id, 'Kente weaving', false);
  await d.noteSearch(a.id, 'kente weaving', false); // same student, same day: once
  await d.noteSearch(b.id, 'Kente weaving', false);
  assert.equal((await d.searchGaps()).find((g) => g.q === 'kente weaving').students, 2);
  await d.noteSearch(c.id, 'Kente weaving', false);
  assert.equal((await d.searchGaps()).find((g) => g.q === 'kente weaving').students, 3);
  await d.noteSearch(a.id, 'porn', false); await d.noteSearch(b.id, 'porn', false); await d.noteSearch(c.id, 'porn', false);
  assert.equal((await d.searchGaps()).some((g) => g.q.includes('porn')), false, 'blocked words are never demand');
});

test('the most wanted missing topics become courses: checked, at most 2 a day, each once', async () => {
  const people = await Promise.all([1, 2, 3].map(student));
  for (const q of ['Chess endgames', 'Celebrity gossip', 'Origami cranes', 'Sign language basics']) for (const p of people) await d.noteSearch(p.id, q, false);
  const asked = [];
  const classify = async (q) => { asked.push(q); return q.includes('gossip') ? { ok: false, title: '' } : { ok: true, title: q.replace(/\b\w/g, (c) => c.toUpperCase()) }; };
  const started = [];
  const start = async (unit, audience) => { started.push({ unit, audience }); return { video: { id: 'x' }, done: Promise.resolve() }; };
  const r = await gaps.fillSearchGaps({ classify, start });
  assert.equal(r.made.length, 2, 'two a day');
  assert.ok(started.every((x) => x.audience.country === '' || !x.audience.country), 'lessons for no country');
  assert.ok(r.made.every((m) => m.handle), 'each gets a profile');
  assert.equal(r.made.some((m) => /gossip/i.test(m.title)), false);
  const again = await gaps.fillSearchGaps({ classify, start });
  assert.equal(again.made.length, 0, 'the day is used up');
  const tomorrow = await gaps.fillSearchGaps({ classify, start, now: Date.now() + 86400000 });
  assert.ok(tomorrow.made.length <= 2);
  const askedTwice = asked.filter((q, i) => asked.indexOf(q) !== i);
  assert.deepEqual(askedTwice, [], 'each query is decided once');
  // The check fails closed.
  assert.equal((await gaps.classifyGap('anything')).ok, false, 'no model configured');
  assert.equal((await gaps.classifyGap('x', { ask: async () => { throw new Error('down'); } })).ok, false);
});

test('care moments: a break for under-18s after 40 minutes, sleep at night, once a session', () => {
  const now = Date.now();
  const long = { sid: 's1', startedAt: now - BREAK_AFTER_MS - 1000 };
  assert.equal(careMoment({ session: { sid: 's1', startedAt: now - 60000 }, ctx: { minor: true }, now }), null);
  assert.equal(careMoment({ session: long, ctx: { minor: true }, now }).id, 'care-break');
  assert.equal(careMoment({ session: long, ctx: { minor: false }, now }), null, 'adults by day: no');
  assert.equal(careMoment({ session: { ...long, night: true }, ctx: { minor: false }, now }).id, 'care-sleep');
  assert.equal(careMoment({ session: long, ctx: { minor: true }, now, mark: { careSid: 's1' } }), null, 'once a session');
});

test('lessons carry real view counts and the viewer mastery for the progress after a quiz', async () => {
  const v = { id: crypto.randomUUID(), unitId: 'u1', topic: 'biology', status: 'ready', createdAt: new Date().toISOString(), lesson: { title: 't' } };
  await db.saveVideo(v);
  await kv.hincrby(`video:${v.id}:stats`, 'views', 42);
  const p = await publicVideo(v, null, { withDocument: false, unitMastery: 0.456 });
  assert.equal(p.views, 42);
  assert.equal(p.mastery, 0.46);
  assert.equal((await publicVideo(v, null, { withDocument: false })).mastery, undefined);
});

test('the third-wave formats keep to their rules (or fall back)', () => {
  for (const id of ['detective', 'teachback', 'numbers', 'zoom', 'interview', 'debate', 'connect', 'howto', 'redflags', 'personify', 'starterpack', 'plottwist', 'examiner', 'translate']) assert.equal(sanitizeLesson(SAMPLES[id], 'physics').format, id);
  // By the numbers needs real number visuals; without them it is an ordinary explainer.
  const plain = { ...SAMPLES.numbers, beats: SAMPLES.numbers.beats.map((b) => ({ ...b, visual: { ...b.visual, kind: 'footage', query: 'earth' } })) };
  assert.equal(sanitizeLesson(plain, 'physics').format, 'explain');
  // A case file with no solution is not a case file.
  assert.equal(sanitizeLesson({ ...SAMPLES.detective, fact: '' }, 'physics').format, 'explain');
  assert.throws(() => sanitizeLesson({ ...SAMPLES.howto, quiz: null }, 'physics'), /quiz/);
});

test('admin insights: secret required; searches, missing topics and the funnel', async () => {
  assert.equal((await call('GET', '/api/admin/insights')).status, 401);
  const r = await call('GET', '/api/admin/insights', { authorization: 'Bearer test-secret' });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.ok(Array.isArray(j.searches) && Array.isArray(j.missing));
  assert.ok(j.missing.some((m) => m.q === 'kente weaving' && m.students === 3));
  assert.ok('upNextTapRate' in j.funnel && 'coursesMadeFromSearches' in j.funnel);
  assert.ok(j.funnel.searches >= 2);
});
