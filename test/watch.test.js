// Public lesson pages: the sessionless JSON endpoint, the HTML page (escaping, OG tags, 404 for
// anything not ready) and the view counters. Requests are faked; nothing touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-watch-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
process.env.STUDYTOK_READY_AHEAD = '0';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const db = await import('../server/core/db.js');
const { handleApi } = await import('../server/app.js');
const { watchPage, notFoundPage, publicLesson, escapeHtml, refOf, FALLBACK_IMAGE, notesHtml, lessonLd, isoDuration, jsonLd } = await import('../server/core/watch.js');
const { sitemapXml } = await import('../server/core/sitemap.js');
const { cardTree, clip, posterData, lessonCard, titleSize } = await import('../server/core/og.js');
const { dailyRow } = await import('../server/core/sheet.js');

const TITLE = 'Osmosis <script>alert("x")</script> & "water"';
const ready = {
  id: crypto.randomUUID(), unitId: 'hs-biology-1', unitTitle: 'Cells & transport', topic: 'biology', level: 'high-school', readyKey: 'k', status: 'ready', format: 'explain',
  createdAt: new Date().toISOString(), duration: 32, poster: 'https://cdn.example/poster.jpg', narrated: true,
  lesson: { title: TITLE, hook: "Why your fingers wrinkle in the bath: it's osmosis.", subtopic: 'Osmosis' },
  quiz: { question: 'q', options: ['a', 'b', 'c'], answerIndex: 1, from: 20, reveal: 23 },
  scenes: [{ at: 0, label: 'hook' }],
};
const making = { id: crypto.randomUUID(), unitId: 'hs-biology-2', topic: 'biology', status: 'generating', createdAt: new Date().toISOString(), lesson: { title: 'Not yet' } };
await db.saveVideo(ready);
await db.setDocument(ready.id, { version: 1, clips: [{ id: 'c1' }] });
await db.markReady(ready);
await db.saveVideo(making);

/** Runs handleApi against a fake request; no cookie unless given. */
async function call(url, headers = {}) {
  const req = { method: 'GET', url, headers: { host: 'studytok.example', 'x-forwarded-proto': 'https', ...headers }, async *[Symbol.asyncIterator]() {} };
  const out = { status: 0, headers: {}, body: '' };
  const res = {
    headersSent: false,
    writeHead(status, headers) { out.status = status; out.headers = headers; this.headersSent = true; },
    end(body) { out.body = body == null ? '' : body.toString(); },
  };
  await handleApi(req, res);
  return out;
}
const tick = () => new Promise((r) => setTimeout(r, 20));

