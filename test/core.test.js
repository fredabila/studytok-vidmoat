import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STUDYTOK_DATA_DIR = mkdtempSync(join(tmpdir(), 'studytok-test-')) + '/';
process.env.STUDYTOK_KV_FILE = 'memory';

const { composeLesson, planTimeline, coverScale, timeWords } = await import('../server/video/compose.js');
const { sanitizeLesson } = await import('../server/lessons/schema.js');
const { BANK } = await import('../server/lessons/bank.js');
const { INTEREST_TOPICS } = await import('../server/curriculum/topics.js');
const { rank } = await import('../server/video/media.js');
const { sanitizeSvg, teachingVisual } = await import('../server/video/visuals.js');
const { narrationParts, alignParts } = await import('../server/video/voice.js');
const { scenesFor, FORMAT_IDS, pickFormats } = await import('../server/video/formats.js');
const { SAMPLES } = await import('../server/lessons/samples.js');
const { matchProgram, CATALOG } = await import('../server/curriculum/catalog.js');

const lesson = sanitizeLesson(BANK.biology[0], 'biology');
const media = {
  ambient: { src: 'https://api.vidmoat.com/uploads/a.mp4', type: 'video', width: 1280, height: 720, mediaDuration: 6 },
  beatMedia: [null, null, null],
  music: { src: 'https://api.vidmoat.com/uploads/m.mp3' },
  sfx: { whoosh: { src: 'https://x/w.mp3', mediaDuration: 0.6 }, pop: { src: 'https://x/p.mp3', mediaDuration: 0.2 }, tick: { src: 'https://x/t.mp3', mediaDuration: 4 }, ding: { src: 'https://x/d.mp3', mediaDuration: 1.5 } },
};

test('every interest topic has offline lessons that sanitize cleanly with a valid quiz', () => {
  for (const t of INTEREST_TOPICS) {
    assert.ok(BANK[t.id]?.length >= 2, `bank for ${t.id}`);
    for (const raw of BANK[t.id]) {
      const l = sanitizeLesson(raw, t.id);
      assert.ok(l.beats.length >= 2 && l.beats.length <= 4);
      assert.equal(l.quiz.options.length, 3);
      assert.ok(l.hook.toLowerCase().includes(l.hookTerm.toLowerCase()), `hookTerm appears in hook: ${l.title}`);
      for (const b of l.beats) assert.ok(b.visual && b.visual.kind, 'every beat has a visual');
    }
  }
});

test('sanitizeLesson clamps, repairs the answer index and downgrades incomplete visuals', () => {
  const l = sanitizeLesson({
    title: 'x'.repeat(200), hook: 'h', hookTerm: 'h', takeaway: 't',
    beats: [
      { text: 'a b c', keyTerm: 'k', visual: { kind: 'steps', items: ['only one'] } },
      { text: 'd e f', keyTerm: 'k2', visual: { kind: 'diagram', svg: 'not svg' } },
      { text: 'g h i', keyTerm: 'k3', visual: { kind: 'stat', value: 42, unit: '%', title: 'x' } },
    ],
    quiz: { question: 'q', options: ['1', '2', '3', '4'], answerIndex: 7, explanation: 'e' },
  }, 'math');
  assert.ok(l.title.length <= 60);
  assert.equal(l.quiz.answerIndex, 0);
  assert.equal(l.beats[0].visual.kind, 'footage');
  assert.equal(l.beats[1].visual.kind, 'footage');
  assert.equal(l.beats[2].visual.kind, 'stat');
  assert.throws(() => sanitizeLesson({ beats: [{ text: 'only one' }] }, 'math'));
});

test('silent timeline: hook, beats, quiz, reveal, outro back to back', () => {
  const { segments, duration } = planTimeline(scenesFor(lesson));
  assert.deepEqual(segments.map((s) => s.kind), ['hook', 'beat', 'beat', 'beat', 'quiz', 'reveal', 'outro']);
  for (let i = 1; i < segments.length; i++) assert.ok(Math.abs(segments[i].start - (segments[i - 1].start + segments[i - 1].duration)) < 0.02);
  assert.ok(duration > 18 && duration < 60, `duration ${duration}`);
});

