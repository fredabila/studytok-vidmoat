// Web Push reminders (client side). The Profile card calls enablePush() / disablePush(); the
// server (server/core/push.js) decides when a reminder is worth sending. Everything here degrades
// to 'unsupported' / 'install-first' rather than throwing, so the card can simply hide itself.
//
// iOS: Safari only delivers Web Push to apps installed to the home screen (16.4+), so on an iPhone
// in the browser tab we report 'install-first' and the card should point at Add to Home Screen.

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => Boolean(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
}

async function registration() {
  // The app registers /sw.js on load; `ready` waits for it rather than registering a second copy.
  return navigator.serviceWorker.ready;
}

/** 'unsupported' | 'install-first' | 'denied' | 'subscribed' | 'off' */
export async function pushState() {
  if (isIOS() && !isStandalone()) return 'install-first';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'off';
  } catch {
    return 'off';
  }
}

// VAPID keys are base64url; PushManager wants the raw 65-byte P-256 point.
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function api(path, body) {
  const res = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

/**
 * Asks for permission, subscribes this device and registers it with the server.
 * Resolves to the new state ('subscribed', 'denied', 'install-first', 'unsupported', or 'off'
 * when the server has no VAPID keys). Call it from a tap: browsers ignore prompts otherwise.
 */
export async function enablePush() {
  const state = await pushState();
  if (state === 'install-first' || state === 'unsupported' || state === 'denied') return state;
  const { enabled, publicKey } = await api('/api/push/key');
  if (!enabled || !publicKey) return 'off';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription())
    || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  await api('/api/push/subscribe', { subscription: sub.toJSON() });
  return 'subscribed';
}

/** Drops this device's subscription on both sides. Resolves to 'off'. */
export async function disablePush() {
  if (!pushSupported()) return 'unsupported';
  try {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const { endpoint } = sub;
      await sub.unsubscribe().catch(() => {});
      await api('/api/push/unsubscribe', { endpoint }).catch(() => {});
    }
  } catch { /* nothing to drop */ }
  return 'off';
}

/** Sends a test notification to this student's devices (QA; the server answers { sent }). */
export const testPush = () => api('/api/push/test', {});
