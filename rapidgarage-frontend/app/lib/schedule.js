// Client helpers for sale days (mirrors rapidgarage-backend/lib/schedule.js).
// Day rows carry the sale's local date and times as strings, so they are shown
// exactly as the seller typed them; instants (startsAt/endsAt) decide status.
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
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
}
const utcDay = (dateStr) => { const m = DATE_RE.exec(dateStr); return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))); };

// "8 AM", "2:30 PM" from "HH:MM".
export function timeLabel(hhmm) {
  const m = TIME_RE.exec(hhmm || '');
  if (!m) return '';
  const h = Number(m[1]);
  const mm = Number(m[2]);
  const h12 = h % 12 || 12;
  return h12 + (mm ? ':' + m[2] : '') + ' ' + (h < 12 ? 'AM' : 'PM');
}
// "Sat, Oct 24" (+ year when not this year).
export function dayLabel(dateStr, now) {
  if (!DATE_RE.test(dateStr || '')) return '';
  const d = utcDay(dateStr);
  const opts = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' };
  if (d.getUTCFullYear() !== (now || new Date()).getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}
const weekdayShort = (dateStr) => utcDay(dateStr).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

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
  const t = (now || new Date()).getTime();
  const days = saleDays(post);
  if (!days.length) return null;
  const open = days.find((d) => d.startsAt <= t && t < d.endsAt);
  if (open) return { kind: 'open', label: open.end ? 'Open now · until ' + timeLabel(open.end) : 'Open now' };
  const next = days.filter((d) => d.startsAt > t).sort((a, b) => a.startsAt - b.startsAt)[0];
  if (!next) return { kind: 'ended', label: 'Ended' };
  const today = dateIn(new Date(t), zoneOf(post));
  const near = next.date === today ? 'today' : next.date === addDays(today, 1) ? 'tomorrow'
    : next.startsAt - t < 6 * 86400000 ? weekdayShort(next.date) : null;
  return { kind: 'upcoming', label: near ? 'Starts ' + near + ' ' + timeLabel(next.start) : 'Starts ' + dayLabel(next.date, now) + ' · ' + timeLabel(next.start) };
}

// One line per day: "Sat, Oct 24 · 8 AM – 2:30 PM".
export function dayLines(post, now) {
  return saleDays(post).map((d) => {
    if (d.legacy && !d.end) return dayLabel(d.date, now) + ' ' + timeLabel(d.start) + ' – ' + dayLabel(d.endDate, now);
    return dayLabel(d.date, now) + ' · ' + timeLabel(d.start) + ' – ' + timeLabel(d.end);
  });
}

// Short card text: first upcoming (or open) day, plus "+N more".
export function shortWhen(post, now) {
  const t = (now || new Date()).getTime();
  const days = saleDays(post);
  if (!days.length) return null;
  const lines = dayLines(post, now);
  let i = days.findIndex((d) => d.endsAt > t);
  if (i === -1) i = days.length - 1;
  const rest = days.length - 1;
  return lines[i] + (rest > 0 ? ' +' + rest + ' more day' + (rest === 1 ? '' : 's') : '');
}

// Shown when the sale's zone differs from the viewer's.
export function zoneNote(post) {
  const tz = zoneOf(post);
  if (!tz || tz === browserTimeZone()) return null;
  let name = tz.replace(/_/g, ' ');
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName');
    if (p) name = p.value;
  } catch (e) { /* keep id */ }
  return 'Times are local to the sale (' + name + ').';
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
  if (days.length > MAX_DAYS) errors.schedule = 'Add at most ' + MAX_DAYS + ' days.';
  days.forEach((d, i) => {
    const key = 'days.' + i;
    if (!DATE_RE.test(d.date || '')) errors[key] = 'Pick a date.';
    else if (!TIME_RE.test(d.start || '')) errors[key] = 'Pick a start time.';
    else if (!TIME_RE.test(d.end || '')) errors[key] = 'Pick an end time.';
    else if (d.end <= d.start) errors[key] = 'End time must be after the start time. For overnight sales, add another day.';
    else if (seen[d.date]) errors[key] = 'That date is already listed.';
    seen[d.date] = true;
  });
  return errors;
}

export const WHEN_FILTERS = [
  { value: '', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'weekend', label: 'This weekend' },
  { value: 'now', label: 'Open now' },
];
