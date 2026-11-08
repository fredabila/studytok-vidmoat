// Event ingestion and the second ranking stage (which video of a unit), against the in-memory KV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-events-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
process.env.STUDYTOK_READY_AHEAD = '0';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const db = await import('../server/core/db.js');
const { ingest, cleanEvent, getSignals, getSession, stats, formatPerformance, EVENT_SPECS, weekKey, recapOf, studentStats, streakOf, hookGuidance, bestVoiceFor } = await import('../server/feed/events.js');
const { scoreVideo, affinity, exploreRate, videoQuality, applyEvent, emptyState } = await import('../server/feed/ranking.js');
const { saveProfile, getProgress } = await import('../server/feed/index.js');

const seeded = (seed = 1) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
async function video(format, topic = 'biology') {
  const v = { id: crypto.randomUUID(), unitId: 'hs-biology-1', unitTitle: 'Cells', topic, level: 'high-school', readyKey: 'k', status: 'ready', format, createdAt: new Date().toISOString(), duration: 40 };
  await db.saveVideo(v);
  return v;
}

test('cleanEvent drops unknown types and fields, clamps numbers, requires a video id where needed', () => {
  assert.equal(cleanEvent({ type: 'nonsense' }), null);
  assert.equal(cleanEvent({ type: 'view' }), null, 'view needs a videoId');
  const e = cleanEvent({ type: 'leave', videoId: crypto.randomUUID(), pct: 7, watched: -3, dir: 'next', extra: 'x', early: 'yes' });
  assert.equal(e.pct, 1); assert.equal(e.watched, 0); assert.equal(e.dir, 'next'); assert.equal(e.early, false); assert.equal('extra' in e, false);
  for (const spec of Object.values(EVENT_SPECS)) for (const kind of Object.values(spec.fields)) assert.ok('npbsi'.includes(kind));
});

test('a batch of events updates video stats, format stats, unit progress, tastes and the session', async () => {
  const user = await saveProfile(null, { profile: { level: 'high-school' }, units: ['hs-biology-1'] });
  const v = await video('rapid');
  const at = Date.now();
  const { accepted } = await ingest(user.id, { ctx: { sid: 's1', tz: 'Africa/Accra', vw: 390, vh: 844 }, events: [
    { type: 'impression', videoId: v.id, at },
    { type: 'view', videoId: v.id, at: at + 1000, nth: 1 },
    { type: 'view', videoId: v.id, at: at + 1500 }, // once per viewer
    { type: 'scene', videoId: v.id, sceneId: 'hook', kind: 'hook', at: at + 1000 },
    { type: 'scene', videoId: v.id, sceneId: 'item0', kind: 'item', at: at + 4000 },
    { type: 'like', videoId: v.id, at: at + 5000, by: 'double-tap' },
    { type: 'quiz_answer', videoId: v.id, correct: true, choice: 1, ms: 4200, at: at + 30000 },
    { type: 'complete', videoId: v.id, at: at + 39000 },
    { type: 'leave', videoId: v.id, pct: 0.95, watched: 38, maxT: 39, dir: 'next', early: false, at: at + 40000 },
    { type: 'bogus', videoId: v.id },
  ] });
  assert.equal(accepted, 9);
  const s = await db.getStats(v.id);
  assert.equal(s.views, 1, 'view counted once');
  assert.equal(s.likes, 1); assert.equal(s.completes, 1); assert.equal(s.quizRight, 1); assert.equal(s.leaves, 1); assert.equal(s.pctSum, 95);
  const h = await kv.hgetall(`video:${v.id}:stats`);
  assert.equal(Number(h.impressions), 1); assert.equal(Number(h.wf4), 1); assert.equal(Number(h.answerMs), 4200); assert.equal(Number(h.dir_next), 1);
  assert.deepEqual(await kv.hgetall(`video:${v.id}:scenes`), { hook: 1, item0: 1 });
  const f = await kv.hgetall('stats:format:rapid');
  assert.equal(Number(f.views), 1); assert.equal(Number(f.pctSum), 95);
  assert.ok(await kv.hgetall('stats:format:rapid:biology'));
  const progress = await getProgress(user.id);
  assert.equal(progress['hs-biology-1'].completes, 1); assert.equal(progress['hs-biology-1'].watchN, 1); assert.equal(progress['hs-biology-1'].box, 1);
  const sig = await getSignals(user.id);
  assert.equal(sig.formats.rapid.likes, 1); assert.equal(sig.formats.rapid.right, 1); assert.equal(sig.quiz.n, 1); assert.equal(sig.watch.completes, 1);
  assert.equal(sig.hours.reduce((a, b) => a + b, 0), 9, 'every accepted event lands in an hour bucket');
  const session = await getSession(user.id);
  assert.equal(session.sid, 's1'); assert.equal(session.viewed, 1); assert.equal(session.rightStreak, 1); assert.deepEqual(session.lastFormats, ['rapid']);
  assert.equal((await kv.lrange('events:log', 0, 99)).length, 9);
  const day = new Date(at).toISOString().slice(0, 10);
  assert.equal(Number((await kv.hgetall(`events:day:${day}`)).view), 2, 'day counts count every event received');
  assert.ok((await db.inSet(user.id, 'liked', v.id)) && (await db.inSet(user.id, 'seen', v.id)));
});

