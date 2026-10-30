// node --test test/  (no browser needed)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { strategyFor, shellFiles, salePhotoPaths, recentOverflow, RECENT_MAX } from '../pwa/sw-core.js';
import { buildServiceWorker } from '../pwa/vite-plugin.js';
import { checkPwa } from '../scripts/check-pwa.js';

const ORIGIN = 'https://rapidgarage.example';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { origin: ORIGIN, precache: new Set(['/index.html', '/assets/index-abc.js', '/icons/icon-192.png']) };
const req = (p, extra) => Object.assign({ method: 'GET', url: ORIGIN + p, mode: 'cors' }, extra);

describe('service worker routing', () => {
  test('never touches other API calls, uploads, auth or the worker itself', () => {
    for (const p of ['/api/me', '/api/saved', '/api/conversations/1/messages', '/api/post/1/items', '/api/post/abc', '/api/post/1?x=1', '/api/uploads/messages/1/a.webp', '/api', '/uploads/x.jpg', '/auth/google', '/sw.js', '/s/k7m3pq9x']) {
      assert.equal(strategyFor(req(p), ctx), 'bypass', p);
      assert.equal(strategyFor(req(p, { mode: 'navigate' }), ctx), 'bypass', p + ' (navigate)');
    }
  });
  test('a sale\'s page data and its photos are the only runtime-cached requests', () => {
    assert.equal(strategyFor(req('/api/post/12'), ctx), 'recent-sale');
    assert.equal(strategyFor(req('/api/uploads/posts/12/a.webp'), ctx), 'recent-photo');
    assert.equal(strategyFor(req('/uploads/posts/12/b-thumb.jpg'), ctx), 'recent-photo');
    assert.equal(strategyFor(req('/api/post/12', { method: 'PUT' }), ctx), 'bypass');
    assert.equal(strategyFor({ method: 'GET', url: 'https://cdn.example/api/post/12', mode: 'cors' }, ctx), 'bypass');
  });
  test('photo paths come from the sale, same-origin only, thumbnails first, capped', () => {
    const sale = { photos: [
      { url: '/api/uploads/posts/1/a.webp', thumbUrl: '/api/uploads/posts/1/a-thumb.webp' },
      { url: 'https://cdn.example/posts/1/b.webp', thumbUrl: ORIGIN + '/api/uploads/posts/1/b-thumb.webp' },
      { url: '/api/uploads/messages/1/c.webp' },
    ] };
    assert.deepEqual(salePhotoPaths(sale, ORIGIN), ['/api/uploads/posts/1/a-thumb.webp', '/api/uploads/posts/1/b-thumb.webp', '/api/uploads/posts/1/a.webp']);
    assert.deepEqual(salePhotoPaths(null, ORIGIN), []);
    const many = { photos: Array.from({ length: 12 }, (_, i) => ({ url: '/api/uploads/posts/1/p' + i + '.webp' })) };
    assert.equal(salePhotoPaths(many, ORIGIN).length, 8);
  });
  test('keeps the newest RECENT_MAX sales', () => {
    const paths = Array.from({ length: RECENT_MAX + 2 }, (_, i) => '/api/post/' + i);
    assert.deepEqual(recentOverflow(paths), ['/api/post/0', '/api/post/1']);
    assert.deepEqual(recentOverflow(paths.slice(0, 3)), []);
  });
  test('only /s/<code> short links bypass, not app routes starting with /s', () => {
    for (const p of ['/saved', '/settings', '/signup', '/s']) assert.equal(strategyFor(req(p, { mode: 'navigate' }), ctx), 'navigate', p);
  });

  test('non-GET and cross-origin requests bypass', () => {
    assert.equal(strategyFor(req('/assets/index-abc.js', { method: 'POST' }), ctx), 'bypass');
    assert.equal(strategyFor({ method: 'GET', url: 'https://maps.googleapis.com/maps/api/js', mode: 'no-cors' }, ctx), 'bypass');
    assert.equal(strategyFor({ method: 'GET', url: 'not a url', mode: 'cors' }, ctx), 'bypass');
  });
  test('page loads are network-first navigations; shell files come from the cache', () => {
    assert.equal(strategyFor(req('/post/12', { mode: 'navigate' }), ctx), 'navigate');
    assert.equal(strategyFor(req('/', { mode: 'navigate' }), ctx), 'navigate');
    assert.equal(strategyFor(req('/assets/index-abc.js'), ctx), 'shell');
    assert.equal(strategyFor(req('/icons/icon-192.png'), ctx), 'shell');
    // Anything not in the shell is left alone (no runtime caching).
    assert.equal(strategyFor(req('/assets/other-xyz.js'), ctx), 'bypass');
    assert.equal(strategyFor(req('/robots.txt'), ctx), 'bypass');
  });
  test('the shell list keeps boot files only', () => {
    const files = ['index.html', 'sw.js', 'manifest.webmanifest', 'assets/index-a.js', 'assets/index-a.js.map', 'assets/index-a.css',
      'assets/inter-latin.woff2', 'icons/icon-192.png', 'icons/icon.svg', 'favicon.ico', 'notes.txt'];
    assert.deepEqual(shellFiles(files), ['/assets/index-a.css', '/assets/index-a.js', '/assets/inter-latin.woff2', '/favicon.ico', '/icons/icon-192.png', '/icons/icon.svg', '/index.html', '/manifest.webmanifest']);
  });

  test('with index.html it precaches the boot graph, not every chunk', () => {
    const files = ['index.html', 'manifest.webmanifest', 'favicon.ico', 'icons/icon-192.png',
      'assets/index-entry.js', 'assets/vendor.js', 'assets/preloaded.js', 'assets/index.css',
      'assets/inter-latin.woff2', 'assets/inter-cyrillic.woff2',
      'assets/Admin-lazy.js', 'assets/Messages-lazy.js', 'assets/ko-catalog.js', 'assets/notes.js.map'];
    const html = '<link rel="stylesheet" href="/assets/index.css">'
      + '<script type="module" src="/assets/index-entry.js"></script>'
      + '<link rel="modulepreload" href="/assets/vendor.js">'
      + '<link rel="modulepreload" href="/assets/preloaded.js">';
    const css = "@font-face{src:url(/assets/inter-latin.woff2)}@font-face{src:url('/assets/inter-cyrillic.woff2')}";
    assert.deepEqual(shellFiles(files, html, css), [
      '/assets/index-entry.js', '/assets/index.css', '/assets/inter-cyrillic.woff2', '/assets/inter-latin.woff2',
      '/assets/preloaded.js', '/assets/vendor.js', '/favicon.ico', '/icons/icon-192.png', '/index.html', '/manifest.webmanifest',
    ]);
    // The lazy route chunks and non-English catalogs are fetched on demand.
    assert.ok(!shellFiles(files, html, css).includes('/assets/Admin-lazy.js'));
    assert.ok(!shellFiles(files, html, css).includes('/assets/ko-catalog.js'));
  });
});

