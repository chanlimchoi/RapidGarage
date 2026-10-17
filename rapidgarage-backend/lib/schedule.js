// Sale dates & times. A sale has zero or more days, each a local calendar
// date with a start and end time in the sale's IANA time zone (Post.timeZone).
// Instants (startsAt/endsAt, UTC) are computed on save so "ended", "open now",
// "today" and "this weekend" can be answered without guessing offsets later.
// Posts that only have the legacy startDate/endDate pair are treated as one
// window [startDate, endDate || startDate + 12h].
const { Op } = require('sequelize');

const MAX_DAYS = 14;
const MAX_DAYS_AHEAD = 366;
const LEGACY_HOURS = 12;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WHEN = ['today', 'weekend', 'now'];

let clock = () => new Date();
// Tests: freeze "now".
function setClock(fn) { clock = fn || (() => new Date()); }
const now = () => clock();

function defaultTimeZone() {
  const tz = String(process.env.DEFAULT_TIME_ZONE || '').trim();
  return tz && isValidTimeZone(tz) ? tz : 'America/New_York';
}

const fmtCache = new Map();
function partsFormatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    }));
  }
  return fmtCache.get(tz);
}

function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { partsFormatter(tz); return true; } catch (e) { return false; }
}

// Wall-clock parts of `instant` in `tz`.
function zonedParts(instant, tz) {
  const out = {};
  partsFormatter(tz).formatToParts(instant).forEach((p) => { out[p.type] = p.value; });
  return {
    year: Number(out.year), month: Number(out.month), day: Number(out.day),
    hour: Number(out.hour) % 24, minute: Number(out.minute), second: Number(out.second), weekday: out.weekday,
  };
}