test('an early leave counts as a skip and feeds the early streak; a new sid starts a new session', async () => {
  const user = await saveProfile(null, { profile: { level: 'high-school' }, units: ['hs-biology-1'] });
  const v = await video('story');
  await ingest(user.id, { ctx: { sid: 'a' }, events: [{ type: 'view', videoId: v.id }, { type: 'leave', videoId: v.id, watched: 1, pct: 0.03, dir: 'next' }] });
  assert.equal((await db.getStats(v.id)).skips, 1);
  let session = await getSession(user.id);
  assert.equal(session.earlyStreak, 1);
  await ingest(user.id, { ctx: { sid: 'b' }, events: [{ type: 'session_start' }] });
  session = await getSession(user.id);
  assert.equal(session.sid, 'b'); assert.equal(session.earlyStreak, 0);
  assert.equal((await getSignals(user.id)).sessions, 2);
});

test('stats and formatPerformance summarise the aggregates', async () => {
  const s = await stats({ formats: ['rapid', 'story', 'chat'] });
  assert.equal(s.byFormat.rapid.views, 1); assert.equal(s.byFormat.rapid.completionRate, 1); assert.equal(s.byFormat.rapid.meanWatch, 0.95);
  assert.equal(s.byFormat.chat.views, 0); assert.equal(s.byFormat.chat.meanWatch, null);
  const perf = await formatPerformance('biology', ['rapid', 'story', 'chat']);
  assert.ok(perf.rapid > 1 && perf.story < 1 && perf.chat === 1, JSON.stringify(perf));
  assert.ok(perf.rapid < 1.1, 'one view is weak evidence: shrunk toward 1');
});

test('scoreVideo: taste, diversity, fatigue and difficulty move the score the right way', () => {
  const rand = seeded(4);
  const good = { views: 20, completes: 15, likes: 4, saves: 2, skips: 1, quizRight: 8, quizWrong: 2, leaves: 18, pctSum: 1500 };
  const poor = { views: 20, completes: 2, likes: 0, saves: 0, skips: 10, quizRight: 2, quizWrong: 6, leaves: 18, pctSum: 400 };
  assert.ok(videoQuality(good) > videoQuality(poor));
  const v = { id: 'x', format: 'examdrill', topic: 'math', createdAt: new Date().toISOString() };
  const base = scoreVideo(v, good, {}, {}, { rand }).score;
  const loved = scoreVideo(v, good, { formats: { examdrill: { completes: 10, likes: 5, right: 6, n: 10, pctSum: 9 } } }, {}, { rand });
  assert.ok(loved.parts.formatAffinity > 0.7 && loved.score > base, 'a format the student finishes scores higher');
  const repeat = scoreVideo(v, good, {}, { lastFormats: ['examdrill'] }, { rand });
  assert.equal(repeat.parts.diversity, 0.6);
  const tired = scoreVideo(v, good, {}, { viewed: 20 }, { rand });
  assert.ok(tired.parts.fatigue < 1, 'exam drills are heavy late in a session');
  const light = scoreVideo({ ...v, format: 'rapid' }, good, {}, { viewed: 20 }, { rand });
  assert.ok(light.parts.fatigue > 1);
  const struggling = scoreVideo(v, good, {}, { wrongStreak: 2 }, { rand });
  const gentle = scoreVideo({ ...v, format: 'explain' }, good, {}, { wrongStreak: 2 }, { rand });
  assert.ok(struggling.parts.difficulty < gentle.parts.difficulty);
  const streak = scoreVideo(v, good, {}, { rightStreak: 3 }, { rand });
  assert.ok(streak.parts.difficulty > 1);
});

test('affinity shrinks to 0.5 without evidence; exploration decays', () => {
  assert.equal(affinity(undefined), 0.5);
  const rand = seeded(2);
  const weak = Array.from({ length: 200 }, () => affinity({ likes: 1 }, rand));
  assert.ok(Math.abs(weak.reduce((a, b) => a + b) / 200 - 0.5) < 0.12);
  const strong = Array.from({ length: 200 }, () => affinity({ completes: 20, likes: 10, n: 20, pctSum: 19 }, rand));
  assert.ok(strong.reduce((a, b) => a + b) / 200 > 0.85);
  assert.equal(exploreRate(0), 0); assert.equal(exploreRate(7), 0);
  assert.ok(exploreRate(8) > exploreRate(50) && exploreRate(5000) >= 0.03);
  const s = applyEvent(emptyState(), 'leave', { pct: 0.6 });
  assert.equal(s.watchN, 1); assert.equal(s.pctSum, 0.6);
});

