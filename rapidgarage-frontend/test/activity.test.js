import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageFor, payload, track, trackPage, _reset, PAGES } from '../app/lib/activity.js';
import { funnelRows } from '../app/lib/dashboard.js';

test('pageFor maps routes to counted pages (never forms, admin or single items)', () => {
  assert.equal(pageFor('/', ''), 'home');
  assert.equal(pageFor('/', '?q=brooklyn'), 'search');
  assert.equal(pageFor('/', '?lat=1&lng=2'), 'search');
  assert.equal(pageFor('/favorites'), 'favorites');
  assert.equal(pageFor('/favorites/sellers'), 'favorites');
  assert.equal(pageFor('/saved'), 'favorites');
  assert.equal(pageFor('/route'), 'route');
  assert.equal(pageFor('/notifications/'), 'notifications');
  assert.equal(pageFor('/messages'), 'inbox');
  assert.equal(pageFor('/messages/12'), 'inbox');
  assert.equal(pageFor('/events'), 'events');
  assert.equal(pageFor('/wanted'), 'wanted');
  assert.equal(pageFor('/about'), 'about');
  assert.equal(pageFor('/safety'), 'safety');
  for (const p of ['/admin', '/login', '/newpost', '/post/3', '/events/4', '/wanted/new', '/settings', '/dashboard', '/nope']) assert.equal(pageFor(p), null, p);
  for (const p of ['/', '/favorites', '/route', '/notifications', '/messages', '/events', '/wanted', '/about', '/safety']) assert.ok(PAGES.includes(pageFor(p)));
});

test('payload carries only the kind and what it was about', () => {
  assert.deepEqual(payload('page', { page: 'map' }), { kind: 'page', page: 'map' });
  assert.deepEqual(payload('directions', { type: 'post', id: '12' }), { kind: 'directions', targetType: 'post', targetId: 12 });
  assert.deepEqual(payload('bell'), { kind: 'bell' });
});

function env(opts) {
  const calls = [];
  const nav = { onLine: opts.onLine !== false };
  if (opts.beacon) nav.sendBeacon = (url, blob) => { calls.push({ via: 'beacon', url, blob }); return opts.beacon === 'ok'; };
  return { calls, navigator: nav, fetch: (url, o) => { calls.push({ via: 'fetch', url, o }); return opts.reject ? Promise.reject(new Error('offline')) : Promise.resolve({}); } };
}

test('track uses sendBeacon (text/plain JSON), once per day per thing', async () => {
  _reset();
  const e = env({ beacon: 'ok' });
  assert.equal(track('directions', { type: 'post', id: 5 }, e), true);
  assert.equal(track('directions', { type: 'post', id: 5 }, e), false, 'not resent the same day');
  assert.equal(track('directions', { type: 'post', id: 6 }, e), true);
  assert.equal(e.calls.length, 2);
  assert.equal(e.calls[0].url, '/api/activity');
  assert.match(e.calls[0].blob.type, /^text\/plain/);
  assert.deepEqual(JSON.parse(await e.calls[0].blob.text()), { kind: 'directions', targetType: 'post', targetId: 5 });
});

test('track falls back to fetch keepalive and never throws; skips offline', async () => {
  _reset();
  const e = env({ beacon: 'fail', reject: true });
  assert.equal(trackPage('/route', '', e), true);
  assert.equal(e.calls[1].via, 'fetch');
  assert.equal(e.calls[1].o.keepalive, true);
  assert.equal(e.calls[1].o.method, 'POST');
  assert.equal(trackPage('/admin', '', e), false);
  const off = env({ beacon: 'ok', onLine: false });
  assert.equal(track('bell', null, off), false);
  assert.equal(off.calls.length, 0);
  const broken = { navigator: { onLine: true, sendBeacon: () => { throw new Error('boom'); } } };
  assert.equal(track('bell', null, broken), false);
  await new Promise((r) => setTimeout(r, 0)); // a rejected fetch is swallowed
});

test('funnelRows: share of views and bar widths', () => {
  const rows = funnelRows({ steps: [{ key: 'views', count: 200 }, { key: 'saves', count: 20 }, { key: 'messages', count: 5 }, { key: 'holds', count: 2 }, { key: 'sold', count: 3, of: 10 }] });
  assert.deepEqual(rows.map((r) => [r.key, r.pct, r.width]), [['views', null, 100], ['saves', 10, 10], ['messages', 3, 3], ['holds', 1, 2], ['sold', 2, 2]]);
  assert.equal(rows[4].of, 10);
  assert.equal(rows[0].of, null);
  const none = funnelRows({ steps: [{ key: 'views', count: 0 }, { key: 'saves', count: 0 }] });
  assert.deepEqual(none.map((r) => r.pct), [null, null]);
  assert.deepEqual(funnelRows(null), []);
});
