// Moments between lessons: pacing, eligibility, admin extras and the public shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-moments-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const { MOMENTS, GAP, MIN_VIEWED, MAX_PER_DAY, momentContext, pickMoment, noteMoment, momentItem, setExtraMoments, extraMoments } = await import('../server/feed/moments.js');
const { EVENT_SPECS } = await import('../server/feed/events.js');

const ctxFor = (over = {}) => momentContext({ user: { units: [], billing: {} }, signals: { topics: {}, quiz: { n: 3 }, shares: 1, device: { platform: 'iPhone', standalone: true } }, saved: 2, watched: 20, invites: 1, ...over });

test('the catalogue is well formed and every moment resolves to a renderable item', () => {
  const ids = new Set();
  for (const m of MOMENTS) {
    assert.ok(!ids.has(m.id), `unique id ${m.id}`); ids.add(m.id);
    assert.ok(['tip', 'news', 'offer'].includes(m.type));
    assert.ok(m.lines.length >= 2 && m.lines.length <= 3, `${m.id} has 2-3 lines`);
    assert.equal(typeof m.when, 'function');
    const item = momentItem(m, ctxFor({ user: { units: [], billing: { houseUsed: 3 } } }));
    assert.equal(item.kind, 'moment'); assert.equal(item.status, 'ready'); assert.match(item.id, /^moment:/);
    assert.equal(typeof item.moment.title, 'string'); assert.ok(item.moment.title.length > 0);
    assert.ok(item.moment.lines.every((l) => typeof l === 'string' && l.length > 0));
    assert.ok(item.moment.cta.label);
  }
});

test('pacing: nothing for a fresh session, then one moment every GAP lessons, at most MAX_PER_DAY a day', async () => {
  const uid = 'u-pace';
  const ctx = ctxFor();
  assert.equal(await pickMoment(uid, { session: { viewed: MIN_VIEWED - 1 }, ctx }), null, 'too early in the session');
  const first = await pickMoment(uid, { session: { viewed: MIN_VIEWED }, ctx });
  assert.ok(first, 'a moment once the student is warmed up');
  await noteMoment(uid, first, MIN_VIEWED);
  assert.equal(await pickMoment(uid, { session: { viewed: MIN_VIEWED + GAP - 1 }, ctx }), null, 'not before GAP more lessons');
  const second = await pickMoment(uid, { session: { viewed: MIN_VIEWED + GAP }, ctx });
  assert.ok(second && second.id !== first.id, 'a different moment next');
  await noteMoment(uid, second, MIN_VIEWED + GAP);
  let viewed = MIN_VIEWED + GAP;
  for (let i = 2; i < MAX_PER_DAY; i++) { viewed += GAP; const m = await pickMoment(uid, { session: { viewed }, ctx }); assert.ok(m); await noteMoment(uid, m, viewed); }
  assert.equal(await pickMoment(uid, { session: { viewed: viewed + GAP }, ctx }), null, 'the daily cap holds');
  assert.equal(await pickMoment(uid, { session: { viewed: 100 }, ctx, hasBreather: true }), null, 'never on a page with a breather');
});

test('eligibility follows the student: the save tip only before the first save, the install tip only in a browser, offers follow the allowance', () => {
  const by = (id) => MOMENTS.find((m) => m.id === id);
  assert.equal(by('tip-save').when(ctxFor({ saved: 0 })), true);
  assert.equal(by('tip-save').when(ctxFor({ saved: 1 })), false);
  assert.equal(by('tip-install').when(ctxFor({ signals: { topics: {}, device: { platform: 'Android', standalone: false } } })), true);
  assert.equal(by('tip-install').when(ctxFor()), false, 'installed already');
  assert.equal(by('tip-keys').when(ctxFor({ signals: { topics: {}, device: { platform: 'MacIntel' } } })), true);
  assert.equal(by('tip-keys').when(ctxFor()), false, 'no keyboard tip on a phone');
  const total = momentContext({}).freeTotal;
  if (total > 0) {
    const half = ctxFor({ user: { units: [], billing: { houseUsed: total - Math.floor(total / 2) } } });
    assert.equal(by('offer-free').when(half), true, 'halfway through the free lessons');
    assert.match(momentItem(by('offer-free'), half).moment.title, /free lessons left/);
    const out = ctxFor({ user: { units: [], billing: { houseUsed: total } } });
    assert.equal(by('offer-free').when(out), false); assert.equal(by('offer-unlimited').when(out), true, 'the unlimited offer once they are used up');
    assert.equal(by('offer-unlimited').when(ctxFor({ user: { units: [], vidmoatTokens: {}, billing: { houseUsed: total } } })), false, 'never for an own-account student');
  }
  assert.equal(by('tip-reminders').when(ctxFor({ pushEnabled: true, pushSubscribed: false })), true);
  assert.equal(by('tip-reminders').when(ctxFor({ pushEnabled: true, pushSubscribed: true })), false);
});

test('admin extras are cleaned, come first, respect their end date and minimum lessons, and repeat on their own window', async () => {
  const saved = await setExtraMoments([
    { id: 'Exam Week!', type: 'offer', title: 'Exam week: double lessons', lines: ['All week.', 'Go.'], cta: { label: 'Read more', href: 'https://studytok.vidmoat.com/news' }, repeatDays: 3, emoji: '🎉' },
    { id: 'old', type: 'news', title: 'Expired', lines: ['x', 'y'], until: '2000-01-01' },
    { id: 'later', type: 'tip', title: 'For veterans', lines: ['x', 'y'], minWatched: 500 },
    { title: '' }, // dropped: no title
  ]);
  assert.equal(saved.length, 4); assert.equal(saved[0].id, 'x-ExamWeek'); assert.equal(saved[0].cta.action, 'url'); assert.equal(saved[0].cta.href, 'https://studytok.vidmoat.com/news');
  assert.equal((await extraMoments()).length, 3, 'the untitled one is not served');
  const uid = 'u-extra';
  const m = await pickMoment(uid, { session: { viewed: 10 }, ctx: ctxFor() });
  assert.equal(m.id, 'x-ExamWeek', 'extras come before the catalogue; expired and too-advanced ones are skipped');
  await noteMoment(uid, m, 10);
  const next = await pickMoment(uid, { session: { viewed: 10 + GAP }, ctx: ctxFor() });
  assert.notEqual(next.id, 'x-ExamWeek', 'not repeated inside its window');
  await kv.set(`user:${uid}:moments`, { seen: { 'x-ExamWeek': Date.now() - 4 * 86400000 }, at: 0, day: '', today: 0 });
  assert.equal((await pickMoment(uid, { session: { viewed: 10 }, ctx: ctxFor() })).id, 'x-ExamWeek', 'back after repeatDays');
  await setExtraMoments([]);
});

test('moment events are registered', () => {
  assert.deepEqual(Object.keys(EVENT_SPECS.moment_view.fields), ['id', 'kind']);
  assert.deepEqual(Object.keys(EVENT_SPECS.moment_cta.fields), ['id', 'action']);
});
