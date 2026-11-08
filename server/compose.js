// Turns a lesson (plain data) plus resolved media into a list of Vidmoat edit commands.
// Pure function: no network. Every op and field here is from GET /v1/schema/commands.
//
// Canvas: 9:16, 1080x1920, positions are offsets from the canvas centre (y grows downward),
// text is centre-anchored, and text fontSize is in 1920-wide reference units
// (rendered px = fontSize * 1080 / 1920).

import { topic as topicOf } from './topics.js';

export const W = 1080;
export const H = 1920;

const WORDS_PER_SEC = 2.6;   // comfortable reading pace for on-screen karaoke captions
const HOOK_SEC = 3.2;
const QUIZ_THINK_SEC = 3.2;   // time to think before the answer is revealed
const QUIZ_REVEAL_SEC = 2.2;
const OUTRO_SEC = 3;

// Higher trackIndex draws on top. Track 2 is the default audio track (A1).
const T = { broll: 0, scrim: 1, quizDim: 3, text: 4, headline: 5, quizBox: 6, quizOk: 7, quizText: 8, quizTextOk: 9, chrome: 10, chromeText: 11 };

const round = (n) => Math.round(n * 100) / 100;
const words = (s) => s.trim().split(/\s+/).filter(Boolean);

/** Scale that makes a w x h source cover the 1080x1920 frame (the player contain-fits by default). */
export function coverScale(w, h) {
  if (!w || !h) return 1;
  const contain = Math.min(W / w, H / h);
  return round(Math.max(W / (w * contain), H / (h * contain)) * 1.02);
}

