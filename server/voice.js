// Narration for a lesson with Vidmoat speech, plus the timings the composer needs:
// where each section (hook, beats, quiz question, answer, takeaway) starts in the audio, word
// timings for captions, and the point where the audio is cut to leave a pause before the
// quiz answer.
//
// Cost per video: the speech route (Grok 8 or OpenAI 15 credits, capped by maxCredits) + 5
// credits in 'exact' timing mode (transcription). 'estimated' mode spends only the speech and estimates timings from the text; it then ends the
// narration at the quiz question (no reliable cut point), and the answer is shown, not spoken.

import { config } from './config.js';
import { createSpeech, transcribe, importMedia, getMe } from './vidmoat.js';

const MAX_CHARS = 1000;
const sentence = (s) => { s = String(s || '').trim(); return s && !/[.!?…]$/.test(s) ? `${s}.` : s; };

/** The narration, split into labelled parts in speaking order. */
export function narrationParts(lesson, { withAnswer = true } = {}) {
  const parts = [{ kind: 'hook', text: sentence(lesson.hook) }];
  lesson.beats.forEach((b, i) => parts.push({ kind: 'beat', index: i, text: sentence(b.text) }));
  if (lesson.quiz) {
    parts.push({ kind: 'quizQ', text: `Quick check. ${sentence(lesson.quiz.question).replace(/\.$/, '?')}` });
    if (withAnswer) {
      const q = lesson.quiz;
      parts.push({ kind: 'reveal', text: `It's ${'ABC'[q.answerIndex]}: ${sentence(q.options[q.answerIndex])} ${sentence(q.explanation)}`.trim() });
    }
  }
  if (withAnswer || !lesson.quiz) parts.push({ kind: 'outro', text: sentence(lesson.takeaway) });

  // Fit Grok's 1,000-character limit: drop the explanation first, then the takeaway.
  const len = () => parts.reduce((n, p) => n + p.text.length + 1, 0);
  const reveal = parts.find((p) => p.kind === 'reveal');
  if (len() > MAX_CHARS && reveal) reveal.text = `It's ${'ABC'[lesson.quiz.answerIndex]}: ${sentence(lesson.quiz.options[lesson.quiz.answerIndex])}`;
  if (len() > MAX_CHARS) parts.splice(parts.findIndex((p) => p.kind === 'outro'), 1);
  while (len() > MAX_CHARS && parts.filter((p) => p.kind === 'beat').length > 2) {
    const last = parts.map((p) => p.kind).lastIndexOf('beat');
    parts.splice(last, 1);
  }
  return parts;
}

/**
 * Where each part starts in the audio. Estimates from character share, then (with word
 * timings) snaps each boundary to the best pause between words near the estimate.
 * @returns {{ parts: Array<{kind,index,start,end}>, cuts: number[] }}  cuts[k] = silence midpoint before part k
 */
export function alignParts(parts, duration, words = []) {
  const total = parts.reduce((n, p) => n + p.text.length + 1, 0);
  let chars = 0;
  const est = parts.map((p) => { const t = (chars / total) * duration; chars += p.text.length + 1; return t; });
  const starts = [0];
  const cuts = [0];
  let from = 1;
  for (let k = 1; k < parts.length; k++) {
    if (!words.length) { starts.push(est[k]); cuts.push(est[k]); continue; }
    let best = null;
    for (let j = from; j < words.length; j++) {
      const w = words[j], prev = words[j - 1];
      if (w.start < est[k] - 2.5) continue;
      if (w.start > est[k] + 2.5) break;
      const gap = w.start - prev.end;
      const score = gap + (/[.?!:]$/.test(prev.text) ? 0.4 : 0) - Math.abs(w.start - est[k]) * 0.08;
      if (!best || score > best.score) best = { j, score, start: w.start, cut: (prev.end + w.start) / 2 };
    }
    if (!best) { starts.push(est[k]); cuts.push(est[k]); continue; }
    starts.push(best.start); cuts.push(best.cut); from = best.j + 1;
  }
  return {
    parts: parts.map((p, k) => ({ kind: p.kind, index: p.index, start: Math.round(starts[k] * 100) / 100, end: Math.round((k + 1 < parts.length ? starts[k + 1] : duration) * 100) / 100 })),
    cuts,
  };
}

let creditCache = { at: 0, remaining: null };
async function creditsRemaining() {
  if (Date.now() - creditCache.at < 60_000 && creditCache.remaining != null) return creditCache.remaining;
  const me = await getMe();
  creditCache = { at: Date.now(), remaining: me.account?.credits?.remaining ?? 0 };
  return creditCache.remaining;
}

/**
 * @returns {Promise<null | { src, duration, split, parts, words, credits, mode }>}  null = make the video silent
 */
export async function narrate(lesson) {
  if (!config.voice.enabled) return null;
  const exact = config.voice.timing === 'exact';
  const cost = config.voice.maxCredits + (exact ? 5 : 0);
  try {
    const remaining = await creditsRemaining();
    if (remaining - cost < config.voice.minCredits) {
      console.warn(`[voice] ${remaining} credits left (floor ${config.voice.minCredits}): making this video without narration`);
      return null;
    }
  } catch { /* if /v1/me fails, try anyway: speech returns 402 when it cannot pay */ }

  const parts = narrationParts(lesson, { withAnswer: exact });
  const text = parts.map((p) => p.text).join(' ');
  try {
    const { provider, voiceId, maxCredits } = config.voice;
    // Delivery instructions only apply to OpenAI voices; send them when OpenAI can be chosen.
    const instructions = provider === 'openai' || (provider === 'auto' && maxCredits >= 15) ? config.voice.instructions : undefined;
    const speech = await createSpeech({ text, provider, voiceId, maxCredits, instructions });
    creditCache.remaining = speech.credits?.remaining ?? null;
    let duration, words = [];
    if (exact) {
      const tr = await transcribe({ src: speech.url, language: 'en' });
      words = (tr.words || []).filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end));
      duration = tr.mediaSeconds || words.at(-1)?.end;
      if (tr.credits?.remaining != null) creditCache.remaining = tr.credits.remaining;
    } else {
      duration = (await importMedia(speech.url)).durationSec;
    }
    if (!duration) throw new Error('Could not measure the narration');

    const aligned = alignParts(parts, duration, words);
    if (!words.length) {
      // Estimated mode: build word timings per part from the text.
      for (const p of aligned.parts) {
        const src = parts.find((x) => x.kind === p.kind && x.index === p.index);
        const ws = src.text.split(/\s+/).filter(Boolean);
        const step = (p.end - p.start) / Math.max(1, ws.length);
        ws.forEach((t, i) => words.push({ text: t, start: p.start + i * step, end: p.start + (i + 1) * step }));
      }
    }
    const revealIdx = aligned.parts.findIndex((p) => p.kind === 'reveal');
    return {
      src: speech.url,
      duration: Math.round(duration * 100) / 100,
      split: revealIdx > 0 ? Math.round(aligned.cuts[revealIdx] * 100) / 100 : null,
      parts: aligned.parts,
      words,
      credits: (speech.credits?.charged || 0) + (exact ? 5 : 0),
      mode: exact ? 'exact' : 'estimated',
    };
  } catch (err) {
    console.warn(`[voice] narration failed (${err.code || err.message}): making this video without narration`);
    return null;
  }
}
