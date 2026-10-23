// Route planner: the sales picked for a route (kept on this device, up to
// MAX_STOPS) and pure helpers for the /route form (see test/route-plan.test.js).
// The server (POST /route, lib/route.js) has the final say.

export const MAX_STOPS = 10;
export const DWELL = { min: 5, max: 120, default: 20 };
export const DWELL_CHOICES = [10, 15, 20, 30, 45, 60];
const KEY = 'rg-route';

let ids = null;
const listeners = new Set();
function storage() { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch (e) { return null; } }
function load() {
  if (ids) return ids;
  ids = [];
  const s = storage();
  try { const v = s && JSON.parse(s.getItem(KEY) || '[]'); if (Array.isArray(v)) ids = cleanIds(v); } catch (e) { ids = []; }
  return ids;
}
function save(next) {
  ids = cleanIds(next);
  const s = storage();
  try { if (s) s.setItem(KEY, JSON.stringify(ids)); } catch (e) { /* private mode */ }
  listeners.forEach((fn) => fn(ids));
  return ids;
}

// Unique positive integer ids, in order, at most MAX_STOPS.
export function cleanIds(list) {
  const out = [];
  (list || []).forEach((x) => { const n = Number(x); if (Number.isInteger(n) && n > 0 && out.indexOf(n) < 0) out.push(n); });
  return out.slice(0, MAX_STOPS);
}

export const picked = () => load().slice();
export const isPicked = (id) => load().indexOf(id) >= 0;
export const isFull = () => load().length >= MAX_STOPS;
export function add(id) { return isPicked(id) || isFull() ? load() : save(load().concat(id)); }
export function remove(id) { return save(load().filter((x) => x !== id)); }
export function toggle(id) { return isPicked(id) ? remove(id) : add(id); }
export function addMany(list) { return save(load().concat(list)); }
export function clear() { return save([]); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function resetForTests() { ids = null; listeners.clear(); }

// <input type="datetime-local"> value ("2026-10-24T10:00") for a Date, in local time.
export function localInputValue(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// Form -> { body } | { errors } (keys are i18n keys).
//   f: { ids, start: {lat,lng}|null, departAt: 'YYYY-MM-DDTHH:MM' | '', dwell }
export function routeBody(f, now) {
  const errors = {};
  const list = cleanIds(f.ids);
  if (!list.length) errors.ids = 'rt.needSales';
  let departAt;
  if (f.departAt) {
    const d = new Date(f.departAt);
    if (Number.isNaN(d.getTime())) errors.departAt = 'rt.badTime';
    else if (d.getTime() < (now || Date.now()) - 3600000) errors.departAt = 'rt.pastTime';
    else departAt = d.toISOString();
  }
  const dwell = Number(f.dwell === undefined || f.dwell === '' ? DWELL.default : f.dwell);
  if (!Number.isInteger(dwell) || dwell < DWELL.min || dwell > DWELL.max) errors.dwell = 'rt.badDwell';
  if (Object.keys(errors).length) return { errors };
  const body = { postIds: list, dwellMinutes: dwell };
  if (departAt) body.departAt = departAt;
  if (f.start) { body.lat = f.start.lat; body.lng = f.start.lng; }
  return { body };
}

// i18n key for why a sale isn't on the route.
export const SKIP_KEYS = { closed_by_then: 'rt.skipClosed', ended: 'rt.skipEnded', no_location: 'rt.skipNoLocation', too_many: 'rt.skipTooMany', unavailable: 'rt.skipUnavailable' };
export const skipKey = (reason) => SKIP_KEYS[reason] || 'rt.skipUnavailable';

// Minutes between two ISO times (rounded), for "45 min there".
export const minutesBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000);