test('weekly recap and level-ups: a unit crossing mastery is reported once and kept in the week', async () => {
  const user = await saveProfile(null, { profile: { level: 'high-school' }, units: ['hs-biology-1'] });
  const at = Date.UTC(2026, 10, 4, 10); // Wednesday 4 Nov 2026
  assert.equal(weekKey(at), '2026-11-02', 'weeks start on Monday');
  assert.equal(weekKey(Date.UTC(2026, 10, 1)), '2026-10-26', 'Sunday belongs to the previous Monday');
  const vids = [];
  for (let i = 0; i < 3; i++) vids.push(await video('explain'));
  let ups = [];
  for (const [i, v] of vids.entries()) {
    const r = await ingest(user.id, { ctx: { sid: 'w' }, events: [
      { type: 'view', videoId: v.id, at: at + i * 1000 },
      { type: 'complete', videoId: v.id, at: at + i * 1000 + 100 },
      { type: 'quiz_answer', videoId: v.id, correct: true, choice: 0, ms: 1500, at: at + i * 1000 + 200 },
      { type: 'leave', videoId: v.id, pct: 1, watched: 40, dir: 'next', at: at + i * 1000 + 300 },
    ] });
    ups = ups.concat(r.levelUps);
  }
  assert.equal(ups.length, 1, 'exactly one level-up as mastery crosses 0.7');
  assert.equal(ups[0].title, 'Cells');
  const s = await getSignals(user.id);
  const recap = recapOf(s, '2026-11-02');
  assert.equal(recap.watched, 3); assert.equal(recap.completes, 3); assert.equal(recap.quizN, 3); assert.equal(recap.quizRight, 3); assert.equal(recap.minutes, 2);
  assert.deepEqual(recap.mastered, ['Cells']); assert.equal(recap.topFormat, 'explain'); assert.equal(recap.days, 1);
  assert.equal(recapOf(s, '2026-10-26'), null, 'an empty week has no recap');
  const st = await studentStats(user.id, { watched: 3, progress: {}, now: at + 86400000 });
  assert.equal(st.week.watched, 3); assert.equal(st.lastWeek, null);
  const later = await studentStats(user.id, { watched: 3, progress: {}, now: at + 8 * 86400000 });
  assert.equal(later.week, null); assert.equal(later.lastWeek.watched, 3);
  assert.equal(streakOf(s, at + 3600000), 1);
});

test('leaving mid-video records the scene kind per format, the hook style, the voice and the posture', async () => {
  const user = await saveProfile(null, { profile: { level: 'high-school' }, units: ['hs-biology-1'] });
  const v = { id: crypto.randomUUID(), unitId: 'hs-biology-1', unitTitle: 'Cells', topic: 'biology', level: 'high-school', readyKey: 'k', status: 'ready', format: 'story', createdAt: new Date().toISOString(), duration: 40,
    scenes: [{ id: 'hook', kind: 'hook', start: 0 }, { id: 'beat0', kind: 'beat', start: 3 }, { id: 'quizQ', kind: 'quiz', start: 25 }], voice: { voiceId: 'sage' }, musicMood: 'cinematic', lesson: { hookStyle: 'story' } };
  await db.saveVideo(v);
  await ingest(user.id, { ctx: { sid: 'p', posture: 'moving' }, events: [
    { type: 'view', videoId: v.id }, { type: 'heartbeat', videoId: v.id, t: 5, posture: 'moving' },
    { type: 'leave', videoId: v.id, t: 12, maxT: 12, pct: 0.3, watched: 12, dir: 'next', posture: 'moving' },
  ] });
  assert.deepEqual(await kv.hgetall('stats:format:story:leaveAt'), { beat: 1 });
  assert.equal(Number((await kv.hgetall('stats:voice:sage')).pctSum), 30);
  assert.equal(Number((await kv.hgetall('stats:music:cinematic')).n), 1);
  assert.equal(Number((await kv.hgetall('stats:hook:story:biology')).n), 1);
  const session = await getSession(user.id);
  assert.equal(session.posture, 'moving');
  const sig = await getSignals(user.id);
  assert.equal(sig.postures.moving.n, 1); assert.equal(sig.hooks.story.n, 1);
  const s = await stats({ formats: ['story'] });
  assert.deepEqual(s.leaveAt.story, { beat: 1 }); assert.equal(s.hooks.story.n, 1); assert.equal(s.voices.sage.meanWatch, 0.3);
});