/** Synthesised word timings for karaoke captions when there is no voiceover to transcribe. */
export function timeWords(text, start, duration) {
  const list = words(text);
  const weights = list.map((w) => 1 + Math.min(w.replace(/[^\p{L}\p{N}]/gu, '').length, 12) / 6 + (/[,.;:!?]$/.test(w) ? 0.6 : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = start;
  return list.map((text, i) => {
    const d = (weights[i] / total) * duration;
    const out = { text, start: round(t), end: round(t + d) };
    t += d;
    return out;
  });
}

/** Timeline plan: when each section starts and how long it lasts. */
export function planTimeline(lesson) {
  const segments = [{ kind: 'hook', start: 0, duration: HOOK_SEC }];
  let t = HOOK_SEC;
  lesson.beats.forEach((beat, i) => {
    const d = Math.max(3.2, Math.min(7, words(beat.text).length / WORDS_PER_SEC + 0.9));
    segments.push({ kind: 'beat', index: i, start: round(t), duration: round(d) });
    t += d;
  });
  if (lesson.quiz) {
    const d = QUIZ_THINK_SEC + QUIZ_REVEAL_SEC;
    segments.push({ kind: 'quiz', start: round(t), duration: d });
    t += d;
  }
  segments.push({ kind: 'outro', start: round(t), duration: OUTRO_SEC });
  t += OUTRO_SEC;
  return { segments, duration: round(t) };
}

/** Index of the first word in `text` that matches `term` (for per-word highlight spans). */
function wordIndex(text, term) {
  if (!term) return -1;
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const target = norm(words(term)[0] || '');
  return words(text).findIndex((w) => norm(w) === target);
}

/**
 * @param lesson { topic, title, hook, beats:[{text, keyTerm, visual}], quiz?:{question, options[3], answerIndex}, takeaway }
 * @param media  { broll: [{src, width, height, mediaDuration}] (one per hook+beat, may be shorter), music?: {src} }
 */
export function composeLesson(lesson, media = {}) {
  const look = topicOf(lesson.topic);
  const { segments, duration } = planTimeline(lesson);
  const cmds = [];

  cmds.push({ op: 'setProjectSettings', name: lesson.title.slice(0, 80), aspectRatio: '9:16', background: look.bg });

  // ---- B-roll: one stock clip per section (hook + beats), each scaled to cover, slow push-in,
  // crossfaded into the next. Quiz and outro sit on the last clip, held under a darker scrim.
  const brollSegs = segments.filter((s) => s.kind === 'hook' || s.kind === 'beat');
  const clips = media.broll || [];
  if (clips.length) {
    brollSegs.forEach((seg, i) => {
      const m = clips[i % clips.length];
      const isLast = i === brollSegs.length - 1;
      const start = seg.start;
      const dur = round((isLast ? duration - start : seg.duration) + (isLast ? 0 : 0.5));
      const scale = coverScale(m.width, m.height);
      const id = `broll${i}`;
      const isImage = m.type === 'image';
      const loop = !isImage && m.mediaDuration && m.mediaDuration < dur;
      cmds.push({
        op: 'addClip', clipId: id, type: isImage ? 'image' : 'video', src: m.src, start, duration: dur, trackIndex: T.broll,
        ...(isImage ? {} : { mediaStart: 0, mediaDuration: m.mediaDuration }),
        patch: { scale, volume: 0, muted: true, ...(loop ? { loop: true } : {}) },
      });
      cmds.push({ op: 'addKeyframe', clipId: id, prop: 'scale', time: 0, value: scale, easing: 'linear' });
      cmds.push({ op: 'addKeyframe', clipId: id, prop: 'scale', time: dur, value: round(scale * 1.08), easing: 'linear' });
      if (!isLast) cmds.push({ op: 'setTransition', clipId: id, type: 'dissolve', duration: 0.5 });
    });
  }

  // ---- Scrim so white text always reads over footage.
  cmds.push({
    op: 'addShapeClip', clipId: 'scrim', kind: 'rectangle', start: 0, duration, trackIndex: T.scrim,
    style: { fill: '#000000', fillOpacity: 0.5, width: W * 1.3, height: H * 1.3 },
  });

  // ---- Topic chip (top) and series watermark (bottom): stay on screen throughout.
  const chipText = lesson.topicLabel || look.label;
  const chipW = Math.min(900, 140 + chipText.length * 34);
  cmds.push({
    op: 'addShapeClip', clipId: 'chip', kind: 'capsule', start: 0, duration, trackIndex: T.chrome,
    style: { fill: look.accent, width: chipW, height: 96 }, patch: { y: -740 },
  });
  cmds.push({
    op: 'addTextClip', clipId: 'chipText', text: chipText.toUpperCase(), start: 0, duration, trackIndex: T.chromeText,
    style: { fontSize: 96, fontWeight: 800, color: '#0b0b0b', letterSpacing: 4 }, patch: { y: -740 },
  });

  for (const seg of segments) {
    if (seg.kind === 'hook') {
      cmds.push({
        op: 'addTextClip', clipId: 'hook', text: lesson.hook, start: 0, duration: seg.duration, trackIndex: T.headline,
        style: { fontSize: 168, fontWeight: 900, color: '#ffffff', maxWidth: 0.86, lineHeight: 1.1, animIn: 'word-pop', animInDuration: 0.6,
          shadow: true, shadowColor: '#000000', shadowBlur: 18, shadowDistance: 0,
          spans: spanFor(lesson.hook, lesson.hookTerm, look.accent) },
        patch: { y: -120 },
      });
    }

    if (seg.kind === 'beat') {
      const beat = lesson.beats[seg.index];
      // Big key term up top, like a flashcard front.
      if (beat.keyTerm) {
        cmds.push({
          op: 'addTextClip', clipId: `term${seg.index}`, text: beat.keyTerm, start: seg.start, duration: seg.duration, trackIndex: T.headline,
          style: { fontSize: 200, fontWeight: 900, color: look.accent, maxWidth: 0.9, autoFit: true, animIn: 'pop', animInDuration: 0.45,
            shadow: true, shadowColor: '#000000', shadowBlur: 20, shadowDistance: 0 },
          patch: { y: -400 },
        });
      }
      // The explanation, karaoke-captioned at reading pace.
      cmds.push({
        op: 'addCaptions', words: timeWords(beat.text, seg.start + 0.3, seg.duration - 0.5), keepExisting: true,
        maxWordsPerLine: 4, maxLineDuration: 2.6, trackIndex: T.text, y: 160,
        ...emphasisFor(beat, look.accent),
      });
    }

    if (seg.kind === 'quiz') {
      const q = lesson.quiz;
      const reveal = round(seg.start + QUIZ_THINK_SEC);
      cmds.push({
        op: 'addShapeClip', clipId: 'quizDim', kind: 'rectangle', start: seg.start, duration: round(duration - seg.start), trackIndex: T.quizDim,
        style: { fill: look.bg, fillOpacity: 0.55, width: W * 1.3, height: H * 1.3 },
      });
      cmds.push({
        op: 'addTextClip', clipId: 'quizLabel', text: 'QUICK CHECK', start: seg.start, duration: seg.duration, trackIndex: T.headline,
        style: { fontSize: 104, fontWeight: 800, color: look.accent, letterSpacing: 6 }, patch: { y: -560 },
      });
      cmds.push({
        op: 'addTextClip', clipId: 'quizQ', text: q.question, start: seg.start, duration: seg.duration, trackIndex: T.quizText,
        style: { fontSize: 136, fontWeight: 800, color: '#ffffff', maxWidth: 0.86, lineHeight: 1.12, animIn: 'fade-in', animInDuration: 0.3 },
        patch: { y: -330 },
      });
      q.options.forEach((opt, i) => {
        const y = 40 + i * 230;
        const correct = i === q.answerIndex;
        cmds.push({
          op: 'addShapeClip', clipId: `opt${i}`, kind: 'rectangle', start: round(seg.start + 0.3 + i * 0.15), duration: round(seg.duration - 0.3 - i * 0.15), trackIndex: T.quizBox,
          style: { fill: '#ffffff', fillOpacity: 0.12, stroke: '#ffffff', strokeWidth: 3, cornerRadius: 40, width: 900, height: 180 },
          patch: { y },
        });
        if (correct) {
          cmds.push({
            op: 'addShapeClip', clipId: `optOk`, kind: 'rectangle', start: reveal, duration: QUIZ_REVEAL_SEC, trackIndex: T.quizOk,
            style: { fill: look.accent, fillOpacity: 1, cornerRadius: 40, width: 900, height: 180 }, patch: { y },
          });
        }
        cmds.push({
          op: 'addTextClip', clipId: `optText${i}`, text: `${'ABC'[i]}.  ${opt}`, start: round(seg.start + 0.3 + i * 0.15),
          duration: round((correct ? QUIZ_THINK_SEC : seg.duration) - 0.3 - i * 0.15), trackIndex: T.quizText,
          style: { fontSize: 108, fontWeight: 700, color: '#ffffff', maxWidth: 0.78, autoFit: true }, patch: { y },
        });
        if (correct) {
          cmds.push({
            op: 'addTextClip', clipId: 'optTextOk', text: `${'ABC'[i]}.  ${opt}`, start: reveal, duration: QUIZ_REVEAL_SEC, trackIndex: T.quizTextOk,
            style: { fontSize: 108, fontWeight: 800, color: '#0b0b0b', maxWidth: 0.78, autoFit: true, animIn: 'pop', animInDuration: 0.3 }, patch: { y },
          });
        }
      });
    }

    if (seg.kind === 'outro') {
      cmds.push({
        op: 'addTextClip', clipId: 'outroLabel', text: 'REMEMBER', start: seg.start, duration: seg.duration, trackIndex: T.headline,
        style: { fontSize: 104, fontWeight: 800, color: look.accent, letterSpacing: 8, animIn: 'fade-in' }, patch: { y: -360 },
      });
      cmds.push({
        op: 'addTextClip', clipId: 'outro', text: lesson.takeaway, start: seg.start, duration: seg.duration, trackIndex: T.text,
        style: { fontSize: 156, fontWeight: 900, color: '#ffffff', maxWidth: 0.86, lineHeight: 1.12, animIn: 'slide-up', animInDuration: 0.5,
          shadow: true, shadowColor: '#000000', shadowBlur: 18, shadowDistance: 0 },
        patch: { y: -60 },
      });
    }
  }

  // ---- Music bed: looped under the whole video, faded in and out.
  if (media.music?.src) {
    cmds.push({ op: 'musicBed', clipId: 'music', src: media.music.src, volume: 0.3, fadeIn: 0.8, fadeOut: 1.5, duck: false, loop: true, start: 0, end: duration });
  }

  return { commands: cmds, duration, segments };
}

// Karaoke emphasis must name words that are actually spoken in the line, or the captioner
// picks its own. Use the key term's words when they occur in the text, else none.
function emphasisFor(beat, color) {
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const spoken = new Set(words(beat.text).map(norm));
  const picked = words(beat.keyTerm || '').filter((w) => w.length > 2 && spoken.has(norm(w))).slice(0, 2);
  return picked.length ? { emphasis: { words: picked, style: { color } } } : {};
}

function spanFor(text, term, color) {
  const i = wordIndex(text, term);
  if (i < 0) return undefined;
  const n = Math.max(1, words(term).length);
  return [{ from: i, to: i + n - 1, color }];
}
