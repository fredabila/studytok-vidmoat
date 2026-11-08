// Turns a lesson plus resolved media/voice/sfx into Vidmoat edit commands. Pure: no network.
// Every op and field is from GET /v1/schema/commands.
//
// A lesson has a `format` (formats.js); the format turns it into scenes, and this file renders
// each scene with the format's skin (fonts, captions preset, grade, transitions, card theme),
// so an explainer, a myth-bust, a rapid-fire list and an exam drill each look and move
// differently.
//
// Canvas: 9:16, 1080x1920. Positions are offsets from the centre (y grows downward), text is
// centre-anchored, text fontSize is in 1920-wide reference units (rendered px = size * 0.5625).
// The app overlays its own header (top ~8%) and title block (bottom ~18%), so content stays
// between roughly y = -760 and y = +560.

import { config } from '../core/config.js';
import { topic as topicOf } from '../curriculum/topics.js';
import { format as formatOf, scenesFor } from './formats.js';
import { teachingVisual, stampCard, numberCard, recapCard, questionCard, answerSteps, calloutCard, flashCard, chatThread, tierCard, sheetCard } from './visuals.js';
import { isTeachingVisual } from '../lessons/schema.js';

export const W = 1080;
export const H = 1920;

const WORDS_PER_SEC = 2.6;   // reading pace for silent videos
const LEAD = 0.25;           // silence before the narration starts
const TAIL = 1.2;            // after the narration ends
const REVEAL_SEC = 2.6;

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

const readingTime = (scene) => Math.max(scene.minDur || 3, Math.min(8, words(scene.spoken).length / WORDS_PER_SEC + 1));

/**
 * Timeline plan for a scene list. With `voice` ({ duration, parts:[{id,start,end,cutBefore,
 * pauseBefore}], words }) the scenes follow the narration, with the pauses the formats ask for
 * (pauseAfter, silent scenes) inserted as cuts in the audio; otherwise they follow reading pace.
 * @returns {{ segments: Array<scene & {start,duration}>, duration, captions: Record<sceneId, {text,start,end}[]>, voiceClips }}
 */
export function planTimeline(scenes, voice = null) {
  const captions = {};
  if (!voice) {
    const segments = [];
    let t = 0;
    for (const scene of scenes) {
      const d = round((scene.spoken ? readingTime(scene) : scene.minDur || 3) + (scene.pauseAfter || 0));
      segments.push({ ...scene, start: round(t), duration: d });
      if (scene.captions && scene.spoken) captions[scene.id] = timeWords(scene.spoken, t + 0.3, Math.min(d - 0.5, readingTime(scene) - 0.3));
      t += d;
    }
    return { segments, duration: round(t), captions, voiceClips: [] };
  }

  const parts = voice.parts;
  const partOf = (id) => parts.find((p) => p.id === id);
  // Audio time -> timeline time: every cut at (or within rounding of) a pause pushes later audio back.
  const map = (a) => round(LEAD + a + parts.reduce((n, p, k) => n + (k > 0 && a >= p.cutBefore - 0.02 ? p.pauseBefore || 0 : 0), 0));
  const end = map(voice.duration) + TAIL;

  const starts = [];
  let cursor = null; // where the next silent scene goes
  scenes.forEach((scene, i) => {
    const p = scene.spoken ? partOf(scene.id) : null;
    if (p) {
      starts.push({ scene, start: map(p.start) });
      // Silent scenes after this one sit in the pause before the next part, after this scene's own pauseAfter.
      const nextSpoken = scenes.slice(i + 1).find((s) => s.spoken && partOf(s.id));
      const np = nextSpoken ? partOf(nextSpoken.id) : null;
      cursor = np ? map(np.cutBefore) - (np.pauseBefore || 0) + (scene.pauseAfter || 0) : end - TAIL + 0.3;
    } else if (!scene.spoken) {
      const start = cursor ?? (starts.length ? starts.at(-1).start : 0);
      starts.push({ scene, start: round(start) });
      cursor = start + (scene.minDur || 3);
    }
    // A spoken scene whose narration was dropped (character limit) is left out of the video.
  });
  const segments = starts.map(({ scene, start }, i) => {
    const next = i + 1 < starts.length ? starts[i + 1].start : Math.max(end, start + (scene.minDur || 3));
    return { ...scene, start, duration: round(Math.max(0.8, next - start)) };
  });

  for (const scene of scenes) {
    const p = scene.captions && scene.spoken ? partOf(scene.id) : null;
    if (!p) continue;
    const ws = (voice.words || []).filter((w) => w.start >= p.start - 0.05 && w.start < p.end - 0.02);
    captions[scene.id] = (ws.length ? ws : timeWords(scene.spoken, p.start, p.end - p.start)).map((w) => ({ text: w.text, start: map(w.start), end: map(w.end) }));
  }

  // One audio clip per stretch between pauses.
  const cuts = [0, ...parts.filter((p, k) => k > 0 && p.pauseBefore > 0).map((p) => p.cutBefore), voice.duration];
  const voiceClips = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    if (cuts[k + 1] - cuts[k] < 0.05) continue;
    voiceClips.push({ clipId: `voice${voiceClips.length}`, start: map(cuts[k]), mediaStart: round(cuts[k]), duration: round(cuts[k + 1] - cuts[k]) });
  }
  const duration = round(Math.max(end, segments.at(-1)?.start + segments.at(-1)?.duration || 0));
  return { segments, duration, captions, voiceClips };
}