test('hook guidance and voice learning need evidence before they speak', async () => {
  assert.deepEqual(await hookGuidance('chemistry'), { hold: [], lose: [], student: [] });
  for (let i = 0; i < 20; i++) { await kv.hincrby('stats:hook:number:chemistry', 'n', 1); await kv.hincrby('stats:hook:number:chemistry', 'pctSum', 80); }
  for (let i = 0; i < 20; i++) { await kv.hincrby('stats:hook:claim:chemistry', 'n', 1); await kv.hincrby('stats:hook:claim:chemistry', 'pctSum', 20); await kv.hincrby('stats:hook:claim:chemistry', 'early', 1); }
  const g = await hookGuidance('chemistry', { hooks: { question: { n: 5, pctSum: 4.5 }, pain: { n: 6, pctSum: 2 }, secret: { n: 1, pctSum: 1 } } });
  assert.deepEqual(g.hold, ['number']); assert.deepEqual(g.lose, ['claim']); assert.deepEqual(g.student, ['question', 'pain']);
  assert.equal(await bestVoiceFor(['marin', 'nova']), null, 'no data: keep the format voice');
  for (let i = 0; i < 50; i++) { await kv.hincrby('stats:voice:marin', 'n', 1); await kv.hincrby('stats:voice:marin', 'pctSum', 50); await kv.hincrby('stats:voice:nova', 'n', 1); await kv.hincrby('stats:voice:nova', 'pctSum', 70); }
  assert.equal(await bestVoiceFor(['marin', 'nova']), 'nova', 'a clearly better voice with enough views wins');
  assert.equal(await bestVoiceFor(['nova', 'marin']), null, 'the default stays when it is already the best');
});

test('context: on the move narration-led formats win; late at night lying down, gentle ones do', () => {
  const rand = seeded(8);
  const good = { views: 20, completes: 15, likes: 4, saves: 2, skips: 1, quizRight: 8, quizWrong: 2, leaves: 18, pctSum: 1500 };
  const dense = scoreVideo({ format: 'spotmistake', topic: 'math' }, good, {}, { posture: 'moving' }, { rand });
  const spoken = scoreVideo({ format: 'story', topic: 'math' }, good, {}, { posture: 'moving' }, { rand });
  assert.ok(dense.parts.context < 1 && spoken.parts.context > 1, JSON.stringify([dense.parts.context, spoken.parts.context]));
  const nightDrill = scoreVideo({ format: 'examdrill', topic: 'math' }, good, {}, { posture: 'flat', night: true }, { rand });
  const nightExplain = scoreVideo({ format: 'explain', topic: 'math' }, good, {}, { posture: 'flat', night: true }, { rand });
  assert.ok(nightDrill.parts.context < nightExplain.parts.context);
  assert.equal(scoreVideo({ format: 'explain', topic: 'math' }, good, {}, {}, { rand }).parts.context, 1);
});

test('quizGuidance speaks only with evidence: too easy, too hard, or nothing; studentStats counts today and what is due', async () => {
  const { quizGuidance } = await import('../server/feed/events.js');
  assert.equal(await quizGuidance('law'), null, 'no data, no note');
  await kv.hincrby('stats:format:explain:law', 'quizRight', 18); await kv.hincrby('stats:format:flashcards:law', 'quizRight', 10); await kv.hincrby('stats:format:explain:law', 'quizWrong', 2);
  assert.match(await quizGuidance('law'), /make them harder/);
  await kv.hincrby('stats:format:explain:economics', 'quizRight', 6); await kv.hincrby('stats:format:explain:economics', 'quizWrong', 16);
  assert.match(await quizGuidance('economics'), /make them clearer/);
  await kv.hincrby('stats:format:explain:space', 'quizRight', 14); await kv.hincrby('stats:format:explain:space', 'quizWrong', 8);
  assert.equal(await quizGuidance('space'), null, 'a healthy mix needs no note');

  const user = await saveProfile(null, { profile: { level: 'high-school', program: 'Biology' }, units: ['hs-biology-1'] });
  const v1 = await video('explain'), v2 = await video('rapid');
  const now = Date.now();
  await ingest(user.id, { ctx: { sid: 'g' }, events: [{ type: 'view', videoId: v1.id, at: now }, { type: 'view', videoId: v2.id, at: now + 500 }, { type: 'quiz_answer', videoId: v1.id, correct: false, choice: 0, ms: 500, at: now + 900 }] });
  const st = await studentStats(user.id, { progress: await getProgress(user.id), now: now + 1000 });
  assert.equal(st.today, 2); assert.equal(st.goal, 3);
  assert.equal(st.due, 0, 'a wrong answer comes back in 20 minutes, not yet');
  const later = await studentStats(user.id, { progress: await getProgress(user.id), now: now + 25 * 60 * 1000 });
  assert.equal(later.due, 1, 'and then it is due');
  assert.equal(later.today, 2, 'same day');
});
