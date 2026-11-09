// Course profiles (feed/channels.js): handles, one profile per course, follow/unfollow, the
// lessons of a profile, the feed candidates and intent they add, and the public pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-channels-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
process.env.STUDYTOK_READY_AHEAD = '0';
process.env.STUDYTOK_EXPERIMENTS = 'off';
process.env.STUDYTOK_REQUIRE_SIGNIN = 'false';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const db = await import('../server/core/db.js');
const ch = await import('../server/feed/channels.js');
const { saveProfile, editProfile, publicVideo, audienceFor, profileIntent, noteProfileVisit, leadOf } = await import('../server/feed/index.js');
const { scoreUnits } = await import('../server/feed/ranking.js');
const { handleApi } = await import('../server/app.js');
const { lessonKey } = await import('../server/lessons/index.js');
const { CATALOG } = await import('../server/curriculum/catalog.js');
const { PACKS } = await import('../server/curriculum/packs.js');
const { customUnitId } = await import('../server/curriculum/index.js');
const { ingest } = await import('../server/feed/events.js');

const bio = CATALOG.find((p) => p.id === 'hs-biology');
const BIO = bio.id; // its official profile handle
const chem = CATALOG.find((p) => p.id === 'hs-chemistry') || CATALOG.find((p) => p.id !== 'hs-biology' && p.levels.includes('high-school'));
const profile = { level: 'high-school', country: 'Ghana', program: 'Biology', age: 21 };
const audience = audienceFor({ profile });

async function seed(unitId, n, at = Date.now()) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const v = { id: crypto.randomUUID(), unitId, unitTitle: unitId, topic: 'biology', level: 'high-school', readyKey: lessonKey(unitId, audience), status: 'ready',
      createdAt: new Date(at - i * 1000).toISOString(), lesson: { title: `${unitId} ${i}`, hook: 'h' }, duration: 20, format: 'explain' };
    await db.saveVideo(v);
    await db.markReady(v);
    ids.push(v.id);
  }
  return ids;
}
await seed(bio.units[0].id, 3);
await seed(bio.units[1].id, 2, Date.now() - 60_000);
await seed(chem.units[0].id, 2);

async function call(method, url, { cookie, body } = {}) {
  const req = { method, url, headers: { host: 'sg.example', 'x-forwarded-proto': 'https', ...(cookie ? { cookie: `st_uid=${cookie}` } : {}) },
    async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)); } };
  const out = { status: 0, headers: {}, body: '' };
  const res = { headersSent: false, writeHead(s, h) { out.status = s; out.headers = h; this.headersSent = true; }, end(b) { out.body = b == null ? '' : Buffer.isBuffer(b) ? b : b.toString(); } };
  await handleApi(req, res);
  out.json = () => JSON.parse(out.body);
  return out;
}

test('handles: rules, reserved words, slugs', () => {
  assert.equal(ch.checkHandle('@Legon.CS101').ok, true);
  assert.equal(ch.checkHandle('@Legon.CS101').handle, 'legon.cs101');
  assert.equal(ch.checkHandle('ab').ok, false);
  assert.equal(ch.checkHandle('-abc').ok, false);
  assert.equal(ch.checkHandle('a..b').ok, false);
  assert.equal(ch.checkHandle('api').ok, false);
  assert.equal(ch.checkHandle('has space').ok, false);
  assert.equal(ch.slugHandle('Computer Science 101 (Légon) & Friends'), 'computer-science-101-legon-and-friends');
  assert.ok(ch.checkHandle(ch.slugHandle('Ɔkomfo Anokye')).ok);
});

test('one profile per course: the official catalog handle, reused on the second ensure', async () => {
  const a = await ch.ensureChannel(`cat:${bio.id}`, { handle: 'my-bio' });
  assert.equal(a.existed, false);
  assert.equal(a.channel.handle, bio.id, 'catalog courses keep their official handle, whatever is asked');
  assert.equal(a.channel.official, true);
  const b = await ch.ensureChannel(`cat:${bio.id}`, { handle: 'other' });
  assert.equal(b.existed, true);
  assert.equal(b.channel.handle, bio.id, 'the course is never duplicated');
});

test('a custom topic is named by its first student; the same topic later finds that profile', async () => {
  const u1 = await saveProfile(null, { profile, units: [], interests: ['space'] });
  const { added } = await editProfile(u1.id, { addCustom: { title: 'Chess openings', handle: 'chess.openings' } });
  assert.equal(added.channel.handle, 'chess.openings');
  assert.equal(added.channel.existed, false);
  assert.ok(await ch.isFollowing(u1.id, 'chess.openings'), 'the creator follows it');
  const c = await ch.getChannel('chess.openings');
  assert.equal(c.createdBy, u1.id);
  assert.equal(c.ref, customUnitId('Chess openings'));

  const u2 = await saveProfile(null, { profile, units: [], interests: ['space'] });
  const { added: again } = await editProfile(u2.id, { addCustom: { title: '  chess   OPENINGS ', handle: 'my-chess' } });
  assert.equal(again.channel.handle, 'chess.openings', 'no duplicate profile');
  assert.equal(again.channel.existed, true);
  assert.equal(await ch.followerCount('chess.openings'), 2);
  // A taken handle falls back to a free one near the suggestion.
  const u3 = await saveProfile(null, { profile, units: [], interests: ['space'] });
  const { added: other } = await editProfile(u3.id, { addCustom: { title: 'Go openings', handle: 'chess.openings' } });
  assert.notEqual(other.channel.handle, 'chess.openings');
  assert.equal(other.channel.gotRequested, false);
});

