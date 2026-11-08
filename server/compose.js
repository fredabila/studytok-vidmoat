// Turns a lesson plus resolved media/voice/sfx into Vidmoat edit commands. Pure: no network.
// Every op and field is from GET /v1/schema/commands.
//
// Canvas: 9:16, 1080x1920. Positions are offsets from the centre (y grows downward), text is
// centre-anchored, text fontSize is in 1920-wide reference units (rendered px = size * 0.5625).
// The app overlays its own header (top ~8%) and title block (bottom ~18%), so content stays
// between roughly y = -760 and y = +560.

import { topic as topicOf } from './topics.js';
import { teachingVisual, CARD } from './visuals.js';
import { isTeachingVisual } from './lessons/schema.js';

export const W = 1080;
export const H = 1920;

const WORDS_PER_SEC = 2.6;   // reading pace for silent videos
const LEAD = 0.25;           // silence before the narration starts
const THINK = 3;             // pause to think before the quiz answer
const HOOK_SEC = 3.2, REVEAL_SEC = 2.6, OUTRO_SEC = 3;

// Higher trackIndex draws on top. Track 2 is the default audio track (A1).
const T = { ambient: 0, media: 1, scrim: 3, card: 4, quizDim: 5, captions: 6, headline: 7, quizBox: 8, quizOk: 9, quizText: 10, quizTextOk: 11, chrome: 12, chromeText: 13, voice: 15, sfx: 16 };

const round = (n) => Math.round(n * 100) / 100;
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);

/** Scale that makes a w x h source cover the 1080x1920 frame (the player contain-fits by default). */
export function coverScale(w, h) {
  if (!w || !h) return 1;
  const contain = Math.min(W / w, H / h);
  return round(Math.max(W / (w * contain), H / (h * contain)) * 1.02);
}

/** Synthesised word timings across a window, weighted by word length and punctuation. */
export function timeWords(text, start, duration) {
  const list = words(text);
  const weights = list.map((w) => 1 + Math.min(w.replace(/[^\p{L}\p{N}]/gu, '').length, 12) / 6 + (/[,.;:!?]$/.test(w) ? 0.6 : 0));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = start;
  return list.map((text, i) => {
    const d = (weights[i] / total) * duration;
    const out = { text, start: round(t), end: round(t + d) };
    t += d;
    return out;
  });
}

/**
 * Timeline plan. With `voice` ({ duration, split, parts:[{kind,index,start,end}], words }), the
 * sections follow the narration; otherwise they follow reading pace.
 * @returns {{ segments, duration, captions: Array<Array<{text,start,end}>>, voiceClips }}
 */
export function planTimeline(lesson, voice = null) {
  const beats = lesson.beats;
  if (!voice) {
    const segments = [{ kind: 'hook', start: 0, duration: HOOK_SEC }];
    const captions = [];
    let t = HOOK_SEC;
    beats.forEach((beat, i) => {
      const d = Math.max(3.4, Math.min(7.5, words(beat.text).length / WORDS_PER_SEC + 1));
      segments.push({ kind: 'beat', index: i, start: round(t), duration: round(d) });
      captions.push(timeWords(beat.text, t + 0.3, d - 0.5));
      t += d;
    });
    if (lesson.quiz) {
      segments.push({ kind: 'quiz', start: round(t), duration: THINK + 1.2 }); t += THINK + 1.2;
      segments.push({ kind: 'reveal', start: round(t), duration: REVEAL_SEC }); t += REVEAL_SEC;
    }
    segments.push({ kind: 'outro', start: round(t), duration: OUTRO_SEC }); t += OUTRO_SEC;
    return { segments, duration: round(t), captions, voiceClips: [] };
  }

  const split = voice.split;
  // Times at (or within rounding of) the cut belong to the second half, after the think pause.
  const map = (a) => round(LEAD + a + (split != null && a >= split - 0.02 ? THINK : 0));
  const part = (kind, index) => voice.parts.find((p) => p.kind === kind && (index == null || p.index === index));
  const starts = [];
  const push = (kind, index, start) => starts.push({ kind, index, start });
  push('hook', undefined, 0);
  beats.forEach((_, i) => { const p = part('beat', i); if (p) push('beat', i, map(p.start)); });
  const q = part('quizQ'), r = part('reveal'), o = part('outro');
  let end;
  if (lesson.quiz && q) {
    push('quiz', undefined, map(q.start));
    if (r && split != null) {
      push('reveal', undefined, map(r.start));
      if (o) push('outro', undefined, map(o.start));
      end = map(voice.duration) + 1.2;
    } else {
      // Narration ends with the question: the reveal and takeaway follow without voice.
      const qEnd = map(voice.duration) + THINK;
      push('reveal', undefined, round(qEnd));
      push('outro', undefined, round(qEnd + REVEAL_SEC));
      end = qEnd + REVEAL_SEC + OUTRO_SEC;
    }
  } else {
    if (o) push('outro', undefined, map(o.start));
    end = map(voice.duration) + 1.2;
  }
  const segments = starts.map((s, i) => ({ ...s, start: round(s.start), duration: round((i + 1 < starts.length ? starts[i + 1].start : end) - s.start) }));

  const captions = beats.map((_, i) => {
    const p = part('beat', i);
    if (!p) return [];
    const ws = (voice.words || []).filter((w) => w.start >= p.start - 0.05 && w.start < p.end - 0.02);
    return (ws.length ? ws : timeWords(beats[i].text, p.start, p.end - p.start)).map((w) => ({ text: w.text, start: map(w.start), end: map(w.end) }));
  });

  const voiceClips = split != null
    ? [
      { clipId: 'voiceA', start: LEAD, mediaStart: 0, duration: round(split) },
      { clipId: 'voiceB', start: map(split), mediaStart: round(split), duration: round(voice.duration - split) },
    ]
    : [{ clipId: 'voiceA', start: LEAD, mediaStart: 0, duration: round(voice.duration) }];

  return { segments, duration: round(end), captions, voiceClips };
}

