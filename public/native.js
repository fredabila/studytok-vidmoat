// Small things that make the installed app feel like a native one:
//   - haptic(kind): a short vibration on likes, answers and pulls (Android; iOS web has none);
//   - pushLayer(close): the phone's Back button / gesture closes the sheet or panel on top
//     instead of leaving the app;
//   - dragToDismiss(panel, handle, close): pull a sheet down by its top to close it;
//   - setStatusBar(color): the status bar follows the screen (dark feed, paper pages);
//   - setBadge(n): the number on the app icon (lessons due for review).

export const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const PATTERNS = { tap: 8, select: 12, success: [10, 40, 18], error: [24, 40, 24], pull: 14 };
let hapticsOn = true;
export function setHaptics(on) { hapticsOn = on; }
export function haptic(kind = 'tap') {
  if (!hapticsOn || !navigator.vibrate) return;
  try { navigator.vibrate(PATTERNS[kind] ?? PATTERNS.tap); } catch { /* not allowed before a gesture */ }
}

// ---- Back closes the top layer ---------------------------------------------------------------
// While any layer is open there is one extra history entry (a guard). Back pops it: the top layer
// closes and, if others remain, the guard is pushed again. A layer closed by its own button leaves
// the guard in place for the next one (going back from code races with new pushes).
const layers = [];
const hasGuard = () => Boolean(history.state?.sgLayer);
function ensureGuard() { if (!hasGuard()) history.pushState({ ...(history.state || {}), sgLayer: true }, ''); }
window.addEventListener('popstate', () => {
  const top = layers.pop();
  if (!top) return;
  top.close({ fromBack: true });
  if (layers.length) ensureGuard();
});
/** Registers an open layer; returns `done()` to call when it closes by other means. */
export function pushLayer(close) {
  const entry = { close };
  layers.push(entry);
  ensureGuard();
  return () => { const i = layers.indexOf(entry); if (i >= 0) layers.splice(i, 1); };
}

// ---- Drag a sheet down to dismiss ------------------------------------------------------------
export function dragToDismiss(panel, handle, close) {
  let start = null;
  handle.style.touchAction = 'none';
  handle.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || e.target.closest('button, a, input, textarea')) return;
    start = { y: e.clientY, t: performance.now(), id: e.pointerId };
    handle.setPointerCapture(e.pointerId);
    panel.style.transition = 'none';
  });
  handle.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dy = Math.max(0, e.clientY - start.y);
    panel.style.translate = `0 ${dy}px`;
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dy = Math.max(0, e.clientY - start.y);
    const v = dy / Math.max(1, performance.now() - start.t);
    start = null;
    panel.style.transition = 'translate .22s cubic-bezier(.22, .9, .25, 1)';
    if (dy > Math.min(140, panel.offsetHeight * 0.25) || (dy > 24 && v > 0.6)) {
      panel.style.translate = '0 100%';
      setTimeout(() => { close(); panel.style.translate = ''; panel.style.transition = ''; }, 200);
    } else {
      panel.style.translate = '';
      setTimeout(() => { panel.style.transition = ''; }, 230);
    }
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

// ---- Status bar and app badge ----------------------------------------------------------------
export function setStatusBar(color) {
  const m = document.querySelector('meta[name="theme-color"]');
  if (m && m.content !== color) m.content = color;
}
export function setBadge(n) {
  try {
    if (!('setAppBadge' in navigator)) return;
    if (n > 0) navigator.setAppBadge(n).catch(() => {}); else navigator.clearAppBadge().catch(() => {});
  } catch { /* unsupported */ }
}
