'use strict';
// Localized wording for printed flyers and alert emails: dates, times and
// prices through Intl, sentences from the catalog (lib/i18n.js).
// Mirrors rapidgarage-frontend/app/lib/flyerText.js (same keys and Intl
// options) so the on-screen flyer preview matches the PDF; keep them in sync.
// Dates are calendar dates in the sale's own time zone, so they are formatted
// as UTC midnight (no shifting); times are wall-clock "HH:MM" strings.
const i18n = require('./i18n');

const HEADLINES = {
  garage: 'flyer.headline.garage',
  yard: 'flyer.headline.yard',
  moving: 'flyer.headline.moving',
  estate: 'flyer.headline.estate',
};

const sp = (s) => s.replace(/[\u00a0\u2009\u202f]/g, ' ');
const utc = (date) => { const [y, m, d] = String(date).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (lang, opts, d) => sp(new Intl.DateTimeFormat(i18n.intlLocale(lang), Object.assign({ timeZone: 'UTC' }, opts)).format(d));

// "8 AM", "8:30 AM" / "8:00", "上午8:00"; compact drops spaces ("8AM").
function clock(lang, hhmm, compact) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  const opts = { hour: 'numeric' };
  if (m || lang === 'zh-CN') opts.minute = '2-digit';
  const s = fmt(lang, opts, new Date(Date.UTC(2000, 0, 1, h, m)));
  return compact ? s.replace(/\s+/g, '') : s;
}
const weekday = (lang, date) => fmt(lang, { weekday: 'short' }, utc(date));
const monthDay = (lang, date) => fmt(lang, { month: 'short', day: 'numeric' }, utc(date));
const upper = (lang, s) => s.toLocaleUpperCase(i18n.intlLocale(lang));

// days: [{ date: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM' }]
const dayLines = (lang, days) => days.map((d) => i18n.t(lang, 'flyer.dayLine',
  { wd: weekday(lang, d.date), md: monthDay(lang, d.date), start: clock(lang, d.start), end: clock(lang, d.end) }));

// Big-sign wording: "SAT & SUN" + "8AM–2PM" when the hours match, else one line per day.
function signLines(lang, days) {
  if (!days.length) return [];
  const same = days.every((d) => d.start === days[0].start && d.end === days[0].end);
  const hours = (d) => clock(lang, d.start, true) + '–' + clock(lang, d.end, true);
  if (same && days.length <= 3) return [upper(lang, days.map((d) => weekday(lang, d.date)).join(i18n.t(lang, 'flyer.join'))), hours(days[0])];
  return days.slice(0, 2).map((d) => upper(lang, i18n.t(lang, 'flyer.signDay', { wd: weekday(lang, d.date), md: monthDay(lang, d.date) }) + '  ' + hours(d)))
    .concat(days.length > 2 ? [upper(lang, i18n.t(lang, 'flyer.moreDays', { count: days.length - 2 }))] : []);
}

const usd = (lang, n, cents) => new Intl.NumberFormat(i18n.intlLocale(lang), { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 }).format(n);
const has = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));

// A post's whole-dollar price range: "Free", "$5", "$5–$50", "Up to $50", "From $5" or ''.
function priceIn(lang, post) {
  if (post.isFree) return i18n.t(lang, 'price.free');
  const min = has(post.priceMin) ? Number(post.priceMin) : null;
  const max = has(post.priceMax) ? Number(post.priceMax) : null;
  if (min !== null && max !== null) return min === max ? usd(lang, min) : i18n.t(lang, 'price.range', { min: usd(lang, min), max: usd(lang, max) });
  if (max !== null) return i18n.t(lang, 'price.upTo', { max: usd(lang, max) });
  if (min !== null) return i18n.t(lang, 'price.from', { min: usd(lang, min) });
  return '';
}
// An item's price in cents: "Free", "$5", "$2.50" or ''.
const centsIn = (lang, c) => (c === null || c === undefined ? '' : c === 0 ? i18n.t(lang, 'price.free') : usd(lang, c / 100, c % 100 !== 0));

module.exports = { HEADLINES, clock, weekday, monthDay, upper, dayLines, signLines, priceIn, centsIn };