test('narrated timeline follows the audio and pauses before the answer', () => {
  const parts = narrationParts(lesson);
  assert.deepEqual(parts.map((p) => p.kind), ['hook', 'beat', 'beat', 'beat', 'quiz', 'reveal', 'outro']);
  assert.ok(parts.reduce((n, p) => n + p.text.length + 1, 0) <= 1000);
  assert.equal(parts.find((p) => p.kind === 'reveal').pauseBefore, 4, 'the think pause sits before the answer');
  const aligned = alignParts(parts, 30, []);
  const voice = { src: 'https://x/v.mp3', duration: 30, parts: aligned.parts, words: [] };
  const { segments, voiceClips, duration } = planTimeline(scenesFor(lesson), voice);
  assert.equal(voiceClips.length, 2);
  assert.ok(Math.abs(voiceClips[1].start - (voiceClips[0].start + voiceClips[0].duration) - 4) < 0.02, 'four-second think pause');
  const quiz = segments.find((s) => s.kind === 'quiz'), rev = segments.find((s) => s.kind === 'reveal');
  assert.ok(Math.abs(rev.start - voiceClips[1].start) < 0.05, 'reveal starts with the second voice clip');
  assert.ok(quiz.start < rev.start && duration > 30);
  const { quiz: timing } = composeLesson(lesson, { ...media, voice });
  assert.ok(timing.from < timing.hold && timing.hold < timing.reveal && Math.abs(timing.reveal - rev.start) < 0.05, 'app holds the video before the answer');
});

test('silent scenes (recap) and several pauses (flashcards) fit between the narration parts', () => {
  const rapid = sanitizeLesson({ format: 'rapid', title: 'Five things', hook: 'Five things about cells', hookTerm: 'Five', takeaway: 'Cells are busy.',
    items: ['Membrane', 'Nucleus', 'Mitochondria', 'Ribosome'].map((t) => ({ title: t, text: `The ${t.toLowerCase()} does an important job in the cell.`, visual: t })),
    quiz: { question: 'Which part holds DNA?', options: ['Membrane', 'Nucleus', 'Ribosome'], answerIndex: 1, explanation: 'DNA lives in the nucleus.' } }, 'biology');
  const scenes = scenesFor(rapid);
  const parts = narrationParts(rapid);
  const recapIdx = scenes.findIndex((s) => s.kind === 'recap');
  assert.ok(recapIdx > 0 && !parts.some((p) => p.id === 'recap'), 'recap is silent');
  assert.equal(parts.find((p) => p.kind === 'quiz').pauseBefore, 3.2, 'the recap card gets its time before the quiz narration');
  const aligned = alignParts(parts, 40, []);
  const plan = planTimeline(scenes, { src: 'x', duration: 40, parts: aligned.parts, words: [] });
  const recap = plan.segments.find((s) => s.kind === 'recap'), q = plan.segments.find((s) => s.kind === 'quiz');
  assert.ok(Math.abs(recap.duration - 3.2) < 0.3 && q.start >= recap.start + recap.duration - 0.05);

  const flash = sanitizeLesson({ format: 'flashcards', title: 'Flash', hook: 'Say it before it appears', hookTerm: 'Say it', takeaway: 'Four down.',
    cards: [1, 2, 3, 4].map((i) => ({ q: `Question number ${i} about enzymes?`, a: `Answer ${i}` })) }, 'biology');
  const fparts = narrationParts(flash);
  assert.equal(fparts.filter((p) => p.pauseBefore === 2.5).length, 4, 'a pause after every question');
  const fplan = planTimeline(scenesFor(flash), { src: 'x', duration: 35, parts: alignParts(fparts, 35, []).parts, words: [] });
  assert.equal(fplan.voiceClips.length, 5);
  assert.equal(flash.quiz, null);
});

test('alignParts snaps boundaries to pauses between words', () => {
  const parts = [{ id: 'hook', kind: 'hook', text: 'One two three.', pauseBefore: 0 }, { id: 'beat0', kind: 'beat', text: 'Four five six seven.', pauseBefore: 0 }];
  const words = [
    { text: 'One', start: 0, end: 0.3 }, { text: 'two', start: 0.35, end: 0.6 }, { text: 'three.', start: 0.65, end: 1.0 },
    { text: 'Four', start: 1.8, end: 2.1 }, { text: 'five', start: 2.15, end: 2.4 }, { text: 'six', start: 2.45, end: 2.7 }, { text: 'seven.', start: 2.75, end: 3.1 },
  ];
  const { parts: out } = alignParts(parts, 3.2, words);
  assert.equal(out[1].start, 1.8);
  assert.ok(out[1].cutBefore > 1.0 && out[1].cutBefore < 1.8);
});