// Offset of tz from UTC at `instant`, in ms (local wall clock minus UTC).
function offsetMs(instant, tz) {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

// Local date + time in tz -> UTC Date. Nonexistent times (spring-forward gap)
// move forward by the gap; ambiguous times (fall-back) use the first (earlier) one.
function zonedToUtc(dateStr, timeStr, tz) {
  const [, y, m, d] = DATE_RE.exec(dateStr).map(Number);
  const [, hh, mm] = TIME_RE.exec(timeStr).map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const o1 = offsetMs(new Date(wall), tz);
  let t = wall - o1;
  const o2 = offsetMs(new Date(t), tz);
  if (o2 !== o1) {
    const alt = wall - o2;
    // Prefer a candidate whose wall clock round-trips; else take the later one (gap).
    const ok = (c) => { const p = zonedParts(new Date(c), tz); return p.hour === hh && p.minute === mm; };
    t = ok(Math.min(t, alt)) ? Math.min(t, alt) : ok(Math.max(t, alt)) ? Math.max(t, alt) : Math.max(t, alt);
  }
  return new Date(t);
}

const pad = (n) => String(n).padStart(2, '0');
function localDate(instant, tz) {
  const p = zonedParts(instant, tz);
  return p.year + '-' + pad(p.month) + '-' + pad(p.day);
}
function localTime(instant, tz) {
  const p = zonedParts(instant, tz);
  return pad(p.hour) + ':' + pad(p.minute);
}
function addDays(dateStr, n) {
  const [, y, m, d] = DATE_RE.exec(dateStr).map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
}
function weekdayOf(dateStr) {
  const [, y, m, d] = DATE_RE.exec(dateStr).map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}
function isCalendarDate(s) {
  const m = typeof s === 'string' && DATE_RE.exec(s);
  if (!m) return false;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return t.getUTCFullYear() === Number(m[1]) && t.getUTCMonth() === Number(m[2]) - 1 && t.getUTCDate() === Number(m[3]);
}

// body.schedule = { timeZone, days: [{ date: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM' }] }
// Returns { errors, value } where value = { timeZone, days: [...with startsAt/endsAt], startDate, endDate }.
// creating=true rejects a schedule that has already completely ended.
function validateSchedule(raw, creating) {
  const errors = {};
  if (raw === null) return { errors, value: { timeZone: null, days: [], startDate: null, endDate: null } };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { errors: { schedule: 'Schedule must be an object with timeZone and days.' }, value: null };
  const tz = raw.timeZone === undefined || raw.timeZone === null || raw.timeZone === '' ? defaultTimeZone() : raw.timeZone;
  if (!isValidTimeZone(tz)) errors.timeZone = 'Unknown time zone.';
  const list = raw.days === undefined ? [] : raw.days;
  if (!Array.isArray(list)) errors.schedule = 'days must be a list.';
  else if (list.length > MAX_DAYS) errors.schedule = 'Add at most ' + MAX_DAYS + ' days.';
  if (Object.keys(errors).length) return { errors, value: null };
  const today = localDate(now(), tz);
  const seen = new Set();
  const days = [];
  list.forEach((d, i) => {
    const key = 'days.' + i;
    if (!d || typeof d !== 'object') { errors[key] = 'Each day needs a date, start and end time.'; return; }
    if (!isCalendarDate(d.date)) { errors[key] = 'Pick a valid date.'; return; }
    if (typeof d.start !== 'string' || !TIME_RE.test(d.start)) { errors[key] = 'Pick a start time.'; return; }
    if (typeof d.end !== 'string' || !TIME_RE.test(d.end)) { errors[key] = 'Pick an end time.'; return; }
    if (d.end <= d.start) { errors[key] = 'The end time must be after the start time (sales can\'t run past midnight; add another day).'; return; }
    if (seen.has(d.date)) { errors[key] = 'That date is listed twice.'; return; }
    if (d.date > addDays(today, MAX_DAYS_AHEAD)) { errors[key] = 'Pick a date within the next year.'; return; }
    seen.add(d.date);
    days.push({ date: d.date, startTime: d.start, endTime: d.end, startsAt: zonedToUtc(d.date, d.start, tz), endsAt: zonedToUtc(d.date, d.end, tz) });
  });
  if (Object.keys(errors).length) return { errors, value: null };
  days.sort((a, b) => a.startsAt - b.startsAt);
  if (creating && days.length && days[days.length - 1].endsAt <= now()) {
    return { errors: { schedule: 'Every day you picked is already over. Choose an upcoming date.' }, value: null };
  }
  return {
    errors,
    value: {
      timeZone: days.length ? tz : null, days,
      startDate: days.length ? days[0].startsAt : null,
      endDate: days.length ? days[days.length - 1].endsAt : null,
    },
  };
}

// ---- reading -------------------------------------------------------------
// Where-clause: sales that have not ended at `at`.
function notEndedWhere(at) {
  const t = at || now();
  return {
    [Op.or]: [
      { startDate: null, endDate: null },
      { endDate: { [Op.gt]: t } },
      { endDate: null, startDate: { [Op.gt]: new Date(t.getTime() - LEGACY_HOURS * 3600000) } },
    ],
  };
}

const ms = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

// Time windows of a post: [{ startsAt: ms, endsAt: ms }], from its days or the legacy pair.
function windowsOf(post) {
  const days = post.saleDays || [];
  if (days.length) return days.map((d) => ({ startsAt: ms(d.startsAt), endsAt: ms(d.endsAt) })).sort((a, b) => a.startsAt - b.startsAt);
  if (!post.startDate) return [];
  const s = ms(post.startDate);
  if (isNaN(s)) return [];
  const e = post.endDate ? ms(post.endDate) : s + LEGACY_HOURS * 3600000;
  return [{ startsAt: s, endsAt: e }];
}

function isEnded(post, at) {
  const w = windowsOf(post);
  if (!w.length) return false;
  return Math.max.apply(null, w.map((x) => x.endsAt)) <= ms(at || now());
}

// upcoming | open | ended | null (no dates)
function statusOf(post, at) {
  const t = ms(at || now());
  const w = windowsOf(post);
  if (!w.length) return null;
  if (w.some((x) => x.startsAt <= t && t < x.endsAt)) return 'open';
  if (w.some((x) => x.startsAt > t)) return 'upcoming';
  return 'ended';
}

// Does the post match when=today|weekend|now? Dates are the sale's local dates.
function matchesWhen(post, when, at) {
  if (!when) return true;
  const t = ms(at || now());
  const tz = post.timeZone && isValidTimeZone(post.timeZone) ? post.timeZone : defaultTimeZone();
  const live = windowsOf(post).filter((x) => x.endsAt > t);
  if (when === 'now') return live.some((x) => x.startsAt <= t);
  const today = localDate(new Date(t), tz);
  let first;
  let last;
  if (when === 'today') { first = today; last = today; } else {
    const wd = weekdayOf(today);
    if (wd === 6) { first = today; last = addDays(today, 1); } else if (wd === 0) { first = today; last = today; } else { first = addDays(today, 6 - wd); last = addDays(first, 1); }
  }
  return live.some((x) => {
    const s = localDate(new Date(x.startsAt), tz);
    const e = localDate(new Date(x.endsAt - 1), tz);
    return s <= last && e >= first;
  });
}

// JSON for clients: { timeZone, days: [{ date, start, end, startsAt, endsAt }] } or null.
function toJSON(post) {
  const days = (post.saleDays || []).slice().sort((a, b) => ms(a.startsAt) - ms(b.startsAt));
  if (!days.length) return null;
  return {
    timeZone: post.timeZone || defaultTimeZone(),
    days: days.map((d) => ({ date: d.date, start: d.startTime, end: d.endTime, startsAt: new Date(d.startsAt).toISOString(), endsAt: new Date(d.endsAt).toISOString() })),
  };
}

// Replace a post's days in one transaction (value from validateSchedule).
async function saveSchedule(models, post, value) {
  await models.sequelize.transaction(async (transaction) => {
    const old = await models.SaleDay.findAll({ where: { postId: post.id }, transaction });
    await models.SaleDay.destroy({ where: { postId: post.id }, transaction });
    if (value.days.length) {
      await models.SaleDay.bulkCreate(value.days.map((d) => Object.assign({ postId: post.id }, d)), { transaction });
    }
    // .ics: remember every day (removed ones become CANCELLED) and bump SEQUENCE on change.
    const cal = require('./calendar').scheduleUpdate(post, old, value.days, value.timeZone);
    await post.update(Object.assign({ timeZone: value.timeZone, startDate: value.startDate, endDate: value.endDate }, cal), { transaction });
  });
}

module.exports = {
  MAX_DAYS, WHEN, setClock, now, defaultTimeZone, isValidTimeZone, zonedToUtc, localDate, localTime, addDays, weekdayOf, offsetMs,
  validateSchedule, notEndedWhere, windowsOf, isEnded, statusOf, matchesWhen, toJSON, saveSchedule,
};

// Keep rows (plain { id, startDate, endDate, timeZone }) matching `when`;
// loads the rows' upcoming days in one query.
async function filterWhen(models, rows, when, at) {
  if (!when || !rows.length) return rows;
  const t = at || now();
  const days = await models.SaleDay.findAll({ where: { postId: rows.map((r) => r.id), endsAt: { [Op.gt]: t } }, attributes: ['postId', 'startsAt', 'endsAt'], raw: true });
  const byPost = new Map();
  days.forEach((d) => { if (!byPost.has(d.postId)) byPost.set(d.postId, []); byPost.get(d.postId).push(d); });
  return rows.filter((r) => {
    const saleDays = byPost.get(r.id);
    // Posts with days whose remaining days all ended have none here; legacy posts use startDate/endDate.
    const view = { timeZone: r.timeZone, startDate: r.startDate, endDate: r.endDate, saleDays: saleDays || (r.timeZone ? [] : undefined) };
    if (r.timeZone && !saleDays) return false;
    return matchesWhen(view, when, t);
  });
}

// Parse ?when=; returns { when } or { error }.
function parseWhen(v) {
  if (v === undefined || v === '' || v === 'any') return { when: null };
  if (WHEN.indexOf(v) === -1) return { error: 'when must be one of: ' + WHEN.join(', ') + '.' };
  return { when: v };
}

module.exports.filterWhen = filterWhen;
module.exports.parseWhen = parseWhen;
