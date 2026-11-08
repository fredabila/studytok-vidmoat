import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-test-')) + '/';

const { composeLesson, planTimeline, coverScale, timeWords } = await import('../server/compose.js');
const { sanitizeLesson } = await import('../server/lessons/schema.js');
const { BANK } = await import('../server/lessons/bank.js');
const { TOPICS } = await import('../server/topics.js');
const { pickTopic } = await import('../server/feed.js');
const { rank } = await import('../server/media.js');

const lesson = sanitizeLesson(BANK.biology[0], 'biology');
const media = {
  broll: [
    { src: 'https://api.vidmoat.com/uploads/a.mp4', type: 'video', width: 1280, height: 720, mediaDuration: 6 },
    { src: 'https://api.vidmoat.com/uploads/b.mp4', type: 'video', width: 1080, height: 1920, mediaDuration: 12 },
  ],
  music: { src: 'https://api.vidmoat.com/uploads/m.mp3' },
};

test('every topic has offline lessons that sanitize cleanly with a valid quiz', () => {
  for (const t of TOPICS) {
    assert.ok(BANK[t.id]?.length >= 2, `bank for ${t.id}`);
    for (const raw of BANK[t.id]) {
      const l = sanitizeLesson(raw, t.id);
      assert.ok(l.beats.length >= 2 && l.beats.length <= 4);
      assert.equal(l.quiz.options.length, 3);
      assert.ok(l.quiz.answerIndex >= 0 && l.quiz.answerIndex < 3);
      assert.ok(l.hook.toLowerCase().includes(l.hookTerm.toLowerCase()), `hookTerm appears in hook: ${l.title}`);
    }
  }
});

test('sanitizeLesson clamps lengths and repairs a bad answer index', () => {
  const l = sanitizeLesson({
    title: 'x'.repeat(200), hook: 'h', hookTerm: 'h', takeaway: 't',
    beats: [{ text: 'a b c', keyTerm: 'k', visual: 'v' }, { text: 'd e f', keyTerm: 'k2' }],
    quiz: { question: 'q', options: ['1', '2', '3', '4'], answerIndex: 7 },
  }, 'math');
  assert.ok(l.title.length <= 60);
  assert.equal(l.quiz.options.length, 3);
  assert.equal(l.quiz.answerIndex, 0);
  assert.equal(l.beats[1].visual, 'k2');
  assert.throws(() => sanitizeLesson({ beats: [{ text: 'only one' }] }, 'math'));
});

test('timeline covers hook, each beat, quiz and outro back to back', () => {
  const { segments, duration } = planTimeline(lesson);
  assert.deepEqual(segments.map((s) => s.kind), ['hook', 'beat', 'beat', 'beat', 'quiz', 'outro']);
  for (let i = 1; i < segments.length; i++) {
    assert.ok(Math.abs(segments[i].start - (segments[i - 1].start + segments[i - 1].duration)) < 0.02);
  }
  assert.ok(duration > 15 && duration < 45, `duration ${duration}`);
});

test('composeLesson emits a 9:16 project with every clip inside the timeline', () => {
  const { commands, duration } = composeLesson(lesson, media);
  assert.equal(commands[0].op, 'setProjectSettings');
  assert.equal(commands[0].aspectRatio, '9:16');
  const ids = new Set();
  for (const c of commands) {
    assert.ok(typeof c.op === 'string');
    if (c.clipId && c.op.startsWith('add') && c.op !== 'addKeyframe') {
      assert.ok(!ids.has(c.clipId), `duplicate clipId ${c.clipId}`);
      ids.add(c.clipId);
    }
    if (typeof c.start === 'number' && typeof c.duration === 'number') {
      assert.ok(c.start >= 0 && c.start + c.duration <= duration + 0.6, `${c.op} ${c.clipId} ends inside timeline`);
    }
    // fontSize and positions must live in style/patch, never at the top level (they would be ignored).
    assert.ok(!('fontSize' in c) && !('y' in c && c.op !== 'addCaptions'), `${c.op} has top-level layout fields`);
  }
  // b-roll for hook + 3 beats, alternating across the two supplied clips, with a music bed.
  assert.equal(commands.filter((c) => c.op === 'addClip').length, 4);
  assert.equal(commands.filter((c) => c.op === 'musicBed').length, 1);
  assert.ok(commands.some((c) => c.op === 'addCaptions'));
});

test('composeLesson works without media (text-only video)', () => {
  const { commands } = composeLesson(lesson, {});
  assert.equal(commands.filter((c) => c.op === 'addClip').length, 0);
  assert.equal(commands.filter((c) => c.op === 'musicBed').length, 0);
});

test('quiz reveal never overlaps the plain correct-answer text', () => {
  const { commands } = composeLesson(lesson, media);
  const i = lesson.quiz.answerIndex;
  const plain = commands.find((c) => c.clipId === `optText${i}`);
  const ok = commands.find((c) => c.clipId === 'optTextOk');
  assert.ok(plain.start + plain.duration <= ok.start + 0.01);
});

test('coverScale fills the portrait frame', () => {
  assert.ok(Math.abs(coverScale(1280, 720) - 3.16 * 1.02) < 0.05);
  assert.ok(Math.abs(coverScale(1080, 1920) - 1.02) < 0.01);
});

test('timeWords spreads words over the window in order', () => {
  const w = timeWords('One two three, four.', 2, 4);
  assert.equal(w.length, 4);
  assert.equal(w[0].start, 2);
  assert.ok(Math.abs(w.at(-1).end - 6) < 0.02);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].start >= w[i - 1].start);
});

test('pickTopic follows interest weights and explores a little', () => {
  const user = { interests: Object.fromEntries(TOPICS.map((t) => [t.id, 0])) };
  user.interests.biology = 3;
  user.interests.space = 1;
  let n = 0;
  const counts = {};
  const rand = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 4000; i++) { const t = pickTopic(user, rand); counts[t] = (counts[t] || 0) + 1; }
  assert.ok(counts.biology > counts.space * 2, JSON.stringify(counts));
  const explored = 4000 - counts.biology - counts.space;
  assert.ok(explored > 300 && explored < 900, `explored ${explored}`);
});

test('rank prefers results whose description matches the query', () => {
  const results = [
    { downloadUrl: 'a', sourceUrl: 'https://www.pexels.com/video/cyclists-racing-1/', width: 1280, height: 720 },
    { downloadUrl: 'b', sourceUrl: 'https://www.pexels.com/video/pantheon-dome-in-rome-2/', width: 1280, height: 720 },
  ];
  for (let i = 0; i < 20; i++) assert.equal(rank(results, new Set(), 'pantheon rome')[0].downloadUrl, 'b');
  assert.equal(rank(results, new Set(['b']), 'pantheon rome').length, 1);
});
