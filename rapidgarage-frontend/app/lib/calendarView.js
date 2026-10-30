// "This weekend" calendar helpers (pure; tested in test/sale-calendar.test.js).
export const VIEWS = ['weekend', 'day', 'week'];
export const RADII = [5, 10, 25, 50];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n) => String(n).padStart(2, '0');

export function addDays(date, n) {
  const m = DATE_RE.exec(date);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

// Prev/next: a day in the day view, a week otherwise.
export function shift(view, date, dir) {
  return addDays(date, (view === 'day' ? 1 : 7) * (dir < 0 ? -1 : 1));
}

// URL query -> page state (bad values fall back to defaults).
export function fromQuery(search) {
  const q = new URLSearchParams(search || '');
  const view = VIEWS.includes(q.get('view')) ? q.get('view') : 'weekend';
  const date = DATE_RE.test(q.get('date') || '') ? q.get('date') : null;
  const radius = RADII.includes(Number(q.get('radius'))) ? Number(q.get('radius')) : 10;
  const alert = /^\d+$/.test(q.get('alert') || '') ? Number(q.get('alert')) : null;
  const zip = (q.get('q') || '').slice(0, 200);
  const near = q.get('near') === '1';
  const where = alert ? 'alert' : near ? 'near' : zip ? 'zip' : 'all';
  return { view, date, radius, alert, zip, where };
}

// Page state -> URL query (only what differs from the defaults).
export function toQuery(s) {
  const q = new URLSearchParams();
  if (s.view !== 'weekend') q.set('view', s.view);
  if (s.date) q.set('date', s.date);
  if (s.where === 'alert' && s.alert) q.set('alert', String(s.alert));
  if (s.where === 'zip' && s.zip) q.set('q', s.zip);
  if (s.where === 'near') q.set('near', '1');
  if ((s.where === 'zip' || s.where === 'near') && s.radius !== 10) q.set('radius', String(s.radius));
  const out = q.toString();
  return out ? '?' + out : '';
}

// Page state (+ coordinates for "near me") -> GET /calendar params.
export function apiParams(s, coords, tz) {
  const p = { view: s.view, tz };
  if (s.date) p.date = s.date;
  if (s.where === 'alert' && s.alert) p.alert = s.alert;
  else if (s.where === 'near' && coords) Object.assign(p, { lat: coords.lat, lng: coords.lng, radius: s.radius });
  else if (s.where === 'zip' && s.zip) Object.assign(p, { q: s.zip, radius: s.radius });
  return p;
}

export const totalSales = (data) => (data && data.days ? data.days.reduce((n, d) => n + d.sales.length, 0) : 0);
