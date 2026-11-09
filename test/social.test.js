// Asking, comments, exam mode and the age rules around them (core/safety.js, feed/ask.js,
// feed/comments.js, feed/exam.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-social-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
process.env.STUDYTOK_READY_AHEAD = '0';
process.env.STUDYTOK_EXPERIMENTS = 'off';
process.env.STUDYTOK_REQUIRE_SIGNIN = 'false';
delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_AUTH_TOKEN;
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const db = await import('../server/core/db.js');
const { capabilitiesOf, isMinor } = await import('../server/core/safety.js');
const comments = await import('../server/feed/comments.js');
const { askAboutLesson, ASKS_PER_DAY } = await import('../server/feed/ask.js');
const { examPlan, mockExam, readinessOf, daysUntil } = await import('../server/feed/exam.js');
const { saveProfile } = await import('../server/feed/index.js');
const { handleApi } = await import('../server/app.js');

async function call(method, url, { cookie, body } = {}) {
  const req = { method, url, headers: { host: 'sg.example', 'x-forwarded-proto': 'https', ...(cookie ? { cookie: `st_uid=${cookie}` } : {}) },
    async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)); } };
  const out = { status: 0, headers: {}, body: '' };
  const res = { headersSent: false, writeHead(s, h) { out.status = s; out.headers = h; this.headersSent = true; }, end(b) { out.body = b == null ? '' : Buffer.isBuffer(b) ? b : b.toString(); } };
  await handleApi(req, res);
  out.json = () => JSON.parse(out.body);
  return out;
}

const lesson = {
  title: 'Newton’s third law', takeaway: 'Forces come in pairs.',
  beats: [{ text: 'Every push has an equal push back.', keyTerm: 'Third law' }],
  quiz: { question: 'You push a wall. What does the wall do?', options: ['Nothing', 'Pushes back equally', 'Pulls you'], answerIndex: 1, explanation: 'Equal and opposite.' },
};
const video = { id: crypto.randomUUID(), unitId: 'topic:physics', unitTitle: 'Physics', topic: 'physics', level: 'high-school', readyKey: 'k', status: 'ready', createdAt: new Date().toISOString(), lesson, quiz: lesson.quiz, duration: 30, format: 'explain' };
await db.saveVideo(video);

const adult = await saveProfile(null, { profile: { level: 'university', age: 22, country: 'GH' }, units: [], interests: ['physics'] });
adult.vidmoat = { name: 'Ama Kumi Mensah' };
await db.saveUser(adult);
const teen = await saveProfile(null, { profile: { level: 'high-school', age: 15, country: 'GH', managedBy: 'guardian' }, guardianConsent: true, units: [], interests: ['physics'] });
const kid = await saveProfile(null, { profile: { level: 'primary', age: 10, country: 'GH', managedBy: 'guardian' }, guardianConsent: true, units: [], interests: ['physics'] });

test('capabilities: minors cannot use comments or upload course pictures; everyone can ask', () => {
  assert.deepEqual(capabilitiesOf(adult), { minor: false, child: false, comments: true, commentPost: true, courseAvatar: true, ask: true });
  assert.equal(capabilitiesOf(teen).comments, false);
  assert.equal(capabilitiesOf(teen).commentPost, false);
  assert.equal(capabilitiesOf(teen).courseAvatar, false);
  assert.equal(capabilitiesOf(teen).ask, true);
  assert.equal(capabilitiesOf(kid).child, true);
  // No age on file: a guardian-managed profile is still a minor.
  assert.equal(isMinor({ profile: { managedBy: 'guardian' } }), true);
  assert.equal(isMinor({ profile: {} }), false);
});

test('API: minors are refused comments (read, post, report) and course pictures; /api/me says what they can do', async () => {
  for (const [m, url, body] of [['GET', `/api/videos/${video.id}/comments`], ['POST', `/api/videos/${video.id}/comments`, { text: 'Nice' }], ['POST', `/api/comments/${crypto.randomUUID()}/report`], ['POST', '/api/channels/whatever/avatar', { image: 'data:image/png;base64,AAAA' }]]) {
    const r = await call(m, url, { cookie: teen.id, body });
    assert.equal(r.status, 403, `${m} ${url}`);
    assert.equal(r.json().code, 'age');
  }
  const me = (await call('GET', '/api/me', { cookie: teen.id })).json().user;
  assert.equal(me.can.comments, false);
  assert.equal((await call('GET', '/api/me', { cookie: adult.id })).json().user.can.comments, true);
});

test('comments: links, emails, phones and contact asks are refused before any model; the model decides the rest', async () => {
  const yes = async () => ({ ok: true, reason: '' });
  for (const bad of ['see www.answers.com', 'mail me at a@b.co', 'call 024 123 4567', 'add me on whatsapp']) {
    assert.equal((await comments.checkComment(bad, { moderate: yes })).ok, false, bad);
  }
  assert.equal((await comments.checkComment('Great explanation, thanks!', { moderate: yes })).ok, true);
  assert.equal((await comments.checkComment('ok', { moderate: async () => ({ ok: false, reason: 'Keep it about the lesson' }) })).reason, 'Keep it about the lesson');
  assert.equal((await comments.checkComment('ok', { moderate: async () => { throw new Error('down'); } })).ok, false, 'fails closed');
  assert.equal((await comments.checkComment('Great lesson')).ok, false, 'no model configured: closed');
});

