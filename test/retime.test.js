import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retimeClips, SPEEDS } from '../public/retime.js';

const clips = [
  { id: 'ambient', type: 'video', start: 0, duration: 30, mediaStart: 2, mediaDuration: 8, speed: 1, kfScale: [{ time: 0, value: 1 }, { time: 30, value: 1.1 }] },
  { id: 'voice0', type: 'audio', start: 3, duration: 12, mediaStart: 1.5, mediaDuration: 40, speed: 1, fadeIn: 0.2 },
  { id: 'hook', type: 'text', start: 0, duration: 4, textStyle: { content: 'Hi', animInDuration: 0.6, animOutDuration: 0.3, words: [{ text: 'Hi', start: 0.5, end: 0.9 }] } },
  { id: 'card', type: 'html', start: 6, duration: 5, kfOpacity: [{ time: 0, value: 0 }, { time: 0.4, value: 1 }] },
];

test('retime: 1x is the same document', () => {
  assert.equal(retimeClips(clips, 1), clips);
  assert.equal(retimeClips(clips, 'nonsense'), clips);
  assert.equal(retimeClips(clips, 5), clips); // out of range
});

test('retime: 1.25x divides timeline times, speeds media up, keeps source times', () => {
  const out = retimeClips(clips, 1.25);
  const [v, a, t, h] = out;
  assert.equal(v.duration, 24);
  assert.equal(v.speed, 1.25);
  assert.equal(v.mediaStart, 2); // source time: unchanged
  assert.equal(v.mediaDuration, 8);
  assert.deepEqual(v.kfScale.map((k) => k.time), [0, 24]);
  assert.equal(a.start, 2.4);
  assert.equal(a.duration, 9.6);
  assert.equal(a.fadeIn, 0.16);
  assert.equal(a.mediaStart, 1.5);
  assert.equal(t.duration, 3.2);
  assert.equal(t.textStyle.animInDuration, 0.48);
  assert.deepEqual(t.textStyle.words[0], { text: 'Hi', start: 0.4, end: 0.72 });
  assert.equal(t.speed, undefined); // text has no media speed
  assert.equal(h.start, 4.8);
  assert.deepEqual(h.kfOpacity.map((k) => k.time), [0, 0.32]);
  assert.equal(clips[0].duration, 30, 'the original is not changed');
  // A clip still ends where the next begins: (start + duration) scales as a whole.
  for (const r of SPEEDS) for (const c of retimeClips(clips, r)) assert.ok(Math.abs((c.start + c.duration) * r - (clips.find((x) => x.id === c.id).start + clips.find((x) => x.id === c.id).duration)) < 1e-9);
});