function wordIndex(text, term) {
  if (!term) return -1;
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const target = norm(words(term)[0] || '');
  return words(text).findIndex((w) => norm(w) === target);
}
function spanFor(text, term, color) {
  const i = wordIndex(text, term);
  if (i < 0) return undefined;
  return [{ from: i, to: i + Math.max(1, words(term).length) - 1, color }];
}
function emphasisFor(beat, color) {
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const spoken = new Set(words(beat.text).map(norm));
  const picked = words(beat.keyTerm || '').filter((w) => w.length > 2 && spoken.has(norm(w))).slice(0, 2);
  return picked.length ? { emphasis: { words: picked, style: { color } } } : {};
}

function mediaClip(id, m, start, duration, track, { opacity = 1 } = {}) {
  const isImage = m.type === 'image';
  const scale = coverScale(m.width, m.height);
  const loop = !isImage && m.mediaDuration && m.mediaDuration < duration;
  return [
    {
      op: 'addClip', clipId: id, type: isImage ? 'image' : 'video', src: m.src, start: round(start), duration: round(duration), trackIndex: track,
      ...(isImage ? {} : { mediaStart: 0, mediaDuration: m.mediaDuration }),
      patch: { scale, volume: 0, muted: true, opacity, ...(loop ? { loop: true } : {}) },
    },
    { op: 'addKeyframe', clipId: id, prop: 'scale', time: 0, value: scale, easing: 'linear' },
    { op: 'addKeyframe', clipId: id, prop: 'scale', time: round(duration), value: round(scale * (isImage ? 1.12 : 1.06)), easing: 'linear' },
  ];
}

const sfxClip = (id, s, at, volume, extra = {}) => (s?.src ? [{
  op: 'addClip', clipId: id, type: 'audio', src: s.src, start: round(Math.max(0, at)),
  duration: round(extra.duration || Math.min(s.mediaDuration || 1, 1.6)), mediaStart: 0, mediaDuration: s.mediaDuration,
  trackIndex: T.sfx, patch: { volume, ...(extra.loop ? { loop: true } : {}) },
}] : []);

/**
 * @param lesson  sanitized lesson (lessons/schema.js) + optional chip label
 * @param media   { ambient?, beatMedia?: (media|null)[], music?, sfx?: {whoosh,pop,tick,ding}, voice?: {src, duration, split, parts, words} }
 */
