// The learning profile (StudyGraph's learning styles, measured): priors, evidence, the ranking
// multiplier, the insight line, and styles on the profile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-learning-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';
for (const k of Object.keys(process.env)) if (/REST_API_URL|REDIS_REST_URL/.test(k)) delete process.env[k];

const { learningProfile, styleFit, insightOf, cleanStyles, FORMAT_STYLE, STYLES } = await import('../server/feed/learning.js');
const { scoreVideo } = await import('../server/feed/ranking.js');
const { rulesOf, bucketOf, SHRINKABLE } = await import('../server/feed/calibration.js');
const { saveProfile, editProfile } = await import('../server/feed/index.js');
const { FORMAT_IDS } = await import('../server/video/formats.js');

test('every format maps to the four ways in, with weights that sum to one', () => {
  for (const f of FORMAT_IDS) {
    const w = FORMAT_STYLE[f];
    assert.ok(w, `${f} is mapped`);
    assert.ok(Object.keys(w).every((s) => STYLES.includes(s)));
    assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-9, `${f} sums to 1`);
  }
  assert.deepEqual(cleanStyles(['visual', 'nope', 'visual', 'handson']), ['visual', 'handson']);
});

test('no evidence: a flat profile with no confidence; what the student said is a prior, not the answer', () => {
  const empty = learningProfile({}, []);
  assert.equal(empty.confidence, 0); assert.equal(empty.measured, false);
  assert.ok(empty.styles.every((s) => s.score === 0.5));
  assert.equal(styleFit('story', empty), 1, 'no confidence, no effect');
  const said = learningProfile({}, ['visual']);
  assert.equal(said.top, 'visual'); assert.ok(said.confidence > 0 && said.confidence < 0.35); assert.deepEqual(said.said, ['visual']);
  assert.ok(styleFit('onething', said) > 1 && styleFit('guess', said) < 1);
});

test('evidence wins over what was said: a student who says visual but does best hands-on', () => {
  const signals = {
    formats: {
      guess: { n: 12, pctSum: 11, completes: 10, likes: 2, right: 9, wrong: 1 },
      challenge: { n: 8, pctSum: 7.4, completes: 7, right: 6, wrong: 1 },
      onething: { n: 10, pctSum: 4, completes: 2, skips: 4, right: 2, wrong: 4 },
      story: { n: 6, pctSum: 2.4, completes: 1, skips: 2 },
    },
    games: { byType: { sort: { n: 3, items: 12, right: 11 } } },
  };
  const lp = learningProfile(signals, ['visual']);
  assert.equal(lp.top, 'handson'); assert.equal(lp.measured, true); assert.ok(lp.confidence > 0.7);
  assert.ok(styleFit('guess', lp) > 1.03, `guess ${styleFit('guess', lp)}`); assert.ok(styleFit('story', lp) < 0.98, `story ${styleFit('story', lp)}`);
  assert.ok(styleFit('guess', lp) <= 1.12 && styleFit('story', lp) >= 0.88, 'bounded');
  const handson = lp.styles.find((s) => s.id === 'handson');
  assert.ok(handson.watch > 0.9 && handson.accuracy > 0.8);
  assert.match(insightOf(lp), /You watch 9\d% of hands-on lessons/);
  assert.equal(insightOf(learningProfile({}, [])), null);
});

test('the ranking applies the style multiplier as a calibratable rule', () => {
  const lp = learningProfile({ formats: { guess: { n: 20, pctSum: 19, completes: 18, right: 15, wrong: 2 }, story: { n: 20, pctSum: 6, skips: 8 } } }, []);
  const fit = (f) => styleFit(f, lp);
  const stats = { views: 0, completes: 0, skips: 0, likes: 0, quizRight: 0, quizWrong: 0 };
  const rand = () => 0.5;
  const a = scoreVideo({ format: 'guess', topic: 'physics' }, stats, {}, {}, { rand, styleFit: fit });
  const b = scoreVideo({ format: 'guess', topic: 'physics' }, stats, {}, {}, { rand });
  assert.ok(a.score > b.score); assert.equal(a.parts.style, fit('guess')); assert.equal(b.parts.style, undefined);
  const off = scoreVideo({ format: 'guess', topic: 'physics' }, stats, {}, {}, { rand, styleFit: fit, weights: { style: 0 } });
  assert.ok(Math.abs(off.score - b.score) < 1e-12, 'a fitted weight of 0 switches the rule off');
  assert.ok(SHRINKABLE.includes('style')); assert.equal(rulesOf(a.parts).style, a.parts.style); assert.equal(bucketOf('style', a.parts.style), 'up');
});

test('styles are kept on the profile, cleaned, and editable', async () => {
  const user = await saveProfile(null, { profile: { level: 'lifelong' }, interests: ['physics'], styles: ['reading', 'bogus', 'handson'] });
  assert.deepEqual(user.styles, ['reading', 'handson']);
  const again = await saveProfile(user.id, { profile: { level: 'lifelong' }, interests: ['physics'] });
  assert.deepEqual(again.styles, ['reading', 'handson'], 'kept when not sent');
  const { user: edited } = await editProfile(user.id, { styles: ['visual'] });
  assert.deepEqual(edited.styles, ['visual']);
});