test('GET /api/public/videos/:id serves a ready lesson with its document and no viewer fields', async () => {
  const r = await call(`/api/public/videos/${ready.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers['Cache-Control'], 'public, max-age=300');
  const { item } = JSON.parse(r.body);
  assert.equal(item.id, ready.id);
  assert.equal(item.status, 'ready');
  assert.equal(item.title, TITLE);
  assert.equal(item.format.id, 'explain');
  assert.equal(item.unit.title, 'Cells & transport');
  assert.deepEqual(item.document, { version: 1, clips: [{ id: 'c1' }] });
  assert.equal(item.quiz.hold, 20); // reveal − 3, floored at from
  for (const k of ['liked', 'saved', 'why', 'position', 'likes']) assert.equal(k in item, false, `${k} is viewer-specific`);
});

test('GET /api/public/videos/:id is 404 for a video that is not ready or unknown', async () => {
  assert.equal((await call(`/api/public/videos/${making.id}`)).status, 404);
  assert.equal((await call(`/api/public/videos/${crypto.randomUUID()}`)).status, 404);
});

test('publicLesson mirrors publicVideo without user fields', () => {
  const item = publicLesson(ready, undefined);
  assert.equal(item.document, undefined);
  assert.equal(item.narrated, true);
  assert.deepEqual(item.scenes, ready.scenes);
});

test('watchPage escapes the lesson text and carries the Open Graph / Twitter tags', () => {
  const html = watchPage(ready, { url: `https://studytok.example/v/${ready.id}`, ref: 12, playerOrigin: 'https://www.vidmoat.com' });
  assert.equal(html.includes('<script>alert'), false, 'raw script tag must not appear');
  assert.ok(html.includes(escapeHtml(TITLE)));
  assert.ok(html.includes(`<meta property="og:title" content="${escapeHtml(TITLE)}">`));
  assert.ok(html.includes('<meta property="og:type" content="video.other">'));
  assert.ok(html.includes('<meta property="og:site_name" content="StudyGraph">'));
  assert.ok(html.includes(`<meta property="og:url" content="https://studytok.example/v/${ready.id}">`));
  assert.ok(html.includes('<meta property="og:image" content="https://cdn.example/poster.jpg">'));
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'));
  assert.ok(html.includes(`og:description" content="${escapeHtml(ready.lesson.hook)}"`));
  assert.ok(html.includes('Shared by member #12'));
  assert.ok(html.includes('href="/?ref=12"'));
  assert.ok(html.includes('Get lessons for your own syllabus'));
  assert.ok(html.includes('Built by Vidmoat · a Buzz Innovations Ltd. company'));
  assert.ok(html.includes('<script type="module" src="/watch.js"></script>'));
  assert.equal(/<script(?! type="module" src=| type="application\/ld\+json">)/.test(html), false, 'no inline scripts (CSP); JSON-LD data blocks are not scripts');
  assert.equal(/<style|style="/.test(html), false, 'no inline styles (CSP)');
  assert.ok(html.includes('Cells &amp; transport'));
  assert.ok(html.includes('data-player-origin="https://www.vidmoat.com"'));
});

test('watchPage falls back to the app icon without a poster and omits the ref line without ?ref', () => {
  const html = watchPage({ ...ready, poster: null }, { url: 'https://studytok.example/v/x', ref: null, playerOrigin: 'https://www.vidmoat.com' });
  assert.ok(html.includes(`<meta property="og:image" content="${FALLBACK_IMAGE}">`));
  assert.equal(html.includes('Shared by member'), false);
  assert.ok(html.includes('href="/"'));
  // A javascript: poster is never emitted.
  const bad = watchPage({ ...ready, poster: 'javascript:alert(1)' }, { url: 'https://studytok.example/v/x', playerOrigin: 'https://www.vidmoat.com' });
  assert.equal(bad.includes('javascript:'), false);
});

test('refOf accepts only positive integers', () => {
  assert.equal(refOf('12'), 12);
  assert.equal(refOf('0'), null);
  assert.equal(refOf('abc'), null);
  assert.equal(refOf('1.5'), null);
  assert.equal(refOf(null), null);
});

test('GET /v/:id serves the HTML page without a session, is cacheable, and counts the view', async () => {
  const before = Number((await kv.hgetall(`events:day:${new Date().toISOString().slice(0, 10)}`))?.share_page_view) || 0;
  const r = await call(`/v/${ready.id}?ref=7`);
  assert.equal(r.status, 200);
  assert.match(r.headers['Content-Type'], /text\/html/);
  assert.equal(r.headers['Cache-Control'], 'public, max-age=300');
  assert.ok(r.body.startsWith('<!doctype html>'));
  assert.ok(r.body.includes('Shared by member #7'));
  assert.ok(r.body.includes(`og:url" content="https://studytok.example/v/${ready.id}"`));
  await tick();
  const after = Number((await kv.hgetall(`events:day:${new Date().toISOString().slice(0, 10)}`))?.share_page_view) || 0;
  assert.equal(after, before + 1);
  assert.equal(Number((await kv.hgetall(`video:${ready.id}:stats`))?.shareViews), 1);
  assert.equal((await dailyRow(new Date().toISOString().slice(0, 10)))['Shared lesson views'], after);
});

test('GET /v/:id also answers the Vercel-rewritten form (/api/index?__path=v/:id)', async () => {
  const r = await call(`/api/index?__path=v/${ready.id}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.includes(escapeHtml(TITLE)));
});

test('GET /v/:id is a branded 404 for a video that is not ready', async () => {
  const r = await call(`/v/${making.id}`);
  assert.equal(r.status, 404);
  assert.match(r.headers['Content-Type'], /text\/html/);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.ok(r.body.includes("This lesson isn't here."));
  assert.equal(r.body.includes('Not yet'), false, 'the unready title is not leaked');
  assert.ok(notFoundPage({ url: 'https://studytok.example/v/x', ref: 3 }).includes('href="/?ref=3"'));
});

const NOTES = {
  objective: 'Explain why water moves across a membrane.', keyTerms: ['osmosis', 'partially permeable'],
  points: ['Water moves toward the saltier side.', 'Cells swell or shrink.'], definitions: [{ term: 'Osmosis', meaning: 'Net movement of water <across> a membrane.' }],
  takeaway: 'Water follows salt.', myth: null, fact: null,
  quiz: { question: 'Which way does water move?', options: ['Out', 'Toward salt', 'Nowhere'], answerIndex: 1, explanation: 'Down its own gradient.' },
};

test('watchPage carries the lesson share image, robots, notes and VideoObject/LearningResource data', () => {
  const url = `https://study-graph.com/v/${ready.id}`;
  const html = watchPage(ready, { url, playerOrigin: 'https://www.vidmoat.com', notes: NOTES, ogImage: `https://study-graph.com/og/v/${ready.id}.png` });
  assert.ok(html.includes(`<meta property="og:image" content="https://study-graph.com/og/v/${ready.id}.png">`));
  assert.ok(html.includes('<meta property="og:image:width" content="1200">'));
  assert.ok(html.includes(`<meta name="twitter:image" content="https://study-graph.com/og/v/${ready.id}.png">`));
  assert.ok(html.includes('<meta name="robots" content="index, follow, max-image-preview:large'));
  assert.ok(html.includes('Lesson notes'));
  assert.ok(html.includes('Net movement of water &lt;across&gt; a membrane.'));
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);
  assert.deepEqual(ld['@type'], ['VideoObject', 'LearningResource']);
  assert.equal(ld.url, url);
  assert.equal(ld.duration, 'PT32S');
  assert.equal(ld.uploadDate, ready.createdAt);
  assert.equal(ld.thumbnailUrl[0], `https://study-graph.com/og/v/${ready.id}.png`);
  assert.ok(ld.teaches.includes('osmosis'));
  assert.equal(ld.isPartOf.name, 'Cells & transport');
  // The title holds a <script> tag: JSON-LD must not let it close the data block.
  assert.equal(jsonLd({ t: TITLE }).includes('</script>'), false);
  assert.equal(/<\/script>/g.exec(html.slice(html.indexOf('application/ld+json')))?.index > 0, true);
});

test('the 404 page stays noindex; notesHtml is empty without notes; durations are ISO 8601', () => {
  assert.ok(notFoundPage({ url: 'https://study-graph.com/v/x' }).includes('<meta name="robots" content="noindex">'));
  assert.equal(notesHtml(null), '');
  assert.equal(notesHtml({ points: [], keyTerms: [], definitions: [] }), '');
  assert.equal(isoDuration(65), 'PT1M5S');
  assert.equal(isoDuration(60), 'PT1M');
  assert.equal(isoDuration(0), undefined);
  assert.equal(lessonLd({ ...ready, unitTitle: null }, { url: 'u', image: 'i', description: 'd', notes: null }).isPartOf, undefined);
});

test('GET /v/:id uses the lesson share image and notes', async () => {
  const r = await call(`/v/${ready.id}`);
  assert.ok(r.body.includes(`og:image" content="https://studytok.example/og/v/${ready.id}.png"`));
  assert.ok(r.body.includes('application/ld+json'));
});

test('sitemap lists the home page and every ready lesson with its image', async () => {
  const r = await call('/sitemap.xml');
  assert.equal(r.status, 200);
  assert.match(r.headers['Content-Type'], /application\/xml/);
  assert.ok(r.body.includes('<loc>https://studytok.example/</loc>'));
  assert.ok(r.body.includes(`<loc>https://studytok.example/v/${ready.id}</loc>`));
  assert.ok(r.body.includes(`<image:loc>https://studytok.example/og/v/${ready.id}.png</image:loc>`));
  assert.equal(r.body.includes(making.id), false, 'unready lessons are not listed');
  assert.ok((await call('/api/index?__path=sitemap.xml')).body.includes(ready.id));
  const xml = sitemapXml('https://s.example', [{ id: 'not-a-uuid', at: 1 }, { id: ready.id, at: Date.parse('2026-01-02') }]);
  assert.equal(xml.includes('not-a-uuid'), false);
  assert.ok(xml.includes('<lastmod>2026-01-02</lastmod>'));
});

test('the share card: text is clipped, the poster is optional and only https JPEG/PNG is fetched', async () => {
  assert.equal(clip('a b c d e f', 6), 'a b c…');
  assert.equal(clip('short', 10), 'short');
  assert.ok(titleSize('x'.repeat(95), false) < titleSize('x'.repeat(20), false));
  const text = JSON.stringify(cardTree(ready));
  assert.ok(text.includes('CELLS & TRANSPORT'), 'unit shown');
  assert.equal(text.includes('"img"'), false, 'no poster element without poster data');
  assert.ok(JSON.stringify(cardTree(ready, { poster: 'data:image/png;base64,AA' })).includes('"img"'));
  let fetched = 0;
  const png = (type) => async () => { fetched++; return new Response(Buffer.from([1, 2, 3]), { headers: { 'content-type': type } }); };
  assert.equal(await posterData('http://cdn.example/a.jpg', { fetchImpl: png('image/jpeg') }), null);
  assert.equal(await posterData('javascript:alert(1)', { fetchImpl: png('image/jpeg') }), null);
  assert.equal(fetched, 0, 'nothing but https is fetched');
  assert.equal(await posterData('https://cdn.example/a.svg', { fetchImpl: png('image/svg+xml') }), null);
  assert.equal(await posterData('https://cdn.example/a.jpg', { fetchImpl: png('image/jpeg') }), 'data:image/jpeg;base64,AQID');
  assert.equal(await posterData('https://cdn.example/a.jpg', { fetchImpl: async () => { throw new Error('down'); } }), null);
});

test('GET /og/v/:id.png renders a 1200×630 PNG, and falls back to the site image for unready lessons', async () => {
  const card = await lessonCard({ ...ready, poster: null });
  assert.deepEqual([...card.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(''), 'PNG');
  assert.equal(card.readUInt32BE(16), 1200);
  assert.equal(card.readUInt32BE(20), 630);
  const saved = { ...ready, id: crypto.randomUUID(), poster: null };
  await db.saveVideo(saved);
  const r = await call(`/og/v/${saved.id}.png`);
  assert.equal(r.status, 200);
  assert.equal(r.headers['Content-Type'], 'image/png');
  assert.match(r.headers['Cache-Control'], /s-maxage=604800/);
  const v = await call(`/api/index?__path=og/v/${making.id}.png`);
  assert.equal(v.status, 302);
});
