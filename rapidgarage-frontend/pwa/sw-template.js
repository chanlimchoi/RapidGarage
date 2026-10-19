/* RapidGarage service worker (generated at build time; see pwa/).
 * Caches the app shell only. API calls, photos and other data always go to
 * the network and are never stored. */
/* __CORE__ */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = CACHE_PREFIX + VERSION;
const SHELL = new Set(PRECACHE);
// Shell files are static: ignore Vary (hosts often send Vary: Origin, and module
// scripts carry an Origin header the precache request didn't).
const MATCH = { cacheName: CACHE, ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page asks a waiting worker to take over (after "Reload" in the update banner).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const how = strategyFor({ method: req.method, url: req.url, mode: req.mode }, { origin: self.location.origin, precache: SHELL });
  if (how === 'bypass') return; // the browser fetches it normally
  if (how === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html', MATCH)
      .then((r) => r || new Response('<h1>Offline</h1><p>RapidGarage needs a connection.</p>', { status: 503, headers: { 'Content-Type': 'text/html' } }))));
    return;
  }
  event.respondWith(caches.match(req, MATCH).then((hit) => hit || fetch(req)));
});

// Push notifications (backend lib/push.js). The payload is small JSON:
// { title, body, url, tag }; it never contains message text.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || 'RapidGarage';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: typeof data.url === 'string' ? data.url : '/' },
  }));
});

// Open (or focus) the page the notification is about. Only same-origin paths.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || '/';
  const target = new URL(raw, self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const same = list.find((c) => c.url === url);
    if (same) return same.focus();
    const any = list.find((c) => new URL(c.url).origin === self.location.origin);
    if (any && any.navigate) return any.navigate(url).then((c) => (c || any).focus());
    return self.clients.openWindow(url);
  }));
});