test('every format composes cleanly, silent and narrated, with its own skin', () => {
  const presets = new Set();
  for (const id of FORMAT_IDS) {
    const l = sanitizeLesson(SAMPLES[id], 'physics');
    assert.equal(l.format, id, `sample for ${id} keeps its format`);
    for (const voiced of [false, true]) {
      const parts = narrationParts(l);
      const voice = voiced ? { src: 'https://x/v.mp3', duration: 38, parts: alignParts(parts, 38, []).parts, words: [] } : null;
      const { commands, duration, quiz } = composeLesson(l, { ...media, itemMedia: [media.ambient, media.ambient, media.ambient, media.ambient], voice });
      const ids = new Set();
      for (const c of commands) {
        if (c.clipId && c.op.startsWith('add') && c.op !== 'addKeyframe') { assert.ok(!ids.has(c.clipId), `${id}: duplicate clipId ${c.clipId}`); ids.add(c.clipId); }
        if (typeof c.start === 'number' && typeof c.duration === 'number') assert.ok(c.start >= -0.2 && c.start + c.duration <= duration + 0.6, `${id}: ${c.op} ${c.clipId} inside the timeline`);
      }
      // The editor pushes a clip up a track when its own track is busy (even touching counts), which
      // would put footage over the scrim and dims over cards: these tracks must never overlap.
      for (const track of [1, 4, 5]) {
        const on = commands.filter((c) => c.trackIndex === track && typeof c.start === 'number' && c.op !== 'addKeyframe').sort((a, b) => a.start - b.start);
        on.slice(1).forEach((c, k) => assert.ok(on[k].start + on[k].duration <= c.start, `${id}: ${on[k].clipId} overlaps ${c.clipId} on track ${track}`));
      }
      // Motion presets animate around the vertical centre and move placed cards there: keyframes only.
      assert.ok(!commands.some((c) => c.op === 'applyMotionPreset'), `${id}: no motion presets`);
      for (const c of commands.filter((k) => k.op === 'addKeyframe' && k.prop === 'y')) {
        const clip = commands.find((k) => k.clipId === c.clipId && k.op.startsWith('add') && k.op !== 'addKeyframe');
        const last = commands.filter((k) => k.op === 'addKeyframe' && k.clipId === c.clipId && k.prop === 'y').at(-1);
        assert.equal(last.value, clip.patch?.y ?? 0, `${id}: ${c.clipId} settles where it was placed`);
      }
      assert.ok(duration > 15 && duration < 90, `${id}: duration ${duration}`);
      if (l.quiz) assert.ok(quiz && quiz.from < quiz.hold && quiz.hold < quiz.reveal, `${id}: quiz timing`);
      else assert.equal(quiz, null);
      const cap = commands.find((c) => c.op === 'addCaptions');
      if (cap) presets.add(cap.preset);
      if (voiced) assert.ok(commands.filter((c) => c.trackIndex === 15).length >= 1, `${id}: voice clips`);
    }
  }
  assert.ok(presets.size >= 5, 'formats use different caption presets');
});

test('pickFormats avoids what was just seen and favours the topic', () => {
  const seq = Array.from({ length: 40 }, (_, i) => pickFormats('math', 1, { recent: ['examdrill'], rand: () => (i % 10) / 10 })[0]);
  assert.ok(!seq.includes('examdrill') || seq.filter((f) => f === 'examdrill').length < 8, 'the last format is pushed down');
  const picks = pickFormats('history', 3, { recent: [] });
  assert.equal(new Set(picks).size, 3, 'three distinct formats');
});

test('composeLesson: 9:16, clips inside the timeline, sfx and music present, no top-level layout fields', () => {
  const { commands, duration } = composeLesson(lesson, media);
  assert.equal(commands[0].op, 'setProjectSettings');
  assert.equal(commands[0].aspectRatio, '9:16');
  const ids = new Set();
  for (const c of commands) {
    if (c.clipId && c.op.startsWith('add') && c.op !== 'addKeyframe') { assert.ok(!ids.has(c.clipId), `duplicate clipId ${c.clipId}`); ids.add(c.clipId); }
    if (typeof c.start === 'number' && typeof c.duration === 'number') assert.ok(c.start >= 0 && c.start + c.duration <= duration + 0.6, `${c.op} ${c.clipId} ends inside timeline`);
    assert.ok(!('fontSize' in c) && !('y' in c && c.op !== 'addCaptions'), `${c.op} has top-level layout fields`);
  }
  assert.ok(commands.some((c) => c.op === 'addHtmlElement'), 'teaching visuals present');
  assert.ok(commands.some((c) => c.clipId === 'ding') && commands.some((c) => c.clipId === 'tick'));
  assert.equal(commands.filter((c) => c.op === 'musicBed').length, 1);
});