test('comments: post, list (name as first name + initial), report to hide, delete own only', async () => {
  const ok = async () => ({ ok: true });
  const now = Date.now();
  const c = await comments.postComment({ user: adult, videoId: video.id, text: '  Equal   and opposite, got it ', moderate: ok, now });
  assert.equal(c.text, 'Equal and opposite, got it');
  assert.equal(c.name, 'Ama M.');
  await assert.rejects(comments.postComment({ user: adult, videoId: video.id, text: 'again', moderate: ok, now: now + 1000 }), /Wait a few seconds/);
  let list = await comments.listComments(video.id, adult.id);
  assert.equal(list.count, 1);
  assert.equal(list.comments[0].mine, true);
  // Three different students report it: hidden.
  for (let i = 0; i < 3; i++) await comments.reportComment({ userId: `u${i}`, id: c.id });
  assert.equal((await comments.reportComment({ userId: 'u0', id: c.id })).hidden, true);
  list = await comments.listComments(video.id, adult.id);
  assert.equal(list.count, 0);
  const c2 = await comments.postComment({ user: adult, videoId: video.id, text: 'Second one', moderate: ok, now: now + 20_000 });
  await assert.rejects(comments.deleteComment({ userId: 'someone-else', id: c2.id }), /your own/);
  await comments.deleteComment({ userId: adult.id, id: c2.id });
  assert.equal((await comments.listComments(video.id, adult.id)).count, 0);
});

test('ask: answers with the lesson in context, tells the tutor the age, limits a day, fails politely', async () => {
  let seen;
  const fake = async (args) => { seen = args; return { answer: 'Because forces come in pairs.', followUp: 'Action and Reaction', onTopic: true }; };
  const r = await askAboutLesson({ userId: kid.id, video, question: 'why does the wall push back', audience: { age: 10, child: true }, ask: fake });
  assert.equal(r.answer, 'Because forces come in pairs.');
  assert.equal(r.followUp, 'Action and Reaction');
  assert.match(seen.context, /Newton’s third law/);
  assert.match(seen.context, /Pushes back equally/);
  assert.match(seen.system, /child under 13/);
  assert.match(seen.system, /trusted adult/);
  const off = await askAboutLesson({ userId: kid.id, video, question: 'who is the best footballer', audience: {}, ask: async () => ({ answer: 'I can only help with study questions.', followUp: 'Football Stars', onTopic: false }) });
  assert.equal(off.followUp, '', 'no follow-up lesson for an off-topic question');
  await assert.rejects(askAboutLesson({ userId: kid.id, video, question: 'x', ask: fake }), /Type your question/);
  await assert.rejects(askAboutLesson({ userId: kid.id, video, question: 'why?', ask: async () => { throw new Error('boom'); } }), /couldn't answer/);
  const day = new Date().toISOString().slice(0, 10);
  await kv.hincrby('ask:counts', `${kid.id}:${day}`, ASKS_PER_DAY);
  await assert.rejects(askAboutLesson({ userId: kid.id, video, question: 'one more?', ask: fake }), /questions today/);
  // Through the API without a tutor configured: 503, not a crash.
  assert.equal((await call('POST', `/api/videos/${video.id}/ask`, { cookie: adult.id, body: { q: 'why?' } })).status, 503);
});

test('exam: countdown, readiness, focus grows near the exam; mock questions come from watched lessons', async () => {
  assert.equal(daysUntil('2026-12-10', Date.parse('2026-12-01T00:00:00Z')), 9);
  assert.equal(daysUntil(''), null);
  assert.equal(readinessOf(0.8), 'ready');
  assert.equal(readinessOf(0.1), 'needs work');
  const near = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const u = { ...adult, units: ['topic:physics', 'topic:chemistry', 'topic:biology', 'topic:history', 'topic:space'], profile: { ...adult.profile, examDate: near, exam: 'WASSCE' } };
  const plan = await examPlan(u);
  assert.equal(plan.days, 5);
  assert.equal(plan.exam, 'WASSCE');
  assert.equal(plan.focus.length, 4, 'final week: four units a day');
  assert.equal(plan.units.length, 5);
  assert.deepEqual(await mockExam(u), [], 'nothing watched yet');
  await db.addToSet(u.id, 'seen', video.id);
  const qs = await mockExam(u);
  assert.equal(qs.length, 1);
  assert.equal(qs[0].question, lesson.quiz.question);
  assert.equal(qs[0].answerIndex, 1);
  const r = await call('GET', '/api/exam/mock', { cookie: adult.id });
  assert.equal(r.status, 200);
});
