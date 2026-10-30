/* RapidGarage service worker (generated at build time; see pwa/).
 * Caches the app shell, plus the last few sale pages the person opened (public
 * sale data and its photos) so they still open offline. Every other API call
 * and upload always goes to the network and is never stored. */
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
  // Signing out forgets recently viewed sales (they may carry per-viewer marks).
  if (event.data && event.data.type === 'CLEAR_RECENT') event.waitUntil(Promise.all([caches.delete(RECENT_CACHE), caches.delete(RECENT_PHOTO_CACHE)]));
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
  if (how === 'recent-sale') { event.respondWith(recentSale(event, req)); return; }
  if (how === 'recent-photo') {
    event.respondWith(caches.match(req, { cacheName: RECENT_PHOTO_CACHE, ignoreVary: true }).then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, MATCH).then((hit) => hit || fetch(req)));
});

// ---- recently viewed sales ---------------------------------------------------
// Network first. A fresh 200 is remembered (with when it was saved, which the
// sale page shows offline); a sale that's gone (404/410/403) is forgotten.
// Offline, the saved copy answers; with no copy the request fails as usual.
function recentSale(event, req) {
  const p = new URL(req.url).pathname;
  return fetch(req).then((res) => {
    if (res && res.status === 200) event.waitUntil(rememberSale(p, res.clone()).catch(() => {}));
    else if (res && (res.status === 404 || res.status === 410 || res.status === 403)) event.waitUntil(forgetSales([p]).catch(() => {}));
    return res;
  }).catch((err) => caches.match(req, { cacheName: RECENT_CACHE, ignoreVary: true }).then((hit) => {
    if (hit) return hit;
    throw err;
  }));
}

function rememberSale(p, res) {
  return res.text().then((text) => {
    let sale;
    try { sale = JSON.parse(text); } catch (e) { return null; }
    if (!sale || typeof sale !== 'object' || Array.isArray(sale)) return null;
    sale.offlineSavedAt = new Date().toISOString();
    const body = JSON.stringify(sale);
    return caches.open(RECENT_CACHE).then((recentSales) => recentSales.delete(p)
      .then(() => recentSales.put(p, new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })))
      .then(() => caches.open(RECENT_PHOTO_CACHE))
      .then((recentPhotos) => Promise.all(salePhotoPaths(sale, self.location.origin).map((photo) => recentPhotos.match(photo)
        .then((hit) => hit || fetch(photo).then((r) => (r && r.status === 200 ? recentPhotos.put(photo, r) : null)))
        .catch(() => null))))
      .then(() => recentSales.keys())
      .then((keys) => forgetSales(recentOverflow(keys.map((k) => new URL(k.url || k, self.location.origin).pathname)))));
  });
}

// Drop sales (and their photos) from the recent cache.
function forgetSales(paths) {
  if (!paths.length) return Promise.resolve();
  return Promise.all([caches.open(RECENT_CACHE), caches.open(RECENT_PHOTO_CACHE)]).then(([recentSales, recentPhotos]) => Promise.all(paths.map((p) => recentSales.match(p)
    .then((hit) => (hit ? hit.json().catch(() => null) : null))
    .then((sale) => Promise.all(salePhotoPaths(sale, self.location.origin).map((photo) => recentPhotos.delete(photo))))
    .then(() => recentSales.delete(p)))));
}

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
