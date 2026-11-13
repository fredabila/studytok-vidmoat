// Worlds: what a student is into outside school, found from evidence by fixed weights, and how
// lessons are set there. Everything is deterministic: the same history gives the same answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-worlds-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { WORLDS, WORLD_IDS, worldsIn, worldScores, adopted, probeWorld, assignWorlds, worldFit, worldBrief, worldProfile, cleanWorlds, ADOPT, DROP, FIT, MAX_WORLDS, PROBE_EVERY } = await import('../server/feed/worlds.js');
const { scoreVideo } = await import('../server/feed/ranking.js');
const { saveProfile, editProfile, worldScoresFor, noteWorldMentions, worldsView } = await import('../server/feed/index.js');
const { EVENT_SPECS } = await import('../server/feed/events.js');

test('the catalogue is well formed and school-safe', () => {
  assert.ok(WORLDS.length >= 12);
  assert.equal(new Set(WORLD_IDS).size, WORLDS.length);
  for (const w of WORLDS) { assert.ok(w.label && w.emoji && w.draw.length > 20 && w.words.length >= 3, w.id); assert.match(w.id, /^[a-z]+$/); }
  assert.ok(!WORLDS.some((w) => /gambl|betting|dating|alcohol|vape/i.test(`${w.id} ${w.label} ${w.draw} ${w.words.join(' ')}`)));
  assert.deepEqual(cleanWorlds(['football', 'nope', 'football', 'music']), ['football', 'music']);
});

test('free text reveals worlds by whole words only', () => {
  assert.deepEqual(worldsIn('Why does a free kick curve like that?'), ['football']);
  assert.deepEqual(worldsIn('explain momentum with fortnite or minecraft').sort(), ['gaming']);
  assert.deepEqual(worldsIn('how does my phone battery work').sort(), ['tech']);
  assert.deepEqual(worldsIn('What is the Carnot cycle?'), [], '"car" inside a word is not cars');
  assert.deepEqual(worldsIn('particle physics'), [], '"art" inside a word is not art');
  assert.deepEqual(worldsIn(''), []);
});

test('scores are a fixed sum of the evidence, best first, with reasons', () => {
  const none = worldScores({});
  assert.ok(none.every((s) => s.score === 0) && none[0].id === WORLD_IDS[0], 'no evidence: catalogue order');
  const s = worldScores({ said: ['music'], watched: { football: { views: 4, completes: 2, likes: 1, pctSum: 2.5 }, gaming: { views: 3, skips: 2, less: 1 } }, mentions: { food: 9 } });
  const of = (id) => s.find((x) => x.id === id);
  assert.equal(of('music').score, 3);
  assert.equal(of('football').score, 2 + 2 + 0.5); // 2 finished, 1 liked, half of another watched
  assert.equal(of('gaming').score, -2 - 3);
  assert.equal(of('food').score, 4.5, 'mentions are capped at three');
  assert.deepEqual(s.slice(0, 3).map((x) => x.id), ['football', 'food', 'music'], 'a tie goes to catalogue order');
  assert.ok(of('football').why.includes('2 finished') && of('football').why.includes('1 liked'));
  assert.deepEqual(worldScores({ said: ['music'], watched: { football: { views: 4, completes: 2, likes: 1, pctSum: 2.5 } } }), worldScores({ said: ['music'], watched: { football: { views: 4, completes: 2, likes: 1, pctSum: 2.5 } } }), 'same evidence, same answer');
  assert.deepEqual(adopted(s), ['football', 'food', 'music']);
  assert.ok(adopted(worldScores({ said: WORLD_IDS.slice(0, 8) })).length === MAX_WORLDS);
  assert.ok(of('gaming').score <= DROP && of('music').score >= ADOPT);
  assert.equal(worldScores({ said: ['music'], declined: ['music'] }).find((x) => x.id === 'music').score, -3, 'removing it outweighs having picked it');
});

test('a batch is set in the student\'s worlds: rank order, one episode plain, the unit\'s last worlds last', () => {
  const s = worldScores({ said: ['music', 'football'], watched: { football: { completes: 3 } } }); // football 6, music 3
  assert.deepEqual(assignWorlds(3, s, { tried: 0 }), ['football', 'music', null]);
  assert.deepEqual(assignWorlds(3, s, { tried: 0, recentUnit: ['football'] }), ['music', 'football', null], 'this unit just did football');
  assert.deepEqual(assignWorlds(1, s, { tried: 0 }), ['football']);
  assert.deepEqual(assignWorlds(6, s, { tried: 0, allowProbe: false }), ['football', 'music', null, 'football', 'music', null]);
  assert.deepEqual(assignWorlds(3, s, { tried: 0 }), assignWorlds(3, s, { tried: 0 }), 'deterministic');
});

