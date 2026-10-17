// node --test test/  (no browser needed)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { strategyFor, shellFiles } from '../pwa/sw-core.js';
import { buildServiceWorker } from '../pwa/vite-plugin.js';
import { checkPwa } from '../scripts/check-pwa.js';

const ORIGIN = 'https://rapidgarage.example';
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const ctx = { origin: ORIGIN, precache: new Set(['/index.html', '/assets/index-abc.js', '/icons/icon-192.png']) };
const req = (p, extra) => Object.assign({ method: 'GET', url: ORIGIN + p, mode: 'cors' }, extra);

describe('service worker routing', () => {
  test('never touches API, uploads, auth or the worker itself', () => {
    for (const p of ['/api/me', '/api/saved', '/api/conversations/1/messages', '/api/uploads/posts/1/a.webp', '/api', '/uploads/x.jpg', '/auth/google', '/sw.js', '/s/k7m3pq9x']) {
      assert.equal(strategyFor(req(p), ctx), 'bypass', p);
      assert.equal(strategyFor(req(p, { mode: 'navigate' }), ctx), 'bypass', p + ' (navigate)');
    }
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
  return dir;
}

// Run sw.js in a sandbox with fake caches/fetch; returns hooks to drive it.
function loadWorker(dir, { online }) {
  const listeners = {};
  const store = new Map(); // cacheName -> Map(path -> body)
  const fetched = [];
  const resp = (body, status) => ({ body, status: status || 200 });
  const pathOf = (r) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).pathname;
  const caches = {
    open: async (name) => {
      if (!store.has(name)) store.set(name, new Map());
      const c = store.get(name);
      return { addAll: async (reqs) => { for (const r of reqs) c.set(pathOf(r), 'cached:' + pathOf(r)); } };
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
    fetch: async (r) => { fetched.push(pathOf(r)); if (!online) throw new TypeError('offline'); return resp('network:' + pathOf(r)); },
    Request: class { constructor(u) { this.url = new URL(u, ORIGIN).href; } },
    Response: class { constructor(body, init) { this.body = body; this.status = (init && init.status) || 200; } },
    URL, Set, Promise, JSON, console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'sw.js'), 'utf8'), sandbox);
  const fire = async (type, data) => {
    let waited = Promise.resolve();
    let responded = null;
    listeners[type](Object.assign({ waitUntil: (p) => { waited = p; }, respondWith: (p) => { responded = p; } }, data || {}));
    await waited;
    return responded ? await responded : null;
  };
  return { fire, store, fetched, set online(v) { online = v; } };
}

describe('generated sw.js', () => {
  test('precaches the shell on install and never stores API responses', async () => {
    const dir = fixture();
    const { version, files } = buildServiceWorker(dir);
    assert.match(version, /^[0-9a-f]{12}$/);
    assert.ok(files.includes('/index.html') && files.includes('/assets/index-abc.js'));
    assert.ok(!files.some((f) => f.endsWith('.map') || f === '/sw.js'));
    const w = loadWorker(dir, { online: true });
    await w.fire('install');
    await w.fire('activate');
    const [name] = Array.from(w.store.keys());
    assert.equal(name, 'rg-shell-' + version);
    assert.deepEqual(Array.from(w.store.get(name).keys()).sort(), files);
    // API calls are not intercepted at all, so nothing can be cached.
    const api = await w.fire('fetch', { request: { method: 'GET', url: ORIGIN + '/api/me', mode: 'cors' } });
    assert.equal(api, null);
    const photo = await w.fire('fetch', { request: { method: 'GET', url: ORIGIN + '/api/uploads/posts/1/a.webp', mode: 'no-cors' } });
    assert.equal(photo, null);
    assert.deepEqual(Array.from(w.store.get(name).keys()).sort(), files, 'cache unchanged');
    // Shell from cache; navigations from the network while online.
    assert.equal((await w.fire('fetch', { request: { method: 'GET', url: ORIGIN + '/assets/index-abc.js', mode: 'cors' } })).body, 'cached:/assets/index-abc.js');
    assert.equal((await w.fire('fetch', { request: { method: 'GET', url: ORIGIN + '/saved', mode: 'navigate' } })).body, 'network:/saved');
    // Offline: navigations get the cached shell.
    w.online = false;
    assert.equal((await w.fire('fetch', { request: { method: 'GET', url: ORIGIN + '/post/3', mode: 'navigate' } })).body, 'cached:/index.html');
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
