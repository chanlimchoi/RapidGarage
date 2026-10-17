// Display helpers shared by the listing, post and profile pages. Dates,
// numbers and relative times follow the current UI language (i18n).
import { t, intlLocale, formatNumber } from '../i18n';
export function formatMiles(d) {
  if (typeof d !== 'number') return null;
  const n = d < 10 ? new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(d) : formatNumber(Math.round(d));
  return t('units.mi', { n });
}

export function addressLine(post) {
  return [post.street, post.city, post.state, post.zipCode].filter(Boolean).join(', ');
}

export function placeLine(post) {
  const cityState = [post.city, post.state].filter(Boolean).join(', ');
  return [cityState, post.zipCode].filter(Boolean).join(' ');
}

const valid = (d) => d instanceof Date && !isNaN(d.getTime());

export function formatDay(value) {
  const d = new Date(value);
  if (!valid(d)) return '';
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(intlLocale(), opts);
}

export function formatTime(value) {
  const d = new Date(value);
  if (!valid(d)) return '';
  return d.toLocaleTimeString(intlLocale(), { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined });
}

export function timeAgo(value) {
  const d = new Date(value);
  if (!valid(d)) return '';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return t('time.justNow');
  let rtf = null;
  try { rtf = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto', style: 'short' }); } catch (e) { /* old browser */ }
  const rel = (n, unit) => (rtf ? rtf.format(-n, unit) : n + ' ' + unit);
  const min = Math.round(sec / 60);
  if (min < 60) return rel(min, 'minute');
  const hr = Math.round(min / 60);
  if (hr < 24) return rel(hr, 'hour');
  const day = Math.round(hr / 24);
  if (day < 7) return rel(day, 'day');
  return d.toLocaleDateString(intlLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
}

export function initials(user) {
  if (!user) return '?';
  const s = ((user.firstName || '').charAt(0) + (user.lastName || '').charAt(0)) || (user.email || '?').charAt(0);
  return s.toUpperCase();
}

export function displayName(user) {
  if (!user) return '';
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
}
