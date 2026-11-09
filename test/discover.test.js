// Explore (feed/discover.js): the personalised grid, course suggestions, typeahead, search and
// trending searches. Region rules apply everywhere: never another country's lessons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-discover-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
process.env.STUDYTOK_READY_AHEAD = '0';
process.env.STUDYTOK_EXPERIMENTS = 'off';
process.env.STUDYTOK_REQUIRE_SIGNIN = 'false';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const db = await import('../server/core/db.js');
const d = await import('../server/feed/discover.js');
const { saveProfile } = await import('../server/feed/index.js');
const { getSignals } = await import('../server/feed/events.js');
const { handleApi } = await import('../server/app.js');
const ch = await import('../server/feed/channels.js');
const { CATALOG } = await import('../server/curriculum/catalog.js');

const bio = CATALOG.find((p) => p.id === 'hs-biology');
const phys = CATALOG.find((p) => p.id === 'hs-physics') || CATALOG.find((p) => p.topic === 'physics');
let n = 0;
async function lesson(unitId, topic, { loc = null, title, level = 'high-school', stats = null } = {}) {
  const v = { id: crypto.randomUUID(), unitId, unitTitle: unitId, topic, level, loc, readyKey: `${unitId}|${level}|`, status: 'ready', format: 'explain',
    createdAt: new Date(Date.now() - (n++) * 1000).toISOString(), duration: 30, lesson: { title: title || `${topic} lesson ${n}`, hook: 'a hook' } };
  await db.saveVideo(v); await db.markReady(v);
  if (stats) for (const [k, x] of Object.entries(stats)) await kv.hincrby(`video:${v.id}:stats`, k, x);
  return v;
}
const ghTrotro = await lesson(bio.units[0].id, 'biology', { loc: 'ghana', title: 'Osmosis on a trotro ride' });
const ukTube = await lesson(bio.units[0].id, 'biology', { loc: 'united-kingdom', title: 'Osmosis on the Tube' });
const any1 = await lesson(bio.units[1].id, 'biology', { title: 'Why cells are small' });
for (let i = 0; i < 4; i++) await lesson(bio.units[2].id, 'biology', { title: `Enzymes ${i}` });
const physLessons = [];
for (let i = 0; i < 3; i++) physLessons.push(await lesson(phys.units[i].id, 'physics', { title: `Forces and motion ${i}`, stats: { views: 10, completes: 9, likes: 4 } }));
await ch.ensureChannel(`cat:${bio.id}`);
await ch.ensureChannel(`cat:${phys.id}`);
await d.discoverPool({ force: true });
d.resetSearchCache();

async function call(method, url, cookie) {
  const req = { method, url, headers: { host: 'sg.example', 'x-forwarded-proto': 'https', ...(cookie ? { cookie: `st_uid=${cookie}` } : {}) }, async *[Symbol.asyncIterator]() {} };
  const out = { status: 0, body: '' };
  const res = { headersSent: false, writeHead(s) { out.status = s; this.headersSent = true; }, end(b) { out.body = b == null ? '' : b.toString(); } };
  await handleApi(req, res);
  out.json = () => JSON.parse(out.body);
  return out;
}

test('the grid: unseen lessons from your country or none, never another country', async () => {
  const uk = await saveProfile(null, { profile: { level: 'high-school', country: 'UK', age: 21, managedBy: 'self' }, units: [], interests: ['physics'] });
  const grid = await d.discoverFor(uk, await getSignals(uk.id), { rand: () => 0.5 });
  const ids = grid.map((x) => x.id);
  assert.ok(ids.includes(ukTube.id));
  assert.ok(ids.includes(any1.id));
  assert.equal(ids.includes(ghTrotro.id), false, 'no trotro in the UK');
  await db.addToSet(uk.id, 'seen', ukTube.id);
  assert.equal((await d.discoverFor(uk, await getSignals(uk.id))).some((x) => x.id === ukTube.id), false, 'seen lessons are not shown again');
  // At most 2 lessons of one unit.
  assert.ok(grid.filter((x) => x.u === bio.units[2].id).length <= 2);
  // A topic filter keeps only that topic.
  assert.ok((await d.discoverFor(uk, await getSignals(uk.id), { topic: 'physics' })).every((x) => x.tp === 'physics'));
});