// A minimal production-like build in a temp dir.
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-pwa-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.cpSync(path.join(root, 'public'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc.js'), 'navigator.serviceWorker.register(`/sw.js`,{scope:`/`})');
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc.js.map'), '{}');
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc.css'), 'body{}');
  fs.writeFileSync(path.join(dir, 'assets', 'About-lazy.js'), 'export default 1');
  // Make it look like a real build: index.html names its boot graph, so
  // shellFiles precaches the entry/css but not the lazy route chunk.
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
    .replace('/app/index.jsx', '/assets/index-abc.js')
    .replace('</head>', '<link rel="stylesheet" href="/assets/index-abc.css"></head>');
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  return dir;
}

// Run sw.js in a sandbox with fake caches/fetch; returns hooks to drive it.
function loadWorker(dir, { online }) {
  const listeners = {};
  const store = new Map(); // cacheName -> Map(path -> body)
  const fetched = [];
  const resp = (body, status) => ({ body, status: status || 200, clone() { return resp(body, status); }, text: async () => body, json: async () => JSON.parse(body) });
  const routes = {}; // path -> body served by the fake network (else 'network:<path>')
  const pathOf = (r) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).pathname;
  const entry = (name) => { if (!store.has(name)) store.set(name, new Map()); return store.get(name); };
  const caches = {
    open: async (name) => {
      const c = entry(name);
      return {
        addAll: async (reqs) => { for (const r of reqs) c.set(pathOf(r), 'cached:' + pathOf(r)); },
        put: async (r, res) => { c.set(pathOf(r), res.body); },
        match: async (r) => (c.has(pathOf(r)) ? resp(c.get(pathOf(r))) : undefined),
        delete: async (r) => c.delete(pathOf(r)),
        keys: async () => Array.from(c.keys()).map((p) => ({ url: ORIGIN + p })),
      };
    },
    keys: async () => Array.from(store.keys()),
    delete: async (k) => store.delete(k),
    match: async (r, opts) => {
      const c = store.get(opts && opts.cacheName);
      const hit = c && c.get(pathOf(r));
      return hit ? resp(hit) : undefined;
    },
  };
  const sandbox = {
    self: { location: { origin: ORIGIN }, addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting: () => {}, clients: { claim: async () => {} } },
    caches,
    fetch: async (r) => {
      fetched.push(pathOf(r));
      if (!online) throw new TypeError('offline');
      const body = routes[pathOf(r)];
      return body === 404 ? resp('gone', 404) : resp(body !== undefined ? body : 'network:' + pathOf(r));
    },
    Request: class { constructor(u) { this.url = new URL(u, ORIGIN).href; } },
    Date,
    Response: class { constructor(body, init) { this.body = body; this.status = (init && init.status) || 200; } },
    URL, Set, Promise, JSON, console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'sw.js'), 'utf8'), sandbox);
  const fire = async (type, data) => {
    let responded = null;
    const waits = [];
    listeners[type](Object.assign({ waitUntil: (p) => { waits.push(p); }, respondWith: (p) => { responded = p; } }, data || {}));
    const out = responded ? await responded : null;
    await Promise.all(waits);
    await new Promise((r) => setTimeout(r, 0));
    await Promise.all(waits);
    return out;
  };
  return { fire, store, fetched, routes, set online(v) { online = v; } };
}

