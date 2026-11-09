// Mini games: material from watched lessons, the five builders, pacing, and how a result feeds
// unit mastery and the recall list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-games-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { kv } = await import('../server/core/kv.js');
const db = await import('../server/core/db.js');
const { materialOf, playable, buildGame, gameFor, pickGame, noteGame, gameOutcome, GAME_TYPES, MIN_VIEWED, GAP, MAX_PER_DAY } = await import('../server/feed/games.js');
const { recordEvent, getProgress } = await import('../server/feed/index.js');
const { getMisses } = await import('../server/feed/recall.js');
const { EVENT_SPECS } = await import('../server/feed/events.js');
const { SAMPLES } = await import('../server/lessons/samples.js');

// A seeded random so builds are reproducible.
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const videos = Object.entries(SAMPLES).map(([format, lesson], i) => ({
  id: uuid(i + 1), status: 'ready', format, topic: 'physics', unitId: `unit-${format}`, unitTitle: `Unit ${format}`,
  lesson: { ...lesson, format }, quiz: lesson.quiz?.question ? lesson.quiz : null, createdAt: new Date().toISOString(),
}));

test('material: every format contributes what it can, and all five games are playable', () => {
  const m = materialOf(videos);
  assert.ok(m.pairs.length >= 4, `pairs ${m.pairs.length}`);
  assert.ok(m.pairs.some((p) => p.left === 'Inertia' && /resist/.test(p.right)), 'a definition becomes a pair');
  assert.ok(m.pairs.some((p) => p.left === 'Unit of force?'), 'flashcards become pairs');
  assert.ok(m.lists.some((l) => l.items[0].text === 'Car stops in 0.1 s'), 'a step list');
  const timeline = m.lists.find((l) => l.items.some((x) => x.label === '1665'));
  assert.deepEqual(timeline.items.map((x) => x.label), ['1665', '1666', '1687'], 'a timeline, oldest first');
  const history = m.lists.find((l) => l.items.some((x) => x.label === '2019'));
  assert.deepEqual(history.items.map((x) => x.label), ['1687', '1859', '1915', '2019']);
  assert.ok(m.sorts.some((s) => s.left === 'Rough floor' && s.chips.length === 6));
  assert.ok(m.statements.filter((s) => s.truth).length >= 2 && m.statements.filter((s) => !s.truth).length >= 2);
  assert.ok(m.statements.some((s) => s.text === 'Weight is measured in newtons.' && s.truth === true && /force/.test(s.why)));
  assert.ok(m.gaps.some((g) => g.answer === 'Friction' && g.sentence.includes('____') && !/friction/i.test(g.sentence)));
  assert.deepEqual(playable(m).sort(), [...GAME_TYPES].sort());
  assert.deepEqual(playable(materialOf([])), []);
  assert.equal(buildGame('match', materialOf([])), null);
  assert.equal(buildGame('nope', materialOf(videos)), null);
});

test('each builder makes a well-formed game with one source per scored item', () => {
  const m = materialOf(videos);
  const rand = seeded(3);
  const match = buildGame('match', m, rand);
  assert.ok(match.game.pairs.length >= 3 && match.game.pairs.length <= 4);
  assert.equal(new Set(match.game.pairs.map((p) => p.left)).size, match.game.pairs.length);
  assert.equal(new Set(match.game.pairs.map((p) => p.right)).size, match.game.pairs.length);
  assert.equal(match.key.length, match.game.pairs.length);
  const order = buildGame('order', m, rand);
  assert.ok(order.game.items.length >= 3 && order.game.items.length <= 6); assert.equal(order.key.length, order.game.items.length);
  assert.ok(order.game.prompt);
  const sort = buildGame('sort', m, rand);
  assert.ok(sort.game.left && sort.game.right); assert.ok(sort.game.chips.every((c) => c.side === 'L' || c.side === 'R'));
  assert.equal(sort.game.chips.filter((c) => c.side === 'L').length, sort.game.chips.filter((c) => c.side === 'R').length);
  assert.equal(sort.key.length, sort.game.chips.length);
  const tf = buildGame('truefalse', m, rand);
  assert.ok(tf.game.statements.length >= 4 && tf.game.statements.length <= 6);
  assert.ok(tf.game.statements.some((s) => s.truth) && tf.game.statements.some((s) => !s.truth), 'always both kinds');
  assert.equal(tf.game.seconds, 6); assert.equal(tf.key.length, tf.game.statements.length);
  const fill = buildGame('fillgap', m, rand);
  assert.equal(fill.game.rounds.length, 3);
  for (const r of fill.game.rounds) {
    assert.ok(r.sentence.includes('____')); assert.equal(r.options.length, 3); assert.equal(new Set(r.options.map((o) => o.toLowerCase())).size, 3);
    assert.ok(r.answerIndex >= 0 && r.answerIndex < 3);
  }
  assert.equal(fill.key.length, 3);
  for (const b of [match, order, sort, tf, fill]) assert.ok(b.key.every((k) => k.videoId && k.unitId));
});