test('the grid leans to what the student likes and away from their own course', async () => {
  const s = await saveProfile(null, { profile: { level: 'high-school', age: 21, managedBy: 'self' }, programKeys: [`cat:${bio.id}`], units: bio.units.map((u) => u.id), interests: [] });
  const signals = { ...(await getSignals(s.id)), topics: { physics: { n: 10, completes: 9, likes: 5, pctSum: 9 } } };
  const grid = await d.discoverFor(s, signals, { rand: () => 0.5 });
  assert.equal(grid[0].tp, 'physics');
  assert.ok(grid.find((x) => x.tp === 'biology')?.why === 'From your course');
});

test('course suggestions: with lessons, not already followed', async () => {
  const s = await saveProfile(null, { profile: { level: 'high-school', age: 21, managedBy: 'self' }, units: [], interests: ['physics'] });
  await ch.follow(s.id, bio.id);
  await kv.del('cache:channels:top');
  const list = await d.suggestCourses(s, await getSignals(s.id), { rand: () => 0.5 });
  assert.ok(list.length >= 1);
  assert.equal(list.some((c) => c.handle === bio.id), false);
  assert.ok(list.every((c) => c.lessons > 0));
  assert.equal(list[0].why, 'You like Physics');
});

test('search: words in any order, prefix while typing, your country only', async () => {
  const gh = await saveProfile(null, { profile: { level: 'high-school', country: 'Ghana', age: 21, managedBy: 'self' }, units: [], interests: ['space'] });
  assert.ok((await d.searchLessons('osmo', { loc: 'ghana' })).some((x) => x.id === ghTrotro.id), 'prefix match');
  assert.equal((await d.searchLessons('osmosis', { loc: 'ghana' })).some((x) => x.id === ukTube.id), false);
  assert.ok((await d.searchLessons('motion forces', { loc: '' })).length === 3);
  const r = await d.search('osmosis', gh);
  assert.ok(r.lessons.some((x) => x.id === ghTrotro.id));
  const s = await d.suggest('bio', gh);
  assert.ok(s.some((x) => x.type === 'topic' && x.id === 'biology'));
  assert.ok(s.some((x) => x.type === 'course' && x.handle === bio.id));
  assert.deepEqual(await d.suggest('', gh), []);
});

test('trending: searches that found something, by two or more students, nothing offensive', async () => {
  const a = await saveProfile(null, { profile: { level: 'lifelong' }, units: [], interests: ['space'] });
  const b = await saveProfile(null, { profile: { level: 'lifelong' }, units: [], interests: ['space'] });
  await d.noteSearch(a.id, 'Osmosis', true);
  await d.noteSearch(a.id, 'osmosis', true); // same student, same day: once
  assert.equal((await d.trendingSearches()).includes('osmosis'), false, 'one student is not a trend');
  await d.noteSearch(b.id, 'osmosis', true);
  await d.noteSearch(a.id, 'porn stuff', true); await d.noteSearch(b.id, 'porn stuff', true);
  await d.noteSearch(a.id, 'nothing here', false); await d.noteSearch(b.id, 'nothing here', false);
  const t = await d.trendingSearches();
  assert.ok(t.includes('osmosis'));
  assert.equal(t.some((q) => q.includes('porn')), false);
  assert.equal(t.includes('nothing here'), false);
  assert.ok((await d.suggest('osm', a)).some((x) => x.type === 'query' && x.text === 'osmosis'));
});

test('API: /api/explore, /api/search/suggest and /api/search', async () => {
  const u = await saveProfile(null, { profile: { level: 'high-school', country: 'Ghana', age: 21, managedBy: 'self' }, units: [], interests: ['physics'] });
  const e = (await call('GET', '/api/explore', u.id)).json();
  assert.ok(e.videos.length > 0 && e.videos.every((v) => v.id && v.title && !v.loc || v.loc === 'ghana'));
  assert.ok(e.topics.length > 5);
  assert.equal(e.topics[0].id, 'physics', 'favourite topics first');
  assert.ok(Array.isArray(e.packs) && Array.isArray(e.courses));
  const f = (await call('GET', '/api/explore?topic=physics', u.id)).json();
  assert.equal(f.topic, 'physics');
  assert.ok(f.videos.every((v) => v.topic === 'physics'));
  assert.equal((await call('GET', '/api/explore?topic=not-a-topic', u.id)).json().topic, null);
  assert.ok((await call('GET', '/api/search/suggest?q=forc', u.id)).json().suggestions.some((s) => s.type === 'lesson'));
  const r = (await call('GET', '/api/search?q=forces', u.id)).json();
  assert.equal(r.lessons.length, 3);
});