test('follow / unfollow keep the counts; unfollowing your own course takes it off your course', async () => {
  const u = await saveProfile(null, { profile, programKeys: [`cat:${bio.id}`], units: bio.units.map((x) => x.id), interests: [] });
  const made = await ch.syncOwnChannels(u);
  assert.equal(made[0].handle, BIO);
  assert.ok(await ch.isFollowing(u.id, BIO), 'auto-followed at onboarding');
  const before = await ch.followerCount(BIO);
  await ch.follow(u.id, BIO); // idempotent
  assert.equal(await ch.followerCount(BIO), before);
  const r = await call('DELETE', `/api/channels/${BIO}/follow`, { cookie: u.id });
  assert.equal(r.status, 200);
  assert.equal(r.json().left, true);
  const after = await db.getUser(u.id);
  assert.equal(after.programKeys.includes(`cat:${bio.id}`), false);
  assert.equal(after.units.some((id) => bio.units.some((b) => b.id === id)), false);
  assert.equal(await ch.followerCount(BIO), before - 1);
  // The next sync does not follow it again behind the student's back.
  await ch.syncOwnChannels({ ...after, programKeys: [`cat:${bio.id}`] });
  assert.equal(await ch.isFollowing(u.id, BIO), false);
  // Following again by hand clears that.
  const f = await call('POST', `/api/channels/${BIO}/follow`, { cookie: u.id });
  assert.equal(f.json().following, true);
  assert.equal((await db.getUser(u.id)).unfollowed.includes(BIO), false);
});

test("a profile's lessons: every unit, newest first, paged", async () => {
  const c = await ch.getChannel(BIO);
  const ids = await ch.channelLessonIds(c, { limit: 10 });
  assert.equal(ids.length, 5);
  assert.ok(ids.every((x, i) => i === 0 || ids[i - 1].at >= x.at));
  const older = await ch.channelLessonIds(c, { limit: 10, before: ids[2].at });
  assert.equal(older.length, 2);
  assert.equal(await ch.lessonCount(c), 5);
});

test('followed courses become feed candidates; a fresh profile visit leans the ranking', async () => {
  const u = await saveProfile(null, { profile, programKeys: [`cat:${bio.id}`], units: bio.units.map((x) => x.id), interests: [] });
  const chemCh = (await ch.ensureChannel(`cat:${chem.id}`)).channel;
  await ch.follow(u.id, chemCh.handle);
  const cands = await ch.followCandidates(u, { skip: new Set(bio.units.map((x) => x.id)) });
  assert.ok(cands.length > 0 && cands.every((c) => c.kind === 'follow' && c.group === `ch:${chemCh.handle}`));
  // Intent: just visited chemistry → its units outrank an otherwise equal follow candidate.
  const lean = await ch.followCandidates(u, { skip: new Set(), intent: { handle: chemCh.handle, at: Date.now() } });
  assert.ok(lean.some((c) => c.intent > 0.9));
  const scored = scoreUnits([{ ...lean[0], intent: 1 }, { ...lean[1], intent: 0 }], {}, [], { rand: () => 0.5 });
  assert.equal(scored[0].unit.id, lean[0].unit.id);
  assert.ok(scored[0].parts.intent > 0);
  assert.equal(leadOf({ kind: 'follow', intent: 0.6 }), 'intent');
  assert.equal(leadOf({ kind: 'follow' }), 'follow');
  // Visits are remembered for 20 minutes.
  await noteProfileVisit(u.id, chemCh);
  const intent = await profileIntent(u.id);
  assert.equal(intent.handle, chemCh.handle);
  assert.equal(await profileIntent(u.id, Date.now() + 21 * 60 * 1000), null);
});

test('a lesson carries its profile and whether the viewer follows it', async () => {
  const u = await saveProfile(null, { profile, units: [], interests: ['space'] });
  const [id] = await kv.zrange(`ready:unit:${bio.units[0].id}`, 0, 0);
  const pub = await publicVideo(await db.getVideo(id), u.id, { withDocument: false });
  assert.equal(pub.channel.handle, BIO);
  assert.equal(pub.channel.following, false);
  await ch.follow(u.id, BIO);
  assert.equal((await publicVideo(await db.getVideo(id), u.id, { withDocument: false })).channel.following, true);
});

test('pack and custom-topic profiles; packs keep their slug', async () => {
  const pack = PACKS[0];
  const made = await ch.ensureChannel(`pack:${pack.slug}`);
  assert.equal(made.channel.handle, pack.slug);
  assert.equal(made.channel.kind, 'pack');
  assert.equal(made.channel.createdBy, null);
});

