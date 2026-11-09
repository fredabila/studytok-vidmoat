// Course pictures (core/avatars.js, channels.setChannelAvatar): only real small images, checked
// before anyone sees them (and refused when the check cannot run), only by the course's creator,
// served immutable, replaced and removed cleanly, kept through renames.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-avatars-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
process.env.STUDYTOK_REQUIRE_SIGNIN = 'false';
process.env.STUDYTOK_EXPERIMENTS = 'off';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];
delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_AUTH_TOKEN;

const { kv } = await import('../server/core/kv.js');
const av = await import('../server/core/avatars.js');
const ch = await import('../server/feed/channels.js');
const { saveProfile, editProfile } = await import('../server/feed/index.js');
const { handleApi } = await import('../server/app.js');

// A real 1×1 JPEG and PNG.
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const jpegUrl = `data:image/jpeg;base64,${JPEG}`;
const ok = async () => ({ ok: true, reason: '' });
const no = async () => ({ ok: false, reason: 'Course pictures cannot show people. Try a drawing.' });

async function call(method, url, { cookie, body } = {}) {
  const req = { method, url, headers: { host: 'sg.example', 'x-forwarded-proto': 'https', ...(cookie ? { cookie: `st_uid=${cookie}` } : {}) }, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)); } };
  const out = { status: 0, headers: {}, body: null };
  const res = { headersSent: false, writeHead(s, h) { out.status = s; out.headers = h; this.headersSent = true; }, end(b) { out.body = b; } };
  await handleApi(req, res);
  out.json = () => JSON.parse(out.body.toString());
  return out;
}

const owner = await saveProfile(null, { profile: { level: 'lifelong' }, units: [], interests: ['space'] });
const other = await saveProfile(null, { profile: { level: 'lifelong' }, units: [], interests: ['space'] });
const { added } = await editProfile(owner.id, { addCustom: { title: 'Bird watching', handle: 'birds' } });
assert.equal(added.channel.handle, 'birds');

test('only small, real JPEG, PNG or WebP data URLs are accepted', () => {
  assert.equal(av.decodeAvatar(jpegUrl).type, 'image/jpeg');
  assert.equal(av.decodeAvatar(`data:image/png;base64,${PNG}`).type, 'image/png');
  assert.throws(() => av.decodeAvatar('data:image/svg+xml;base64,PHN2Zz4='), /JPEG, PNG or WebP/);
  assert.throws(() => av.decodeAvatar(`data:image/png;base64,${JPEG}`), /not the picture it says/, 'magic bytes must match the type');
  assert.throws(() => av.decodeAvatar(`data:image/jpeg;base64,${'A'.repeat(300000)}`), /too large/);
  assert.throws(() => av.decodeAvatar('https://evil.example/x.jpg'), /JPEG, PNG or WebP/);
});

test('the check fails closed: no model, an error or an unclear answer means no', async () => {
  assert.equal((await av.moderateAvatar(av.decodeAvatar(jpegUrl))).ok, false, 'no Anthropic key configured');
  assert.equal((await av.moderateAvatar(av.decodeAvatar(jpegUrl), { ask: async () => { throw new Error('down'); } })).ok, false);
  assert.equal((await av.moderateAvatar(av.decodeAvatar(jpegUrl), { ask: async () => ({}) })).ok, false);
  assert.equal((await av.moderateAvatar(av.decodeAvatar(jpegUrl), { ask: async () => ({ ok: true }) })).ok, true);
});

test('only the creator, never an official course; a rejected picture is not stored', async () => {
  await assert.rejects(ch.setChannelAvatar(other.id, 'birds', jpegUrl, { moderate: ok }), (e) => e.status === 403);
  await ch.ensureChannel('cat:hs-biology');
  await assert.rejects(ch.setChannelAvatar(owner.id, 'hs-biology', jpegUrl, { moderate: ok }), (e) => e.status === 403);
  const before = (await kv.get('channel:birds')).avatar;
  await assert.rejects(ch.setChannelAvatar(owner.id, 'birds', jpegUrl, { moderate: no }), (e) => e.status === 422 && /people/.test(e.message));
  assert.deepEqual((await kv.get('channel:birds')).avatar, before);
  // Through the API, with no model configured: refused, nothing stored.
  const r = await call('POST', '/api/channels/birds/avatar', { cookie: owner.id, body: { image: jpegUrl } });
  assert.equal(r.status, 422);
  assert.equal((await kv.get('channel:birds')).avatar, undefined);
});

test('approved: stored, served immutable from /a/<id>, on the profile and its lessons; replaced and removed cleanly', async () => {
  const c1 = await ch.setChannelAvatar(owner.id, 'birds', jpegUrl, { moderate: ok });
  const id1 = c1.avatar.id;
  const pub = await ch.publicChannel(c1, { userId: owner.id });
  assert.equal(pub.avatar, `/a/${id1}`);
  const img = await call('GET', `/a/${id1}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers['Content-Type'], 'image/jpeg');
  assert.match(img.headers['Cache-Control'], /immutable/);
  assert.equal(Buffer.compare(img.body, Buffer.from(JPEG, 'base64')), 0);
  assert.equal((await call('GET', '/a/not-an-id')).status, 401, 'not a picture path: falls through to the API');
  // The public profile page shows it.
  assert.ok((await call('GET', '/@birds')).body.toString().includes(`<img src="/a/${id1}"`));
  // Replace: the old picture is deleted.
  const c2 = await ch.setChannelAvatar(owner.id, 'birds', `data:image/png;base64,${PNG}`, { moderate: ok });
  assert.notEqual(c2.avatar.id, id1);
  assert.equal(await kv.get(`avatar:${id1}`), null);
  assert.equal((await call('GET', `/a/${id1}`)).status, 404);
  // Renaming keeps the picture.
  await ch.renameChannel(owner.id, 'birds', 'birdwatch');
  assert.equal((await ch.getChannel('birdwatch')).avatar.id, c2.avatar.id);
  // Remove: back to the emoji, the image is gone.
  const r = await call('DELETE', '/api/channels/birdwatch/avatar', { cookie: owner.id });
  assert.equal(r.status, 200);
  assert.equal(r.json().channel.avatar, null);
  assert.equal(await kv.get(`avatar:${c2.avatar.id}`), null);
});

test('a student can set at most 10 pictures a day', async () => {
  const s = await saveProfile(null, { profile: { level: 'lifelong' }, units: [], interests: ['space'] });
  await editProfile(s.id, { addCustom: { title: 'Knot tying', handle: 'knots' } });
  for (let i = 0; i < 10; i++) await ch.setChannelAvatar(s.id, 'knots', jpegUrl, { moderate: ok });
  await assert.rejects(ch.setChannelAvatar(s.id, 'knots', jpegUrl, { moderate: ok }), (e) => e.status === 429);
});