export function composeLesson(lesson, media = {}) {
  const look = topicOf(lesson.topic);
  const voice = media.voice?.src ? media.voice : null;
  const { segments, duration, captions, voiceClips } = planTimeline(lesson, voice);
  const sfx = media.sfx || {};
  const cmds = [];

  // The project name is set at creation ("StudyTok · <title>") so generated projects are easy to find.
  cmds.push({ op: 'setProjectSettings', aspectRatio: '9:16', background: look.bg });

  // ---- Ambient footage under everything, darkened by the scrim.
  if (media.ambient) cmds.push(...mediaClip('ambient', media.ambient, 0, duration, T.ambient));
  cmds.push({
    op: 'addShapeClip', clipId: 'scrim', kind: 'rectangle', start: 0, duration, trackIndex: T.scrim,
    style: { fill: '#000000', fillOpacity: media.ambient ? 0.62 : 0.2, width: W * 1.3, height: H * 1.3 },
  });

  // ---- Chip with the unit (or topic) name, on screen throughout.
  const chipText = (lesson.chip || lesson.topicLabel || look.label).toUpperCase().slice(0, 28);
  cmds.push({
    op: 'addShapeClip', clipId: 'chip', kind: 'capsule', start: 0, duration, trackIndex: T.chrome,
    style: { fill: look.accent, width: Math.min(960, 120 + chipText.length * 30), height: 92 }, patch: { y: -740 },
  });
  cmds.push({
    op: 'addTextClip', clipId: 'chipText', text: chipText, start: 0, duration, trackIndex: T.chromeText,
    style: { fontSize: 88, fontWeight: 800, color: '#0b0b0b', letterSpacing: 3 }, patch: { y: -740 },
  });

  for (const seg of segments) {
    const { start, duration: d } = seg;
    if (seg.kind !== 'hook' && seg.kind !== 'reveal') cmds.push(...sfxClip(`whoosh${cmds.length}`, sfx.whoosh, start - 0.12, 0.35));

    if (seg.kind === 'hook') {
      cmds.push({
        op: 'addTextClip', clipId: 'hook', text: lesson.hook, start: 0, duration: d, trackIndex: T.headline,
        style: { fontSize: 168, fontWeight: 900, color: '#ffffff', maxWidth: 0.86, lineHeight: 1.1, animIn: 'word-pop', animInDuration: 0.6,
          shadow: true, shadowColor: '#000000', shadowBlur: 18, shadowDistance: 0, spans: spanFor(lesson.hook, lesson.hookTerm, look.accent) },
        patch: { y: -100 },
      });
      cmds.push(...sfxClip('hookPop', sfx.pop, 0.35, 0.4));
    }

    if (seg.kind === 'beat') {
      const i = seg.index;
      const beat = lesson.beats[i];
      const v = beat.visual || { kind: 'footage' };
      const m = media.beatMedia?.[i];
      const teaching = isTeachingVisual(v.kind)
        ? teachingVisual(v, { id: `vis${i}`, start: start + 0.15, duration: d - 0.15, track: T.card, accent: look.accent })
        : [];
      const fullBleed = !teaching.length && m;
      if (fullBleed) {
        cmds.push(...mediaClip(`media${i}`, m, start, d + 0.4, T.media));
        cmds.push({ op: 'setTransition', clipId: `media${i}`, type: 'dissolve', duration: 0.4 });
      }
      cmds.push(...teaching);
      if (beat.keyTerm) {
        cmds.push({
          op: 'addTextClip', clipId: `term${i}`, text: beat.keyTerm, start, duration: d, trackIndex: T.headline,
          style: { fontSize: 140, fontWeight: 900, color: look.accent, maxWidth: 0.9, autoFit: true, animIn: 'pop', animInDuration: 0.4,
            shadow: true, shadowColor: '#000000', shadowBlur: 20, shadowDistance: 0 },
          patch: { y: teaching.length ? -590 : -480 },
        });
        cmds.push(...sfxClip(`pop${i}`, sfx.pop, start + 0.05, 0.45));
      }
      if (captions[i]?.length) {
        cmds.push({
          op: 'addCaptions', words: captions[i], keepExisting: true, maxWordsPerLine: 4, maxLineDuration: 2.6,
          trackIndex: T.captions, y: teaching.length ? 430 : 220, ...emphasisFor(beat, look.accent),
        });
      }
    }

    if (seg.kind === 'quiz' && lesson.quiz) {
      const q = lesson.quiz;
      const quizEnd = segments.find((s) => s.kind === 'reveal')?.start ?? start + d;
      const total = round(duration - start);
      cmds.push({ op: 'addShapeClip', clipId: 'quizDim', kind: 'rectangle', start, duration: total, trackIndex: T.quizDim,
        style: { fill: look.bg, fillOpacity: 0.5, width: W * 1.3, height: H * 1.3 } });
      cmds.push({ op: 'addTextClip', clipId: 'quizLabel', text: 'QUICK CHECK', start, duration: round(quizEnd - start + REVEAL_SEC), trackIndex: T.headline,
        style: { fontSize: 104, fontWeight: 800, color: look.accent, letterSpacing: 6 }, patch: { y: -580 } });
      cmds.push({ op: 'addTextClip', clipId: 'quizQ', text: q.question, start, duration: round(quizEnd - start + REVEAL_SEC), trackIndex: T.quizText,
        style: { fontSize: 132, fontWeight: 800, color: '#ffffff', maxWidth: 0.86, lineHeight: 1.12, animIn: 'fade-in', animInDuration: 0.3 }, patch: { y: -380 } });
      const optEnd = quizEnd + REVEAL_SEC;
      q.options.forEach((opt, k) => {
        const y = -40 + k * 210;
        const correct = k === q.answerIndex;
        const s = round(start + 0.3 + k * 0.15);
        cmds.push({ op: 'addShapeClip', clipId: `opt${k}`, kind: 'rectangle', start: s, duration: round(optEnd - s), trackIndex: T.quizBox,
          style: { fill: '#ffffff', fillOpacity: 0.12, stroke: '#ffffff', strokeWidth: 3, cornerRadius: 40, width: 900, height: 170 }, patch: { y } });
        cmds.push({ op: 'addTextClip', clipId: `optText${k}`, text: `${'ABC'[k]}.  ${opt}`, start: s, duration: round((correct ? quizEnd : optEnd) - s), trackIndex: T.quizText,
          style: { fontSize: 104, fontWeight: 700, color: '#ffffff', maxWidth: 0.78, autoFit: true }, patch: { y } });
        if (correct) {
          cmds.push({ op: 'addShapeClip', clipId: 'optOk', kind: 'rectangle', start: round(quizEnd), duration: REVEAL_SEC, trackIndex: T.quizOk,
            style: { fill: look.accent, fillOpacity: 1, cornerRadius: 40, width: 900, height: 170 }, patch: { y } });
          cmds.push({ op: 'addTextClip', clipId: 'optTextOk', text: `${'ABC'[k]}.  ${opt}`, start: round(quizEnd), duration: REVEAL_SEC, trackIndex: T.quizTextOk,
            style: { fontSize: 104, fontWeight: 800, color: '#0b0b0b', maxWidth: 0.78, autoFit: true, animIn: 'pop', animInDuration: 0.3 }, patch: { y } });
        }
      });
      // Thinking time: a soft clock under the pause.
      cmds.push(...sfxClip('tick', sfx.tick, quizEnd - THINK + 0.2, 0.3, { duration: THINK - 0.3, loop: true }));
    }

    if (seg.kind === 'reveal' && lesson.quiz) {
      cmds.push(...sfxClip('ding', sfx.ding, start, 0.55));
      if (lesson.quiz.explanation) {
        cmds.push({ op: 'addTextClip', clipId: 'explain', text: lesson.quiz.explanation, start: round(start + 0.2), duration: round(d - 0.2), trackIndex: T.quizText,
          style: { fontSize: 76, fontWeight: 600, color: '#ffffff', maxWidth: 0.84, lineHeight: 1.2, animIn: 'fade-in', animInDuration: 0.3 }, patch: { y: 520 } });
      }
    }

    if (seg.kind === 'outro') {
      cmds.push({ op: 'addTextClip', clipId: 'outroLabel', text: 'REMEMBER', start, duration: d, trackIndex: T.headline,
        style: { fontSize: 104, fontWeight: 800, color: look.accent, letterSpacing: 8, animIn: 'fade-in' }, patch: { y: -360 } });
      cmds.push({ op: 'addShapeClip', clipId: 'outroDim', kind: 'rectangle', start, duration: d, trackIndex: T.card,
        style: { fill: look.bg, fillOpacity: 0.85, width: W * 1.3, height: H * 1.3 } });
      cmds.push({ op: 'addTextClip', clipId: 'outro', text: lesson.takeaway, start, duration: d, trackIndex: T.quizText,
        style: { fontSize: 156, fontWeight: 900, color: '#ffffff', maxWidth: 0.86, lineHeight: 1.12, animIn: 'slide-up', animInDuration: 0.5,
          shadow: true, shadowColor: '#000000', shadowBlur: 18, shadowDistance: 0 }, patch: { y: -60 } });
    }
  }

  // ---- Narration, then music ducked under it.
  for (const c of voiceClips) {
    cmds.push({ op: 'addClip', clipId: c.clipId, type: 'audio', src: voice.src, start: round(c.start), duration: round(c.duration),
      mediaStart: round(c.mediaStart), mediaDuration: voice.duration, trackIndex: T.voice, patch: { volume: 1 } });
  }
  if (media.music?.src) {
    cmds.push({ op: 'musicBed', clipId: 'music', src: media.music.src, volume: voice ? 0.18 : 0.3, fadeIn: 0.8, fadeOut: 1.5,
      duck: Boolean(voice), ...(voice ? { voiceClipIds: voiceClips.map((c) => c.clipId) } : {}), loop: true, start: 0, end: duration });
  }

  return { commands: cmds, duration, segments };
}
