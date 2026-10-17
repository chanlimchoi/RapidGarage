// Client helpers for sale days (mirrors rapidgarage-backend/lib/schedule.js).
// Day rows carry the sale's local date and times as strings, so they are shown
// exactly as the seller typed them; instants (startsAt/endsAt) decide status.
// Labels are written in the current UI language (i18n).
import { t, intlLocale, locale } from '../i18n';
export const MAX_DAYS = 14;
const LEGACY_HOURS = 12;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; } catch (e) { return 'America/New_York'; }
}

const pad = (n) => String(n).padStart(2, '0');

// "YYYY-MM-DD" for `date` in `tz` (browser zone when tz is missing/invalid).
export function dateIn(date, tz) {
  try {
    const parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
    return parts.year + '-' + parts.month + '-' + parts.day;
  } catch (e) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }
}
export function timeIn(date, tz) {
  try {
    const parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })
      .formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
    return pad(Number(parts.hour) % 24) + ':' + parts.minute;
  } catch (e) {
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
  }
}

export function addDays(dateStr, n) {
  const m = DATE_RE.exec(dateStr);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}
const utcDay = (dateStr) => { const m = DATE_RE.exec(dateStr); return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))); };

// "8 AM", "2:30 PM" from "HH:MM".
export function timeLabel(hhmm) {
  const m = TIME_RE.exec(hhmm || '');
  if (!m) return '';
  const h = Number(m[1]);
  const mm = Number(m[2]);
  const at = new Date(Date.UTC(2000, 0, 1, h, mm));
  // Chinese reads better as 上午8:00 than 8时, so it always shows minutes.
  const opts = locale() === 'zh-CN' ? { hour: 'numeric', minute: '2-digit', hour12: true } : { hour: 'numeric', minute: mm ? '2-digit' : undefined };
  try { return new Intl.DateTimeFormat(intlLocale(), Object.assign({ timeZone: 'UTC' }, opts)).format(at); } catch (e) { /* fall back */ }
  const h12 = h % 12 || 12;
  return h12 + (mm ? ':' + m[2] : '') + ' ' + (h < 12 ? 'AM' : 'PM');
}
// "Sat, Oct 24" (+ year when not this year).
export function dayLabel(dateStr, now) {
  if (!DATE_RE.test(dateStr || '')) return '';
  const d = utcDay(dateStr);
  const opts = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' };
  if (d.getUTCFullYear() !== (now || new Date()).getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(intlLocale(), opts);
}
const weekdayShort = (dateStr) => utcDay(dateStr).toLocaleDateString(intlLocale(), { weekday: 'short', timeZone: 'UTC' });

// Days as [{ date, start, end, startsAt(ms), endsAt(ms) }], from the schedule or
// the legacy startDate/endDate pair (shown in the viewer's zone).
export function saleDays(post) {
  if (post && post.schedule && Array.isArray(post.schedule.days) && post.schedule.days.length) {
    return post.schedule.days.map((d) => ({ date: d.date, start: d.start, end: d.end, startsAt: new Date(d.startsAt).getTime(), endsAt: new Date(d.endsAt).getTime() }));
  }
  if (!post || !post.startDate) return [];
  const s = new Date(post.startDate);
  if (isNaN(s.getTime())) return [];
  const e = post.endDate ? new Date(post.endDate) : new Date(s.getTime() + LEGACY_HOURS * 3600000);
  return [{ date: dateIn(s), start: timeIn(s), end: dateIn(e) === dateIn(s) ? timeIn(e) : null, endDate: dateIn(e), startsAt: s.getTime(), endsAt: e.getTime(), legacy: true }];
}

const zoneOf = (post) => (post && post.schedule && post.schedule.timeZone) || null;

// { kind: 'open'|'upcoming'|'ended', label } or null when the sale has no dates.
export function saleBadge(post, now) {
  const nowMs = (now || new Date()).getTime();
  const days = saleDays(post);
  if (!days.length) return null;
  const open = days.find((d) => d.startsAt <= nowMs && nowMs < d.endsAt);
  if (open) return { kind: 'open', label: open.end ? t('sched.openUntil', { time: timeLabel(open.end) }) : t('sched.openNow') };
  const next = days.filter((d) => d.startsAt > nowMs).sort((a, b) => a.startsAt - b.startsAt)[0];
  if (!next) return { kind: 'ended', label: t('sched.ended') };
  const today = dateIn(new Date(nowMs), zoneOf(post));
  const time = timeLabel(next.start);
  let label;
  if (next.date === today) label = t('sched.startsToday', { time });
  else if (next.date === addDays(today, 1)) label = t('sched.startsTomorrow', { time });
  else if (next.startsAt - nowMs < 6 * 86400000) label = t('sched.startsWeekday', { day: weekdayShort(next.date), time });
  else label = t('sched.startsDate', { date: dayLabel(next.date, now), time });
  return { kind: 'upcoming', label };
}

// One line per day: "Sat, Oct 24 · 8 AM – 2:30 PM".
export function dayLines(post, now) {
  return saleDays(post).map((d) => {
    if (d.legacy && !d.end) return t('sched.legacyLine', { day: dayLabel(d.date, now), start: timeLabel(d.start), endDay: dayLabel(d.endDate, now) });
    return t('sched.dayLine', { day: dayLabel(d.date, now), start: timeLabel(d.start), end: timeLabel(d.end) });
  });
}

// Short card text: first upcoming (or open) day, plus "+N more".
export function shortWhen(post, now) {
  const nowMs = (now || new Date()).getTime();
  const days = saleDays(post);
  if (!days.length) return null;
  const lines = dayLines(post, now);
  let i = days.findIndex((d) => d.endsAt > nowMs);
  if (i === -1) i = days.length - 1;
  const rest = days.length - 1;
  return lines[i] + (rest > 0 ? ' ' + t('sched.moreDays', { count: rest }) : '');
}

// Shown when the sale's zone differs from the viewer's.
export function zoneNote(post) {
  const tz = zoneOf(post);
  if (!tz || tz === browserTimeZone()) return null;
  let name = tz.replace(/_/g, ' ');
  try {
    const p = new Intl.DateTimeFormat(intlLocale(), { timeZone: tz, timeZoneName: 'long' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName');
    if (p) name = p.value;
  } catch (e) { /* keep id */ }
  return t('sched.zoneNote', { zone: name });
}

// ---- form ----------------------------------------------------------------
export function nextSaturday(now) {
  const today = dateIn(now || new Date());
  const wd = utcDay(today).getUTCDay();
  return addDays(today, wd === 6 ? 0 : 6 - wd);
}

// Rows for the editor from a post (or none for a new sale).
export function formDays(post) {
  return saleDays(post).map((d) => ({ date: d.date, start: d.start || '08:00', end: d.end || '17:00' }));
}

// Per-row errors keyed "days.i" plus "schedule".
export function validateDays(days) {
  const errors = {};
  const seen = {};
  if (days.length > MAX_DAYS) errors.schedule = t('sched.errMaxDays', { max: MAX_DAYS });
  days.forEach((d, i) => {
    const key = 'days.' + i;
    if (!DATE_RE.test(d.date || '')) errors[key] = t('sched.errDate');
    else if (!TIME_RE.test(d.start || '')) errors[key] = t('sched.errStart');
    else if (!TIME_RE.test(d.end || '')) errors[key] = t('sched.errEnd');
    else if (d.end <= d.start) errors[key] = t('sched.errOrder');
    else if (seen[d.date]) errors[key] = t('sched.errDup');
    seen[d.date] = true;
  });
  return errors;
}

export const WHEN_FILTERS = [
  { value: '', labelKey: 'when.any' },
  { value: 'today', labelKey: 'when.today' },
  { value: 'weekend', labelKey: 'when.weekend' },
  { value: 'now', labelKey: 'when.now' },
];