describe('generated sw.js', () => {
  test('precaches the shell on install and never stores other API responses', async () => {
    const dir = fixture();
    const { version, files } = buildServiceWorker(dir);
    assert.match(version, /^[0-9a-f]{12}$/);
    assert.ok(files.includes('/index.html') && files.includes('/assets/index-abc.js'));
    assert.ok(!files.some((f) => f.endsWith('.map') || f === '/sw.js'));
    // The boot graph is precached; the lazy route chunk is not.
    assert.ok(files.includes('/assets/index-abc.css'));
    assert.ok(!files.includes('/assets/About-lazy.js'), 'lazy chunks are fetched on demand');
    const w = loadWorker(dir, { online: true });
    await w.fire('install');
    await w.fire('activate');
    const [name] = Array.from(w.store.keys());
    assert.equal(name, 'rg-shell-' + version);
    assert.deepEqual(Array.from(w.store.get(name).keys()).sort(), files);
    // API calls are not intercepted at all, so nothing can be cached.
    const api = await w.fire('fetch', { request: { method: 'GET', url: ORIGIN + '/api/me', mode: 'cors' } });
    assert.equal(api, null);
    const other = await w.fire('fetch', { request: { method: 'GET', url: ORIGIN + '/api/uploads/messages/1/a.webp', mode: 'no-cors' } });
    assert.equal(other, null);
    assert.deepEqual(Array.from(w.store.get(name).keys()).sort(), files, 'cache unchanged');
    // Shell from cache; navigations from the network while online.
    assert.equal((await w.fire('fetch', { request: { method: 'GET', url: ORIGIN + '/assets/index-abc.js', mode: 'cors' } })).body, 'cached:/assets/index-abc.js');
    assert.equal((await w.fire('fetch', { request: { method: 'GET', url: ORIGIN + '/saved', mode: 'navigate' } })).body, 'network:/saved');
    // Offline: navigations get the cached shell.
    w.online = false;
    assert.equal((await w.fire('fetch', { request: { method: 'GET', url: ORIGIN + '/post/3', mode: 'navigate' } })).body, 'cached:/index.html');
  });

  test('remembers recently viewed sales and their photos for offline, forgets gone ones, clears on sign-out', async () => {
    const dir = fixture();
    buildServiceWorker(dir);
    const w = loadWorker(dir, { online: true });
    await w.fire('install');
    await w.fire('activate');
    const get = (p) => w.fire('fetch', { request: { method: 'GET', url: ORIGIN + p, mode: 'cors' } });
    w.routes['/api/post/7'] = JSON.stringify({ id: 7, title: 'Lamps', photos: [{ url: '/api/uploads/posts/7/a.webp', thumbUrl: '/api/uploads/posts/7/a-t.webp' }] });
    const online = await get('/api/post/7');
    assert.equal(JSON.parse(online.body).offlineSavedAt, undefined, 'online answers come straight from the network');
    assert.ok(w.store.get('rg-recent-photos').has('/api/uploads/posts/7/a-t.webp'));
    w.online = false;
    const saved = JSON.parse((await get('/api/post/7')).body);
    assert.equal(saved.title, 'Lamps');
    assert.match(saved.offlineSavedAt, /^\d{4}-\d\d-\d\dT/);
    assert.equal((await get('/api/uploads/posts/7/a.webp')).body, 'network:/api/uploads/posts/7/a.webp');
    await assert.rejects(get('/api/post/8'), /offline/, 'never-viewed sales still fail offline');
    await assert.rejects(get('/api/me').then((r) => { if (!r) throw new Error('offline bypass'); }), /offline bypass/);
    // Online again: a deleted sale is forgotten with its photos.
    w.online = true;
    w.routes['/api/post/7'] = 404;
    assert.equal((await get('/api/post/7')).status, 404);
    assert.ok(!w.store.get('rg-recent-sales').has('/api/post/7'));
    assert.ok(!w.store.get('rg-recent-photos').has('/api/uploads/posts/7/a-t.webp'));
    // Only the newest 20 stay.
    for (let i = 100; i < 123; i++) { w.routes['/api/post/' + i] = JSON.stringify({ id: i, photos: [] }); await get('/api/post/' + i); }
    assert.equal(w.store.get('rg-recent-sales').size, RECENT_MAX);
    assert.ok(!w.store.get('rg-recent-sales').has('/api/post/100'));
    // Sign-out clears both caches; the shell stays.
    await w.fire('message', { data: { type: 'CLEAR_RECENT' } });
    assert.ok(!w.store.has('rg-recent-sales') && !w.store.has('rg-recent-photos'));
    assert.ok(Array.from(w.store.keys()).some((k) => k.indexOf('rg-shell-') === 0));
  });

  test('a new build gets a new cache and the old one is removed', async () => {
    const dir = fixture();
    const v1 = buildServiceWorker(dir).version;
    const w = loadWorker(dir, { online: true });
    await w.fire('install');
    await w.fire('activate');
    fs.writeFileSync(path.join(dir, 'assets', 'index-abc.css'), 'body{color:red}');
    const v2 = buildServiceWorker(dir).version;
    assert.notEqual(v1, v2);
    assert.equal(buildServiceWorker(dir).version, v2, 'stable for the same content');
    // Same sandbox store, new worker code.
    const w2 = loadWorker(dir, { online: true });
    for (const [k, v] of w.store) w2.store.set(k, v);
    await w2.fire('install');
    await w2.fire('activate');
    assert.deepEqual(Array.from(w2.store.keys()), ['rg-shell-' + v2]);
  });
});