test('pacing: nothing early in a session, then one every GAP lessons, at most MAX_PER_DAY a day', async () => {
  const uid = 'pacer';
  const rand = seeded(11);
  assert.equal(await pickGame(uid, { session: { sid: 's', viewed: MIN_VIEWED - 1 }, videos, rand }), null);
  const first = await pickGame(uid, { session: { sid: 's', viewed: MIN_VIEWED }, videos, rand });
  assert.equal(first.kind, 'game'); assert.ok(GAME_TYPES.includes(first.game.type)); assert.match(first.id, /^game:/);
  await noteGame(uid, first, { sid: 's', viewed: MIN_VIEWED });
  assert.equal(await pickGame(uid, { session: { sid: 's', viewed: MIN_VIEWED + GAP - 1 }, videos, rand }), null, 'gap');
  const second = await pickGame(uid, { session: { sid: 's', viewed: MIN_VIEWED + GAP }, videos, rand });
  assert.ok(second); assert.notEqual(second.game.type, first.game.type, 'not the same kind twice running');
  let viewed = MIN_VIEWED + GAP;
  await noteGame(uid, second, { sid: 's', viewed });
  for (let i = 2; i < MAX_PER_DAY; i++) { viewed += GAP; const g = await pickGame(uid, { session: { sid: 's', viewed }, videos, rand }); assert.ok(g); await noteGame(uid, g, { sid: 's', viewed }); }
  assert.equal(await pickGame(uid, { session: { sid: 's', viewed: viewed + GAP }, videos, rand }), null, 'daily cap');
  assert.equal(await pickGame('fresh', { session: { sid: 's', viewed: 20 }, videos: [], rand }), null, 'no material, no game');
});

test('a result updates each unit behind the game once, brings missed lessons back, and counts only once', async () => {
  for (const v of videos) await db.saveVideo(v);
  const uid = 'player-1';
  const item = await gameFor(uid, { type: 'truefalse', videos, rand: seeded(5) });
  const id = item.game.id;
  const stored = await kv.get(`game:${id}`);
  assert.equal(stored.userId, uid); assert.equal(stored.key.length, item.game.statements.length);
  assert.equal(await gameOutcome('someone-else', id, []), null, 'only the player can report it');
  const wrongIdx = 0;
  const wrongUnit = stored.key[wrongIdx].unitId;
  await recordEvent(uid, { type: 'game_result', id, game: 'truefalse', score: item.game.statements.length - 1, total: item.game.statements.length, wrong: String(wrongIdx), ms: 30000 });
  const progress = await getProgress(uid);
  assert.equal(progress[wrongUnit].quizWrong, 1, 'the unit with a miss counts one wrong answer');
  const okUnits = [...new Set(stored.key.map((k) => k.unitId))].filter((u) => u !== wrongUnit);
  for (const u of okUnits) assert.equal(progress[u].quizRight, 1, `${u} counts one right answer`);
  const misses = await getMisses(uid);
  const missedVideo = videos.find((v) => v.id === stored.key[wrongIdx].videoId);
  if (missedVideo.quiz) assert.ok(misses.some((m) => m.videoId === missedVideo.id), 'the missed lesson comes back as a recall card');
  await recordEvent(uid, { type: 'game_result', id, game: 'truefalse', score: 0, total: 6, wrong: '0,1,2', ms: 1 });
  assert.equal((await getProgress(uid))[wrongUnit].quizWrong, 1, 'a second report of the same game is ignored');
  assert.equal(await kv.get(`game:${id}`), null);
});

test('game events are registered', () => {
  assert.deepEqual(Object.keys(EVENT_SPECS.game_result.fields), ['id', 'game', 'score', 'total', 'wrong', 'ms']);
  assert.ok(EVENT_SPECS.game_view && EVENT_SPECS.game_open);
});