// ---- Text helpers ------------------------------------------------------------------------------

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
function emphasisFor(spoken, keyTerm, color) {
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const said = new Set(words(spoken).map(norm));
  const picked = words(keyTerm || '').filter((w) => w.length > 2 && said.has(norm(w))).slice(0, 2);
  return picked.length ? { emphasis: { words: picked, style: { color } } } : {};
}
const SHADOW = { shadow: true, shadowColor: '#000000', shadowBlur: 18, shadowDistance: 0 };
const caseOf = (s, style) => (style?.uppercase ? String(s).toUpperCase() : String(s));
/** A text clip styled by a skin entry ({ fontFamily, fontWeight, fontSize, uppercase, animIn, animInDuration, outline, outlineWidth, color, letterSpacing }). */
function styled(skinText, over = {}) {
  const { uppercase, ...s } = skinText || {};
  return { fontWeight: 900, color: '#ffffff', ...SHADOW, ...s, ...over };
}

// ---- Clip helpers ------------------------------------------------------------------------------

function mediaClip(id, m, start, duration, track, { opacity = 1, zoom = 1 } = {}) {
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
    { op: 'addKeyframe', clipId: id, prop: 'scale', time: round(duration), value: round(scale * (isImage ? 1.12 : 1.06) * zoom), easing: 'linear' },
  ];
}

const sfxClip = (id, s, at, volume, extra = {}) => (s?.src ? [{
  op: 'addClip', clipId: id, type: 'audio', src: s.src, start: round(Math.max(0, at)),
  duration: round(extra.duration || Math.min(s.mediaDuration || 1, 1.6)), mediaStart: 0, mediaDuration: s.mediaDuration,
  trackIndex: T.sfx, patch: { volume, ...(extra.loop ? { loop: true } : {}) },
}] : []);

const dim = (id, start, duration, track, fill, opacity) => ({
  op: 'addShapeClip', clipId: id, kind: 'rectangle', start: round(start), duration: round(duration), trackIndex: track,
  style: { fill, fillOpacity: opacity, width: W * 1.3, height: H * 1.3 },
});

/**
 * @param lesson  sanitized lesson (lessons/schema.js) + topic + optional chip label
 * @param media   { ambient?, beatMedia?: (media|null)[], itemMedia?: (media|null)[], music?, sfx?: {whoosh,pop,tick,ding}, voice?: {src, duration, parts, words} }
 */