describe('installability check', () => {
  test('passes for the real manifest, icons and index.html', () => {
    const dir = fixture();
    buildServiceWorker(dir);
    const failed = checkPwa(dir).filter((r) => !r.ok);
    assert.deepEqual(failed, []);
  });

  test('flags a broken manifest, missing icons and an unsafe precache', () => {
    const dir = fixture();
    buildServiceWorker(dir);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.webmanifest'), 'utf8'));
    m.display = 'browser'; delete m.display_override;
    m.icons = m.icons.filter((i) => i.sizes !== '512x512');
    fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), JSON.stringify(m));
    const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8').replace('"/index.html"', '"/index.html", "/api/me"');
    fs.writeFileSync(path.join(dir, 'sw.js'), sw);
    const failed = checkPwa(dir).filter((r) => !r.ok).map((r) => r.id).sort();
    assert.deepEqual(failed, ['display', 'icon-512', 'sw-no-private-precache', 'sw-precache-files'].sort());
  });

  test('the manifest lists real, correctly sized icons and in-scope shortcuts', () => {
    const m = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest'), 'utf8'));
    assert.equal(m.scope, '/');
    for (const s of m.shortcuts) assert.ok(s.url.startsWith('/'), s.url);
    for (const i of m.icons) assert.ok(fs.existsSync(path.join(root, 'public', i.src)), i.src);
  });
});
