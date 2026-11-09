// StudyGraph service worker: makes the app installable and keeps the shell available offline.
// - App shell (HTML, JS, CSS, icons): network first, falling back to the cache when offline, so
//   every open gets the HTML, JS and CSS of the same deploy (stale-while-revalidate served the
//   previous deploy's CSS under the new HTML for one open, which broke layouts after releases).
// - /api/*, the Vidmoat player and media: never cached (always live).
const VERSION = 'studygraph-v39';
const SHELL = ['/', '/index.html', '/app.js', '/player.js', '/telemetry.js', '/sensors.js', '/share.js', '/push.js', '/styles.css', '/manifest.webmanifest', '/icon.svg',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/favicon-32.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))));
    return;
  }
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req)) || Response.error();
      }
    }),
  );
});

// Web Push reminders (server/core/push.js sends { title, body, url, tag }). Shown even when the
// payload is missing or unreadable: a push the user cannot see counts against the subscription
// in Chrome, which may then drop it silently.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'StudyGraph';
  const options = {
    body: data.body || 'Time for a quick lesson.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'studygraph-reminder',
    renotify: false,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Reuse an open StudyGraph window (the installed app) rather than stacking a second one.
      const open = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) return open.navigate(url).catch(() => open).then((c) => (c || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
