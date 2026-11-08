// Event collection for the feed (docs/EVENTS.md). Everything the viewer does is queued here
// with a timestamp and a session id, batched, and posted to /api/events every few seconds, on
// a full queue, and when the page is hidden or closed (sendBeacon). Nothing leaves the
// StudyTok server, and nothing in a batch identifies a device beyond coarse viewport, connection
// and time-zone context.

import { context as deviceContext, posture } from './sensors.js';

const FLUSH_MS = 4000;
const MAX_QUEUE = 25;

const sid = (() => {
  try {
    let s = sessionStorage.getItem('st_sid');
    if (!s) { s = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); sessionStorage.setItem('st_sid', s); }
    return s;
  } catch { return Math.random().toString(36).slice(2, 10); }
})();

let device = {};
deviceContext().then((d) => { device = d; }).catch(() => {});
function context() {
  return {
    sid, ...device, posture: posture(),
    vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio || 1,
    standalone: Boolean(matchMedia('(display-mode: standalone)').matches || navigator.standalone),
    conn: navigator.connection?.effectiveType || '',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    lang: navigator.language || '',
    platform: /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'ios' : /android/i.test(navigator.userAgent) ? 'android' : 'desktop',
  };
}

let queue = [];
let timer = null;
let seq = 0;
let sending = false;

/** Queue one event. `videoId` is required for video events; other fields are per docs/EVENTS.md. */
export function track(type, fields = {}) {
  const e = { type, at: Date.now(), seq: seq++, ...fields };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  queue.push(e);
  if (queue.length >= MAX_QUEUE) flush();
  else if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/** Send what is queued. `beacon` uses navigator.sendBeacon (page is going away). */
export function flush(beacon = false) {
  clearTimeout(timer); timer = null;
  if (!queue.length || (sending && !beacon)) return;
  const events = queue.splice(0, 200);
  const body = JSON.stringify({ ctx: context(), events });
  if (beacon && navigator.sendBeacon) {
    // text/plain avoids a preflight and is parsed server-side like JSON.
    if (navigator.sendBeacon('/api/events', new Blob([body], { type: 'text/plain' }))) return;
  }
  sending = true;
  fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, credentials: 'same-origin', keepalive: true })
    .then((r) => r.json().catch(() => ({})))
    .then((d) => { if (Array.isArray(d.levelUps) && d.levelUps.length) window.dispatchEvent(new CustomEvent('studytok:levelup', { detail: d.levelUps })); })
    .catch(() => { if (events.length < 100) queue.unshift(...events); })
    .finally(() => { sending = false; if (queue.length && !timer) timer = setTimeout(flush, FLUSH_MS); });
}

document.addEventListener('visibilitychange', () => { if (document.hidden) { track('app_hidden'); flush(true); } else track('app_visible'); });
window.addEventListener('pagehide', () => flush(true));

/** Per-video watch bookkeeping: heartbeats while playing, scene changes, loops, pause/resume. */
export class WatchTracker {
  constructor(videoId, { duration = 0, scenes = [] } = {}) {
    this.videoId = videoId; this.duration = duration; this.scenes = scenes;
    this.watched = 0; this.maxT = 0; this.loops = 0; this.lastT = 0; this.lastBeat = 0; this.scene = null; this.playing = false; this.started = false;
  }
  /** Called on every player state message. */
  tick(t, playing, now = Date.now()) {
    if (playing && t > this.lastT) this.watched += Math.min(t - this.lastT, 0.5);
    if (t + 0.3 < this.lastT && this.lastT > 1) { this.loops++; track('loop', { videoId: this.videoId, loops: this.loops }); }
    this.lastT = t; this.maxT = Math.max(this.maxT, t);
    if (playing !== this.playing) {
      this.playing = playing;
      if (this.started) track(playing ? 'resume' : 'pause', { videoId: this.videoId, t: +t.toFixed(1), by: playing ? undefined : this.pauseBy || 'player' });
      this.pauseBy = null;
    }
    if (playing) {
      this.started = true;
      if (now - this.lastBeat >= 5000) { this.lastBeat = now; track('heartbeat', { videoId: this.videoId, t: +t.toFixed(1), watched: +this.watched.toFixed(1), loops: this.loops, posture: posture() }); }
      const s = this.scenes.length ? this.scenes.findLast((x) => t >= x.start) : null;
      if (s && s.id !== this.scene) { this.scene = s.id; track('scene', { videoId: this.videoId, sceneId: s.id, kind: s.kind, t: +t.toFixed(1) }); }
    }
  }
  /** The viewer moved on: one `leave` event with how far they got and how. */
  leave(dir) {
    if (!this.started && this.watched === 0) return;
    const pct = this.duration ? Math.min(1, Math.max(this.maxT, this.watched) / this.duration) : 0;
    track('leave', { videoId: this.videoId, t: +this.lastT.toFixed(1), watched: +this.watched.toFixed(1), maxT: +this.maxT.toFixed(1), pct: +pct.toFixed(3), loops: this.loops, dir, early: this.watched < 2, posture: posture() });
  }
}
