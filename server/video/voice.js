// Narration for a lesson with Vidmoat speech, plus the timings the composer needs: where each
// spoken scene starts in the audio, word timings for captions, and the cut points where the
// audio is split to leave a pause (thinking time before an answer, a silent recap card).
//
// Cost per video: the speech route (Grok 8 or OpenAI 15 credits, capped by maxCredits) + 5
// credits in 'exact' timing mode (transcription). 'estimated' mode spends only the speech and
// estimates timings from the text; it then leaves the quiz answer unspoken (no reliable cut
// point), so the answer is shown, not said.

import { config } from '../core/config.js';
import { createSpeech, transcribe, importMedia, getMe } from '../core/vidmoat.js';
import { scenesFor, format as formatOf } from './formats.js';

const MAX_CHARS = 1000;
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * The narration as labelled parts in speaking order, one per spoken scene, each carrying the
 * pause the video wants before it (the previous scene's pauseAfter plus any silent scenes
 * in between). Trimmed to the 1,000-character speech limit by dropping the least important
 * scenes first.
 * @param {object} lesson  sanitized lesson (with `format`)
 * @returns {Array<{ id, text, pauseBefore }>}
 */
export function narrationParts(lesson, { withAnswer = true } = {}) {
  const scenes = scenesFor(lesson);
  const parts = [];
  let pending = 0;
  for (const s of scenes) {
    if (!s.spoken || (!withAnswer && s.kind === 'reveal')) { pending += s.spoken ? 0 : s.minDur || 3; continue; }
    parts.push({ id: s.id, kind: s.kind, text: s.spoken, short: s.short, pauseBefore: r2(pending) });
    pending = s.pauseAfter || 0;
  }

  const len = () => parts.reduce((n, p) => n + p.text.length + 1, 0);
  const drop = (i) => { if (i < 0) return; if (parts[i + 1]) parts[i + 1].pauseBefore = r2(parts[i + 1].pauseBefore + parts[i].pauseBefore); parts.splice(i, 1); };
  // 1. shorten the answer, 2. drop the takeaway, 3. drop trailing teaching scenes down to two.
  const reveal = parts.find((p) => p.kind === 'reveal');
  if (len() > MAX_CHARS && reveal?.short) reveal.text = reveal.short;
  if (len() > MAX_CHARS) drop(parts.findIndex((p) => p.kind === 'outro'));
  const teaching = (p) => ['beat', 'item', 'chat', 'steps', 'stamp', 'flashQ', 'flashA'].includes(p.kind);
  while (len() > MAX_CHARS && parts.filter(teaching).length > 2) {
    let last = -1;
    parts.forEach((p, i) => { if (teaching(p)) last = i; });
    drop(last);
  }
  return parts;
}

/**
 * Where each part starts in the audio. Estimates from character share, then (with word
 * timings) snaps each boundary to the best pause between words near the estimate.
 * @returns {{ parts: Array<{id,kind,start,end,cutBefore,pauseBefore}> }}  cutBefore = silence midpoint before the part
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
    parts: parts.map((p, k) => ({
      id: p.id, kind: p.kind, start: r2(starts[k]), end: r2(k + 1 < parts.length ? starts[k + 1] : duration),
      cutBefore: r2(cuts[k]), pauseBefore: k === 0 ? 0 : p.pauseBefore || 0,
    })),
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
 * @returns {Promise<null | { src, duration, parts, words, credits, mode, voiceId }>}  null = make the video silent
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
    const { provider, maxCredits } = config.voice;
    // Each format has its own narrator (an OpenAI voice) unless a voice is pinned in config or
    // the provider is forced to one without named voices.
    const skinVoice = provider === 'grok' || provider === 'cartesia' || maxCredits < 15 ? '' : formatOf(lesson.format).skin.voice || '';
    const voiceId = config.voice.voiceId || skinVoice || undefined;
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
        const src = parts.find((x) => x.id === p.id);
        const ws = src.text.split(/\s+/).filter(Boolean);
        const step = (p.end - p.start) / Math.max(1, ws.length);
        ws.forEach((t, i) => words.push({ text: t, start: p.start + i * step, end: p.start + (i + 1) * step }));
      }
    }
    return {
      src: speech.url,
      duration: r2(duration),
      parts: aligned.parts,
      words,
      credits: (speech.credits?.charged || 0) + (exact ? 5 : 0),
      mode: exact ? 'exact' : 'estimated',
      voiceId: speech.route?.voiceId || voiceId || null,
    };
  } catch (err) {
    console.warn(`[voice] narration failed (${err.code || err.message}): making this video without narration`);
    return null;
  }
}