test('probing finds new interests: a never-seen world every third slot, and one per batch for a new student', () => {
  const fresh = worldScores({});
  assert.deepEqual(assignWorlds(3, fresh), [null, WORLD_IDS[0], null], 'a new student: first episode plain, then one probe');
  assert.deepEqual(assignWorlds(3, fresh, { allowProbe: false }), [null, null, null], 'no experiments for young children or review');
  const seen = worldScores({ watched: { [WORLD_IDS[0]]: { views: 1 }, [WORLD_IDS[1]]: { views: 1 } } });
  assert.equal(probeWorld(seen), WORLD_IDS[2], 'the least-seen world, in catalogue order');
  const s = worldScores({ said: ['music'] });
  const withProbe = assignWorlds(3, s, { tried: PROBE_EVERY - 1 });
  assert.equal(withProbe[0], WORLD_IDS[0] === 'music' ? WORLD_IDS[1] : WORLD_IDS[0], 'slot 1 is the third world lesson: a probe');
  assert.equal(withProbe[1], 'music');
  const dropped = worldScores({ watched: { [WORLD_IDS[0]]: { views: 2, skips: 2, less: 1 } } });
  assert.notEqual(probeWorld(dropped), WORLD_IDS[0], 'a dropped world is not tried again');
});

test('ranking prefers a lesson set in an adopted world and avoids a dropped one', () => {
  const s = worldScores({ said: ['music'], watched: { gaming: { views: 3, skips: 3 }, food: { views: 2 } } });
  assert.equal(worldFit(null, s), 1);
  assert.equal(worldFit('music', s), FIT.adopted);
  assert.equal(worldFit('gaming', s), FIT.dropped);
  assert.equal(worldFit('football', s), FIT.fresh, 'never seen: a small nudge so it gets tried');
  assert.equal(worldFit('food', s), 1, 'seen, no verdict yet');
  const stats = { views: 10, completes: 8, likes: 1, skips: 1, quizRight: 3, quizWrong: 1 };
  const rand = () => 0.5;
  const score = (world) => scoreVideo({ id: 'v', format: 'explain', topic: 'math', world }, stats, {}, {}, { rand, worldFit: (w) => worldFit(w, s) });
  assert.ok(score('music').score > score(null).score && score(null).score > score('gaming').score);
  assert.equal(score('music').parts.world, FIT.adopted);
  assert.equal(score(null).parts.world, undefined);
});

test('the writer is told to teach the unit through the world, without inventing facts about real people', () => {
  const b = worldBrief('football', { minor: true });
  assert.match(b, /WORLD: Football/); assert.match(b, /do not invent/); assert.match(b, /quiz.*stay on the syllabus idea/); assert.match(b, /school-safe/);
  assert.equal(worldBrief('nope'), '');
});

test('profile: picking, picking up from behaviour and mentions, and "not for me"', async () => {
  const u = await saveProfile(null, { profile: { level: 'high-school', age: 20 }, interests: ['physics'], worlds: ['music', 'bogus'] });
  assert.deepEqual(u.worlds, ['music']);
  await noteWorldMentions(u.id, 'why does a free kick curve');
  await noteWorldMentions(u.id, 'best football boots physics');
  const signals = { worlds: { gaming: { views: 3, completes: 3 } } };
  let view = await worldsView(u, signals);
  const state = (id) => view.find((w) => w.id === id).state;
  assert.equal(state('music'), 'said'); assert.equal(state('gaming'), 'found'); assert.equal(state('football'), 'found', 'two mentions = 3 points');
  assert.equal(state('dance'), 'open');
  // Unticking a picked-up world and a picked one says "not for me" for both.
  const { user } = await editProfile(u.id, { worlds: [], worldsOff: ['gaming'] });
  assert.deepEqual(user.worlds, []); assert.deepEqual(user.worldsOff.sort(), ['gaming', 'music']);
  view = worldProfile(await worldScoresFor(user, signals), user.worlds);
  assert.equal(view.find((w) => w.id === 'gaming').state, 'dropped');
  // Picking it again clears the "not for me".
  const again = await editProfile(u.id, { worlds: ['gaming'] });
  assert.deepEqual(again.user.worldsOff, ['music']);
  assert.ok(EVENT_SPECS.worlds_set);
});
