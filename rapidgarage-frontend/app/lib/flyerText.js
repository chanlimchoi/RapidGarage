// Printed-flyer wording in a given language. Mirrors flyerData() in
// rapidgarage-backend/lib/flyer.js (same keys, same Intl options), so the
// on-screen preview matches the PDF. Paper outlives the day: no "Today".
import { tIn, intlLocale } from '../i18n';
import { saleDays } from './schedule';

// Headline choice -> catalog key (literal keys so the i18n test can see them).
export const HEADLINES = {
  garage: 'flyer.headline.garage',
  yard: 'flyer.headline.yard',
  moving: 'flyer.headline.moving',
  estate: 'flyer.headline.estate',
};
export const HEADLINE_KEYS = Object.keys(HEADLINES);
const sp = (s) => s.replace(/[\u00a0\u2009\u202f]/g, ' ');
const utc = (date) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (lang, opts, d) => sp(new Intl.DateTimeFormat(intlLocale(lang), Object.assign({ timeZone: 'UTC' }, opts)).format(d));

export function clock(lang, hhmm, compact) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  const opts = { hour: 'numeric' };
  if (m || lang === 'zh-CN') opts.minute = '2-digit';
  const s = fmt(lang, opts, new Date(Date.UTC(2000, 0, 1, h, m)));
  return compact ? s.replace(/\s+/g, '') : s;
}
const wd = (lang, date) => fmt(lang, { weekday: 'short' }, utc(date));
const md = (lang, date) => fmt(lang, { month: 'short', day: 'numeric' }, utc(date));
const upper = (lang, s) => s.toLocaleUpperCase(intlLocale(lang));

function upcoming(post) {
  const all = saleDays(post).filter((d) => d.end);
  const live = all.filter((d) => d.endsAt > Date.now());
  return live.length ? live : all;
}

export const flyerLines = (lang, post) => upcoming(post).map((d) => tIn(lang, 'flyer.dayLine',
  { wd: wd(lang, d.date), md: md(lang, d.date), start: clock(lang, d.start), end: clock(lang, d.end) }));

export function signLines(lang, post) {
  const days = upcoming(post);
  if (!days.length) return [];
  const same = days.every((d) => d.start === days[0].start && d.end === days[0].end);
  const hours = (d) => clock(lang, d.start, true) + '–' + clock(lang, d.end, true);
  if (same && days.length <= 3) return [upper(lang, days.map((d) => wd(lang, d.date)).join(tIn(lang, 'flyer.join'))), hours(days[0])];
  return days.slice(0, 2).map((d) => upper(lang, tIn(lang, 'flyer.signDay', { wd: wd(lang, d.date), md: md(lang, d.date) }) + '  ' + hours(d)))
    .concat(days.length > 2 ? [upper(lang, tIn(lang, 'flyer.moreDays', { count: days.length - 2 }))] : []);
}

const usd = (lang, n, cents) => new Intl.NumberFormat(intlLocale(lang), { style: 'currency', currency: 'USD', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 }).format(n);
const has = (v) => typeof v === 'number' && Number.isFinite(v);
export function priceIn(lang, post) {
  if (post.isFree) return tIn(lang, 'price.free');
  const min = has(post.priceMin) ? post.priceMin : null;
  const max = has(post.priceMax) ? post.priceMax : null;
  if (min !== null && max !== null) return min === max ? usd(lang, min) : tIn(lang, 'price.range', { min: usd(lang, min), max: usd(lang, max) });
  if (max !== null) return tIn(lang, 'price.upTo', { max: usd(lang, max) });
  if (min !== null) return tIn(lang, 'price.from', { min: usd(lang, min) });
  return '';
}
export const centsIn = (lang, c) => (c == null ? '' : c === 0 ? tIn(lang, 'price.free') : usd(lang, c / 100, c % 100 !== 0));