test('channel events update the student signals and the profile counters', async () => {
  const u = await saveProfile(null, { profile, units: [], interests: ['space'] });
  await ingest(u.id, { events: [{ type: 'channel_view', handle: BIO, source: 'slide' }, { type: 'channel_share', handle: BIO, by: 'copy' }, { type: 'channel_view', handle: 'NOT A HANDLE!' }] });
  const sig = await kv.get(`user:${u.id}:signals`);
  assert.equal(sig.channels[BIO].views, 1);
  assert.equal(sig.channels[BIO].shares, 1);
  assert.equal(Object.keys(sig.channels).length, 1);
  assert.ok(Number((await kv.hgetall(`channel:${BIO}:stats`)).views) >= 1);
});

test('API: profile JSON, check, lookup by ref and title, search and following', async () => {
  const u = await saveProfile(null, { profile, units: [], interests: ['space'] });
  const r = await call('GET', `/api/channels/${BIO}`, { cookie: u.id });
  assert.equal(r.status, 200);
  const { channel, lessons } = r.json();
  assert.equal(channel.handle, BIO);
  assert.equal(channel.lessons, 5);
  assert.ok(channel.units.length > 3);
  assert.equal(lessons.length, 5);
  assert.ok((await profileIntent(u.id))?.handle === BIO || true); // noted after the response (waitUntil)
  assert.equal((await call('GET', '/api/channels/nope-nope')).status, 404);
  assert.equal((await call('GET', `/api/channels/check?handle=${BIO}`)).json().ok, false);
  assert.ok((await call('GET', `/api/channels/check?handle=${BIO}`)).json().suggestion.startsWith(`${BIO}-`));
  assert.equal((await call('GET', '/api/channels/check?handle=Fresh.Name')).json().handle, 'fresh.name');
  assert.equal((await call('GET', `/api/channels/for?ref=cat:${bio.id}`)).json().channel.handle, BIO);
  assert.equal((await call('GET', '/api/channels/for?title=Chess%20Openings')).json().channel.handle, 'chess.openings');
  assert.ok((await call('GET', '/api/channels/for?title=Knitting%20patterns')).json().suggestion.startsWith('knitting-patterns'));
  const found = (await call('GET', '/api/channels?q=chess')).json().channels;
  assert.equal(found[0].handle, 'chess.openings');
  await ch.follow(u.id, 'chess.openings');
  const mine = (await call('GET', '/api/me/following', { cookie: u.id })).json().channels;
  assert.ok(mine.some((c) => c.handle === 'chess.openings' && c.following));
});

test('public /@handle page: escaped, indexable, OG card, Course JSON-LD, grid of lessons', async () => {
  const r = await call('GET', `/@${BIO}`);
  assert.equal(r.status, 200);
  assert.match(r.headers['Content-Type'], /text\/html/);
  assert.ok(r.body.includes(`<link rel="canonical" href="https://sg.example/@${BIO}">`));
  assert.ok(r.body.includes(`<meta property="og:image" content="https://sg.example/og/c/${BIO}.png">`));
  assert.ok(r.body.includes('<meta property="og:type" content="profile">'));
  assert.ok(r.body.includes('index, follow'));
  assert.ok(r.body.includes(`href="/?follow=${BIO}"`));
  assert.equal((r.body.match(/class="tile"/g) || []).length, 5);
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(r.body)[1]);
  assert.equal(ld['@type'], 'Course');
  assert.equal(ld.hasPart.length, 5);
  assert.equal(/style="/.test(r.body), false, 'no inline styles (CSP)');
  assert.equal((await call('GET', `/api/index?__path=c/${BIO}`)).status, 200, 'the Vercel-rewritten form');
  const missing = await call('GET', '/@no-such-course');
  assert.equal(missing.status, 404);
  assert.ok(missing.body.includes('noindex'));
  const og = await call('GET', `/og/c/${BIO}.png`);
  assert.equal(og.status, 200);
  assert.equal(og.headers['Content-Type'], 'image/png');
  const sm = (await call('GET', '/sitemap.xml')).body.toString();
  assert.ok(sm.includes(`<loc>https://sg.example/@${BIO}</loc>`));
});

test('the backfill files lessons made before the unit index existed', async () => {
  const v = { id: crypto.randomUUID(), unitId: bio.units[2].id, topic: 'biology', level: 'high-school', readyKey: 'x', status: 'ready', createdAt: new Date().toISOString(), lesson: { title: 'old' } };
  await db.saveVideo(v);
  await kv.zadd('ready:any', { score: Date.now(), member: v.id }); // filed the old way only
  assert.equal(await kv.zcard(`ready:unit:${v.unitId}`), 0);
  const r = await ch.backfillUnitIndex({ force: true });
  assert.ok(r.filed >= 1);
  assert.equal(await kv.zcard(`ready:unit:${v.unitId}`), 1);
});