export function composeLesson(lesson, media = {}) {
  const look = topicOf(lesson.topic);
  const fmt = formatOf(lesson.format);
  const skin = fmt.skin;
  const theme = skin.cards || 'dark';
  const voice = media.voice?.src ? media.voice : null;
  const scenes = scenesFor(lesson);
  const { segments, duration, captions, voiceClips } = planTimeline(scenes, voice);
  const sfx = media.sfx || {};
  const cmds = [];
  const accent = look.accent;
  const card = (id, start, d) => ({ id, start, duration: d, track: T.card, accent, theme });
  let n = 0;
  const uid = (p) => `${p}${n++}`;

  // The project name is set at creation ("StudyTok · <title>") so generated projects are easy to find.
  cmds.push({ op: 'setProjectSettings', aspectRatio: '9:16', fps: config.generation.fps, background: look.bg });

  // ---- Ambient footage under everything, graded by the format and darkened by the scrim.
  // Playback performance: the live player decodes every video layer, so the ambient clip is cut
  // out wherever a full-bleed clip covers it (one decoding video at a time, not two), and the
  // colour grade is applied to the ambient layer only.
  if (media.ambient) {
    const covered = segments.filter((s) => (s.kind === 'beat' && !isTeachingVisual(s.beat?.visual?.kind) && media.beatMedia?.[s.index]) || (s.kind === 'item' && media.itemMedia?.[s.index]))
      .map((s) => [s.start, s.start + s.duration]).sort((a, b) => a[0] - b[0]);
    const gaps = [];
    let t = 0;
    for (const [a, b] of covered) { if (a - t > 0.6) gaps.push([t, a]); t = Math.max(t, b); }
    if (duration - t > 0.6) gaps.push([t, duration]);
    gaps.forEach(([a, b], k) => {
      cmds.push(...mediaClip(k === 0 ? 'ambient' : `ambient${k}`, media.ambient, a, b - a, T.ambient));
      if (skin.filter) cmds.push({ op: 'applyFilterPreset', clipId: k === 0 ? 'ambient' : `ambient${k}`, preset: skin.filter });
    });
  }
  cmds.push(dim('scrim', 0, duration, T.scrim, '#000000', media.ambient ? skin.scrim ?? 0.62 : 0.2));
  // Tracks are created in the order they are first used and composite in that order, so pin the
  // media and card tracks now, before any captions (track 6) exist, with invisible placeholders.
  for (const [id, track] of [['pinMedia', T.media], ['pinCard', T.card], ['pinDim', T.quizDim]]) {
    cmds.push({ op: 'addShapeClip', clipId: id, kind: 'rectangle', start: 0, duration: 0.1, trackIndex: track, style: { fill: '#000000', fillOpacity: 0, width: 4, height: 4 }, patch: { y: 1000 } });
  }
  if (skin.letterbox) {
    for (const [id, y] of [['barTop', -H / 2 + 70], ['barBot', H / 2 - 70]]) {
      cmds.push({ op: 'addShapeClip', clipId: id, kind: 'rectangle', start: 0, duration, trackIndex: T.chrome, style: { fill: '#000000', fillOpacity: 1, width: W * 1.3, height: 140 }, patch: { y } });
    }
  }

  // ---- Chip with the unit (or topic) name and the format tag, on screen throughout.
  const chipText = `${(lesson.chip || lesson.topicLabel || look.label).slice(0, 24)} · ${fmt.tag}`.toUpperCase();
  cmds.push({
    op: 'addShapeClip', clipId: 'chip', kind: 'capsule', start: 0, duration, trackIndex: T.chrome,
    style: { fill: accent, width: Math.min(1000, 120 + chipText.length * 27), height: 92 }, patch: { y: -740 },
  });
  cmds.push({
    op: 'addTextClip', clipId: 'chipText', text: chipText, start: 0, duration, trackIndex: T.chromeText,
    style: { fontSize: 80, fontWeight: 800, color: '#0b0b0b', letterSpacing: 2, maxWidth: 0.9, autoFit: true }, patch: { y: -740 },
  });

  const quizSeg = segments.find((s) => s.kind === 'quiz');
  const revealSeg = segments.find((s) => s.kind === 'reveal');

  for (const seg of segments) {
    const { start, duration: d, kind } = seg;
    if (!['hook', 'reveal', 'flashA', 'chat'].includes(kind)) cmds.push(...sfxClip(uid('whoosh'), sfx.whoosh, start - 0.12, kind === 'item' ? 0.5 : 0.35));

    // -- Captions for spoken scenes that want them.
    if (captions[seg.id]?.length) {
      const keyTerm = seg.beat?.keyTerm || seg.item?.title || '';
      cmds.push({
        op: 'addCaptions', words: captions[seg.id], keepExisting: true, preset: skin.captions.preset, maxWordsPerLine: skin.captions.maxWordsPerLine || 4, maxLineDuration: 2.6,
        trackIndex: T.captions, y: seg.kind === 'beat' && !seg._teaching ? Math.min(skin.captions.y, 240) : skin.captions.y, ...emphasisFor(seg.spoken, keyTerm, accent),
      });
    }

    if (kind === 'hook') {
      const hs = skin.hook;
      cmds.push({
        op: 'addTextClip', clipId: 'hook', text: caseOf(lesson.hook, hs), start: 0, duration: d, trackIndex: T.headline,
        style: styled(hs, { fontSize: hs.fontSize || 160, maxWidth: 0.86, lineHeight: 1.1, animIn: hs.animIn || 'word-pop', animInDuration: hs.animInDuration || 0.6,
          spans: spanFor(caseOf(lesson.hook, hs), caseOf(lesson.hookTerm, hs), hs.color ? '#ffffff' : accent) }),
        patch: { y: -100 },
      });
      cmds.push(...sfxClip('hookPop', sfx.pop, 0.35, 0.4));
    }

    if (kind === 'beat') {
      const i = seg.index;
      const beat = seg.beat;
      const v = beat.visual || { kind: 'footage' };
      const m = media.beatMedia?.[i];
      const teaching = isTeachingVisual(v.kind) ? teachingVisual(v, { ...card(`vis${i}`, start + 0.15, d - 0.15) }) : [];
      const fullBleed = !teaching.length && m;
      if (fullBleed) {
        cmds.push(...mediaClip(`media${i}`, m, start, d + 0.4, T.media));
        cmds.push({ op: 'setTransition', clipId: `media${i}`, type: skin.transition || 'dissolve', duration: 0.4 });
      }
      cmds.push(...teaching);
      // Story chapters and why/myth kickers sit above the key term, under the chip (chip bottom ≈ -694, card top ≈ -490).
      const kicker = seg.kicker || (seg.chapter ? `Chapter ${seg.chapter}` : '');
      const termY = teaching.length ? (kicker ? -555 : -590) : -480;
      if (kicker) {
        cmds.push({ op: 'addTextClip', clipId: `kick${i}`, text: kicker.toUpperCase(), start, duration: d, trackIndex: T.headline,
          style: { fontSize: 60, fontWeight: 800, color: '#ffffff', letterSpacing: 8, animIn: 'fade-in', ...SHADOW }, patch: { y: termY - 95 } });
      }
      if (beat.keyTerm) {
        const ts = skin.term;
        cmds.push({
          op: 'addTextClip', clipId: `term${i}`, text: caseOf(beat.keyTerm, ts), start, duration: d, trackIndex: T.headline,
          style: styled(ts, { fontSize: 140, color: accent, maxWidth: 0.9, autoFit: true, animIn: ts.animIn || 'pop', animInDuration: 0.4, shadowBlur: 20 }),
          patch: { y: termY },
        });
        cmds.push(...sfxClip(uid('pop'), sfx.pop, start + 0.05, 0.45));
      }
      // Captions were placed before we knew whether this beat has a card; fix the y now.
      const cap = cmds.findLast((c) => c.op === 'addCaptions');
      if (cap && captions[seg.id]?.length) cap.y = teaching.length ? skin.captions.y : Math.min(skin.captions.y, 240);
    }

    if (kind === 'stamp') {
      cmds.push(dim(uid('stampDim'), start, d, T.quizDim, look.bg, 0.35));
      cmds.push(...stampCard(card(`stamp${seg.id}`, start + 0.1, d - 0.1), { label: seg.label, text: seg.text, color: seg.color }));
      cmds.push(...sfxClip(uid('stampHit'), skin.stampSfx ? sfx.ding : sfx.pop, start + 0.25, 0.6));
    }

    if (kind === 'item') {
      const i = seg.index;
      const m = media.itemMedia?.[i];
      if (m) {
        cmds.push(...mediaClip(`item${i}`, m, start, d + 0.3, T.media, { zoom: 1.04 }));
        cmds.push({ op: 'setTransition', clipId: `item${i}`, type: skin.transition || 'whip-pan', duration: 0.35 });
      }
      cmds.push(...numberCard(card(`num${i}`, start, d), { index: seg.number != null ? seg.number - 1 : i, total: seg.total, title: seg.item.title }));
      cmds.push(...sfxClip(uid('pop'), sfx.pop, start + 0.05, 0.5));
    }

    if (kind === 'sheet') {
      cmds.push(dim(uid('sheetDim'), start, d, T.quizDim, look.bg, 0.5));
      cmds.push(...sheetCard(card(`sheet${seg.index}`, start, d + 0.05), { items: seg.items, upTo: seg.index }));
      cmds.push(...sfxClip(uid('pop'), sfx.pop, start + 0.1, 0.4));
    }

    if (kind === 'tier') {
      cmds.push(dim(uid('tierDim'), start, d, T.quizDim, look.bg, 0.5));
      cmds.push(...tierCard(card(`tier${seg.index}`, start, d + 0.05), { items: seg.items, latest: seg.item }));
      cmds.push(...sfxClip(uid('pop'), sfx.pop, start + 0.1, 0.5));
    }

    if (kind === 'stepsAll' || kind === 'stepsWrong') {
      cmds.push(dim(uid('stepDim'), start, d, T.quizDim, look.bg, 0.5));
      cmds.push(...answerSteps(card(`${kind}${seg.id}`, start, d + 0.05), { steps: seg.steps, exam: seg.exam, mode: kind === 'stepsAll' ? 'all' : 'wrong', wrong: seg.wrong ?? -1 }));
      if (kind === 'stepsAll') {
        // Invisible markers for tap-to-answer: options from `opt0`, reveal at `optOk`.
        cmds.push({ op: 'addShapeClip', clipId: 'opt0', kind: 'rectangle', start: round(start + 0.4), duration: round(d - 0.4), trackIndex: T.quizBox, style: { fill: '#000000', fillOpacity: 0, width: 10, height: 10 }, patch: { y: 900 } });
        cmds.push({ op: 'addShapeClip', clipId: 'optOk', kind: 'rectangle', start: round(start + d), duration: 1, trackIndex: T.quizBox, style: { fill: '#000000', fillOpacity: 0, width: 10, height: 10 }, patch: { y: 900 } });
        const pause = seg.pauseAfter || 4;
        cmds.push(...sfxClip('tick', sfx.tick, start + d - pause + 0.2, 0.3, { duration: pause - 0.3, loop: true }));
      } else cmds.push(...sfxClip('ding', sfx.ding, start, 0.55));
    }

    if (kind === 'recap') {
      cmds.push(dim(uid('recapDim'), start, d, T.quizDim, look.bg, 0.55));
      cmds.push(...recapCard(card('recap', start, d), { items: seg.items, title: seg.title || 'Recap' }));
      seg.items.forEach((_, k) => cmds.push(...sfxClip(uid('tickItem'), sfx.pop, start + 0.35 + (d * 0.75 * k) / seg.items.length, 0.3)));
    }

    if (kind === 'question') {
      cmds.push(dim('qDim', start, d, T.quizDim, look.bg, 0.5));
      cmds.push(...questionCard(card('exam', start, d), { exam: seg.exam, label: seg.label || 'Exam question' }));
      // Invisible markers the app reads for tap-to-answer timing: options from `opt0`, reveal at `optOk`.
      const stepsStart = segments.find((s) => s.kind === 'steps')?.start ?? start + d;
      cmds.push({ op: 'addShapeClip', clipId: 'opt0', kind: 'rectangle', start: round(start + 0.4), duration: round(stepsStart - start - 0.4), trackIndex: T.quizBox, style: { fill: '#000000', fillOpacity: 0, width: 10, height: 10 }, patch: { y: 900 } });
      cmds.push({ op: 'addShapeClip', clipId: 'optOk', kind: 'rectangle', start: round(stepsStart), duration: 1, trackIndex: T.quizBox, style: { fill: '#000000', fillOpacity: 0, width: 10, height: 10 }, patch: { y: 900 } });
      const pause = seg.pauseAfter || 4;
      cmds.push(...sfxClip('tick', sfx.tick, start + d - pause + 0.2, 0.3, { duration: pause - 0.3, loop: true }));
    }

    if (kind === 'steps') {
      cmds.push(dim(uid('stepDim'), start, d, T.quizDim, look.bg, 0.5));
      cmds.push(...answerSteps(card(`step${seg.index}`, start, d), { steps: seg.steps, index: seg.index, exam: segments.find((s) => s.kind === 'question')?.exam || seg.answer || lesson.exam }));
      if (seg.index === 0) cmds.push(...sfxClip('ding', sfx.ding, start, 0.55));
    }

    if (kind === 'callout') {
      cmds.push(dim(uid('coDim'), start, d, T.quizDim, look.bg, 0.5));
      cmds.push(...calloutCard(card(`co${seg.id}`, start, d), { label: seg.label, text: seg.text, color: seg.color }));
    }

    if (kind === 'flashQ' || kind === 'flashA') {
      cmds.push(dim(uid('fDim'), start, d, T.quizDim, look.bg, 0.45));
      cmds.push(...flashCard(card(`${kind}${seg.index}`, start, d), { card: seg.card, index: seg.index, total: seg.total, side: kind === 'flashQ' ? 'q' : 'a' }));
      if (kind === 'flashQ') cmds.push(...sfxClip(uid('tick'), sfx.tick, start + d - (seg.pauseAfter || 2.5) + 0.1, 0.25, { duration: (seg.pauseAfter || 2.5) - 0.2, loop: true }));
      else cmds.push(...sfxClip(uid('ding'), sfx.ding, start, 0.45));
    }

    if (kind === 'chat') {
      if (seg.index === 0) cmds.push(dim('chatDim', start, round(segments.filter((s) => s.kind === 'chat').reduce((n, s) => n + s.duration, 0)), T.quizDim, look.bg, 0.5));
      cmds.push(...chatThread(card(`msg${seg.index}`, start, d + 0.05), { contact: seg.contact, messages: seg.messages }));
      cmds.push(...sfxClip(uid('pop'), sfx.pop, start + 0.1, 0.4));
    }

    if (kind === 'quiz' && lesson.quiz) {
      const q = lesson.quiz;
      const quizEnd = revealSeg?.start ?? start + d;
      const total = round(duration - start);
      cmds.push(dim('quizDim', start, total, T.quizDim, look.bg, 0.5));
      cmds.push({ op: 'addTextClip', clipId: 'quizLabel', text: 'QUICK CHECK', start, duration: round(quizEnd - start + REVEAL_SEC), trackIndex: T.headline,
        style: styled(skin.term, { fontSize: 104, fontWeight: 800, color: accent, letterSpacing: 6 }), patch: { y: -580 } });
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
            style: { fill: accent, fillOpacity: 1, cornerRadius: 40, width: 900, height: 170 }, patch: { y } });
          cmds.push({ op: 'addTextClip', clipId: 'optTextOk', text: `${'ABC'[k]}.  ${opt}`, start: round(quizEnd), duration: REVEAL_SEC, trackIndex: T.quizTextOk,
            style: { fontSize: 104, fontWeight: 800, color: '#0b0b0b', maxWidth: 0.78, autoFit: true, animIn: 'pop', animInDuration: 0.3 }, patch: { y } });
        }
      });
      // Thinking time: a soft clock under the pause.
      const pause = seg.pauseAfter || 3;
      cmds.push(...sfxClip('tick', sfx.tick, quizEnd - pause + 0.2, 0.3, { duration: pause - 0.3, loop: true }));
    }

    if (kind === 'reveal' && seg.exam) {
      // Guess-first: the answer lands on the question card.
      cmds.push(dim(uid('revealDim'), start, d, T.quizDim, look.bg, 0.5));
      cmds.push(...questionCard(card('examOk', start, d), { exam: seg.exam, revealed: true, label: 'The answer' }));
      cmds.push(...sfxClip('ding', sfx.ding, start, 0.55));
    } else if (kind === 'reveal' && lesson.quiz) {
      cmds.push(...sfxClip('ding', sfx.ding, start, 0.55));
      if (lesson.quiz.explanation) {
        cmds.push({ op: 'addTextClip', clipId: 'explain', text: lesson.quiz.explanation, start: round(start + 0.2), duration: round(d - 0.2), trackIndex: T.quizText,
          style: { fontSize: 76, fontWeight: 600, color: '#ffffff', maxWidth: 0.84, lineHeight: 1.2, animIn: 'fade-in', animInDuration: 0.3 }, patch: { y: 520 } });
      }
    }

    if (kind === 'outro') {
      cmds.push({ op: 'addTextClip', clipId: 'outroLabel', text: (seg.label || 'Remember').toUpperCase(), start, duration: d, trackIndex: T.headline,
        style: styled(skin.term, { fontSize: 104, fontWeight: 800, color: accent, letterSpacing: 8, animIn: 'fade-in' }), patch: { y: -360 } });
      cmds.push(dim('outroDim', start, d, T.card, look.bg, 0.85));
      cmds.push({ op: 'addTextClip', clipId: 'outro', text: seg.text || lesson.takeaway, start, duration: d, trackIndex: T.quizText,
        style: styled(skin.hook, { fontSize: 150, maxWidth: 0.86, lineHeight: 1.12, animIn: 'slide-up', animInDuration: 0.5, color: '#ffffff', outline: undefined, outlineWidth: undefined }), patch: { y: -60 } });
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

  // Drop undefined style fields (JSON would, but keep the commands clean for tests and logs).
  for (const c of cmds) if (c.style) for (const k of Object.keys(c.style)) if (c.style[k] === undefined) delete c.style[k];

  // When the viewer can answer: options appear at `from`, the video is held at `hold` (the end
  // of the question) until they answer, and the answer shows at `reveal`.
  const holdSeg = segments.find((s) => s.kind === 'quiz' || s.kind === 'question' || s.kind === 'stepsAll');
  const quiz = holdSeg ? {
    from: round(holdSeg.start + 0.4),
    hold: round(holdSeg.start + holdSeg.duration - (voice ? holdSeg.pauseAfter || 3 : holdSeg.pauseAfter || 3) + 0.1),
    reveal: round(holdSeg.start + holdSeg.duration),
  } : null;

  return { commands: cmds, duration, segments, format: lesson.format, quiz };
}
