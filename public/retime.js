// Playback speed without a new video: the player plays whatever document we send, so a lesson at
// 1.25x is the same document with every timeline time divided by 1.25 and every audio/video clip
// playing 1.25x faster. Times in the source (mediaStart, mediaDuration) stay as they are.
// The player wrapper converts the times it reports and receives (player.js, `rate`), so the rest of
// the app keeps thinking in lesson seconds (quiz holds, scenes, progress).

export const SPEEDS = [0.75, 1, 1.25, 1.5];

// Timeline seconds inside a clip that scale with speed.
const CLIP_TIMES = ['start', 'duration', 'fadeIn', 'fadeOut'];
const STYLE_TIMES = ['animInDuration', 'animOutDuration', 'animDelay'];

const scaleKeyframes = (list, r) => (Array.isArray(list) ? list.map((k) => (k && Number.isFinite(k.time) ? { ...k, time: k.time / r } : k)) : list);

/** A copy of `clips` played at `rate` (0.5–2). rate 1 returns the clips unchanged. */
export function retimeClips(clips, rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r === 1 || r < 0.5 || r > 2) return clips;
  return clips.map((c) => {
    const out = { ...c };
    for (const k of CLIP_TIMES) if (Number.isFinite(out[k])) out[k] = out[k] / r;
    for (const [k, v] of Object.entries(c)) if (/^kf[A-Z]/.test(k)) out[k] = scaleKeyframes(v, r);
    if (c.type === 'video' || c.type === 'audio') out.speed = (Number.isFinite(c.speed) && c.speed > 0 ? c.speed : 1) * r;
    if (c.textStyle) {
      const ts = { ...c.textStyle };
      for (const k of STYLE_TIMES) if (Number.isFinite(ts[k])) ts[k] = ts[k] / r;
      // Word timings (karaoke captions), when present, are timeline seconds too.
      if (Array.isArray(ts.words)) ts.words = ts.words.map((w) => ({ ...w, ...(Number.isFinite(w.start) ? { start: w.start / r } : {}), ...(Number.isFinite(w.end) ? { end: w.end / r } : {}) }));
      out.textStyle = ts;
    }
    if (c.transitionOut && Number.isFinite(c.transitionOut.duration)) out.transitionOut = { ...c.transitionOut, duration: c.transitionOut.duration / r };
    return out;
  });
}
