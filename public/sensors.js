// Device context for the feed, kept coarse on purpose (docs/EVENTS.md): a posture class from the
// motion sensors (how the phone is being held), a drop detector, orientation and battery. Only
// the class names leave the device; raw sensor samples never do. iOS asks the user before
// motion data flows, so `start()` must run inside a user gesture; without permission the app
// simply reports 'unknown'.

const WINDOW_MS = 4000;
const samples = []; // { t, ax, ay, az, beta, gamma }
let orientationSample = { beta: null, gamma: null };
let running = false;
let dropHandler = null;
let lastDrop = 0;

function onMotion(e) {
  const a = e.accelerationIncludingGravity || {};
  if (!Number.isFinite(a.x)) return;
  const now = performance.now();
  samples.push({ t: now, ax: a.x, ay: a.y, az: a.z, beta: orientationSample.beta, gamma: orientationSample.gamma });
  while (samples.length && now - samples[0].t > WINDOW_MS) samples.shift();
  // A drop: a near-free-fall (total acceleration far below 1 g) followed within half a second by a
  // hard impact (far above 1 g). Debounced so one tumble is one event.
  const g = Math.hypot(a.x, a.y, a.z) / 9.81;
  if (g < 0.35) onMotion.fallAt = now;
  if (g > 2.6 && onMotion.fallAt && now - onMotion.fallAt < 600 && now - lastDrop > 4000) {
    lastDrop = now; onMotion.fallAt = 0;
    dropHandler?.();
  }
}
function onOrientation(e) {
  if (Number.isFinite(e.beta)) orientationSample = { beta: e.beta, gamma: e.gamma };
}

/** Starts sampling (call inside a user gesture on iOS). Resolves to true when motion data is flowing. */
export async function start({ onDrop } = {}) {
  dropHandler = onDrop || null;
  if (running) return true;
  if (typeof DeviceMotionEvent === 'undefined') return false;
  try {
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      const ok = await DeviceMotionEvent.requestPermission();
      if (ok !== 'granted') return false;
      if (typeof DeviceOrientationEvent?.requestPermission === 'function') await DeviceOrientationEvent.requestPermission().catch(() => {});
    }
  } catch { return false; }
  window.addEventListener('devicemotion', onMotion, { passive: true });
  window.addEventListener('deviceorientation', onOrientation, { passive: true });
  running = true;
  return true;
}

/**
 * How the phone is being used right now:
 *   'flat'    lying on a table or the bed, screen up
 *   'hand'    held in the hand, roughly upright, still
 *   'moving'  walking or in a vehicle (steady shake)
 *   'unknown' no motion data (desktop, no permission)
 */
export function posture() {
  if (!running || samples.length < 8) return 'unknown';
  const recent = samples.slice(-40);
  const mags = recent.map((s) => Math.hypot(s.ax, s.ay, s.az));
  const mean = mags.reduce((a, b) => a + b, 0) / mags.length;
  const variance = mags.reduce((a, b) => a + (b - mean) ** 2, 0) / mags.length;
  const jitter = Math.sqrt(variance); // m/s²
  const beta = recent.at(-1).beta;
  if (jitter > 1.6) return 'moving';
  // Gravity mostly on the z axis (|az| ≈ g) means the screen faces up or down: lying flat.
  const az = Math.abs(recent.at(-1).az);
  if (az > 8.2 || (beta != null && Math.abs(beta) < 25)) return 'flat';
  return 'hand';
}

/** Coarse device context for a telemetry batch. */
export async function context() {
  const out = { orientation: screen.orientation?.type?.startsWith('landscape') ? 'landscape' : 'portrait', posture: posture() };
  try {
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      out.battery = b.level <= 0.15 ? 'low' : b.level <= 0.5 ? 'mid' : 'high';
      out.charging = Boolean(b.charging);
    }
  } catch { /* unsupported */ }
  return out;
}
