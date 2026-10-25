// Fire-and-forget usage counters (backend: POST /api/activity, lib/activity.js).
//
// Only the kind of action and what it was about are sent -- e.g. "directions
// for sale 12" or "page: map". The server counts each visitor once per day
// without storing who they are. Beacons never block, never throw and are
// skipped offline (the service worker never caches /api anyway).

// Pages the server knows (lib/activity.js PAGES).
export const PAGES = ['home', 'search', 'map', 'favorites', 'route', 'notifications', 'inbox', 'events', 'wanted', 'about', 'safety'];

// Which counted page a route is, or null for pages we don't count (admin,
// forms, sign-in, single sales/events/wanted posts which count views).
export function pageFor(pathname, search) {
  const p = String(pathname || '/').replace(/\/+$/, '') || '/';
  if (p === '/') return /[?&](q|lat|lng|address|zip)=/.test(String(search || '')) ? 'search' : 'home';
  if (p === '/favorites' || p === '/saved' || p === '/favorites/sellers' || p === '/following') return 'favorites';
  if (p === '/route') return 'route';
  if (p === '/notifications') return 'notifications';
  if (p === '/messages' || /^\/messages\/[^/]+$/.test(p)) return 'inbox';
  if (p === '/events') return 'events';
  if (p === '/wanted') return 'wanted';
  if (p === '/about') return 'about';
  if (p === '/safety') return 'safety';
  return null;
}

// The JSON body for a beacon.
export function payload(kind, target) {
  const body = { kind };
  if (target && target.page) body.page = target.page;
  if (target && target.type) { body.targetType = target.type; body.targetId = Number(target.id); }
  return body;
}

let sent = new Set();
let sentDay = '';
const today = () => new Date().toDateString();

// For tests.
export function _reset() { sent = new Set(); sentDay = ''; }

// track('directions', { type: 'post', id: 12 }); track('page', { page: 'map' }).
// Repeats in the same day are not resent (the server would ignore them).
export function track(kind, target, env) {
  try {
    const nav = (env && env.navigator) || (typeof navigator !== 'undefined' ? navigator : null);
    if (nav && nav.onLine === false) return false;
    const body = payload(kind, target);
    const key = JSON.stringify(body);
    const d = today();
    if (d !== sentDay) { sent = new Set(); sentDay = d; }
    if (sent.has(key)) return false;
    sent.add(key);
    const json = JSON.stringify(body);
    const url = '/api/activity';
    if (nav && typeof nav.sendBeacon === 'function' && typeof Blob !== 'undefined') {
      if (nav.sendBeacon(url, new Blob([json], { type: 'text/plain;charset=UTF-8' }))) return true;
    }
    const f = (env && env.fetch) || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return false;
    const r = f(url, { method: 'POST', body: json, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', keepalive: true });
    if (r && typeof r.catch === 'function') r.catch(() => null);
    return true;
  } catch (e) {
    return false;
  }
}

export function trackPage(pathname, search, env) {
  const page = pageFor(pathname, search);
  return page ? track('page', { page }, env) : false;
}