test('quiz reveal never overlaps the plain correct-answer text', () => {
  const { commands } = composeLesson(lesson, media);
  const plain = commands.find((c) => c.clipId === `optText${lesson.quiz.answerIndex}`);
  const ok = commands.find((c) => c.clipId === 'optTextOk');
  assert.ok(plain.start + plain.duration <= ok.start + 0.01);
});

test('sanitizeSvg strips scripts, handlers, external refs and images', () => {
  const dirty = `<p>x</p><svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><image href="https://evil/x.png"/><a href="https://evil">x</a><rect fill="url(https://evil/p)" onclick="x()"/><use href="#ok"/><foreignObject><div>hi</div></foreignObject><text>ok</text></svg>`;
  const s = sanitizeSvg(dirty);
  assert.ok(s.startsWith('<svg'));
  for (const bad of ['script', 'onload', 'onclick', 'https://evil', '<image', 'foreignObject']) assert.ok(!s.includes(bad), `removed ${bad}`);
  assert.ok(s.includes('href="#ok"') && s.includes('<text>ok</text>'));
  assert.equal(sanitizeSvg('no svg here'), '');
});

test('teaching visuals produce clips for every kind', () => {
  const base = { start: 1, duration: 5, track: 4, accent: '#34d399' };
  const kinds = {
    steps: { kind: 'steps', title: 'S', items: ['a', 'b', 'c'] },
    timeline: { kind: 'timeline', items: ['1450|a', '1500|b'] },
    compare: { kind: 'compare', title: 'A|B', items: ['1|2', '3|4'] },
    definition: { kind: 'definition', title: 'T', items: ['d'] },
    equation: { kind: 'equation', title: 'm', items: ['E = mc²'] },
    stat: { kind: 'stat', value: 42, unit: '%', title: 'x' },
    statText: { kind: 'stat', value: 3.8, unit: 'million', title: 'x' },
    diagram: { kind: 'diagram', svg: '<svg viewBox="0 0 800 800"><circle cx="1" cy="1" r="1"/></svg>' },
  };
  for (const [name, v] of Object.entries(kinds)) assert.ok(teachingVisual(v, { ...base, id: name }).length > 0, name);
  assert.equal(teachingVisual({ kind: 'steps', items: ['<b>x</b>', 'y'] }, { ...base, id: 'e' })[0].html.includes('<b>x</b>'), false, 'text is escaped');
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
});

test('rank prefers results whose description matches, and Commons for named things', () => {
  const results = [
    { downloadUrl: 'a', sourceUrl: 'https://www.pexels.com/video/cyclists-racing-1/', width: 1280, height: 720, provider: 'pexels' },
    { downloadUrl: 'b', sourceUrl: 'https://www.pexels.com/video/pantheon-dome-in-rome-2/', width: 1280, height: 720, provider: 'pexels' },
    { downloadUrl: 'c', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Pantheon_Rome.jpg', width: 1280, height: 900, provider: 'commons' },
  ];
  for (let i = 0; i < 20; i++) assert.notEqual(rank(results, new Set(), 'pantheon rome')[0].downloadUrl, 'a');
  for (let i = 0; i < 20; i++) assert.equal(rank(results, new Set(), 'pantheon rome', { preferCommons: true })[0].downloadUrl, 'c');
});

test('catalog matching handles degree names and levels', () => {
  assert.equal(matchProgram('BSc Computer Science', 'university').id, 'uni-cs');
  assert.equal(matchProgram('Core Mathematics', 'high-school').id, 'hs-math');
  assert.equal(matchProgram('biology', 'high-school').id, 'hs-biology');
  assert.equal(matchProgram('LLB Law (Hons)', 'university').id, 'uni-law');
  assert.equal(matchProgram('Underwater basket weaving', 'university'), null);
  for (const p of CATALOG) assert.ok(p.units.length >= 6 && p.units.every((u) => u.title && u.topic));
});
