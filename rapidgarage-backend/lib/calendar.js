// "Add to calendar": .ics for a sale, a neighborhood sale, or a buyer's saved
// sales (lib/ics.js writes the format). One VEVENT per sale day.
//   UID       rapidgarage-post-<id>-<YYYY-MM-DD>@<host> (event-… for neighborhood
//             sales): stable, so re-importing updates instead of duplicating,
//             and the single-sale and saved-sales files agree.
//   SEQUENCE  the post's calendarSeq, bumped whenever something a calendar
//             shows changes (title, description, address, time zone, days).
//   Removed days stay in calendarDates and are written as STATUS:CANCELLED
//             with the bumped SEQUENCE, so calendars drop them.
//   LOCATION  exactly what the sale page shows publicly (lib/geo postAddress);
//             a neighborhood sale only has its public area label.
const ics = require('./ics');
const schedule = require('./schedule');
const { postAddress } = require('./geo');

const HISTORY_MAX = 60;
const DESCRIPTION_MAX = 600;
// Fields whose change bumps calendarSeq (Post / SaleEvent hooks). A post's
// days and time zone are compared in scheduleUpdate (saveSchedule) instead.
const POST_FIELDS = ['title', 'description', 'street', 'city', 'state', 'zipCode'];
const EVENT_FIELDS = ['name', 'description', 'areaLabel', 'timeZone', 'days'];

function baseUrl() { return require('./alerts').baseUrl(); }
function host() {
  try { return new URL(baseUrl()).hostname || 'rapidgarage'; } catch (e) { return 'rapidgarage'; }
}

const iso = (d) => new Date(d).toISOString();
const plainDay = (d, tz) => Object.assign({ date: d.date, startsAt: iso(d.startsAt), endsAt: iso(d.endsAt) }, tz ? { timeZone: tz } : {});

// calendarDates (JSON text) <-> [{ date, startsAt, endsAt }]
function readHistory(raw) {
  if (Array.isArray(raw)) return raw;
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v.filter((d) => d && d.date && d.startsAt && d.endsAt) : []; } catch (e) { return []; }
}
// Latest known window (and its time zone) per date, oldest dropped past HISTORY_MAX.
function mergeHistory(raw, days, tz) {
  const byDate = new Map(readHistory(raw).map((d) => [d.date, d]));
  (days || []).forEach((d) => byDate.set(d.date, plainDay(d, d.timeZone || tz)));
  return JSON.stringify(Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-HISTORY_MAX));
}
const signature = (days) => (days || []).map((d) => d.date + '@' + iso(d.startsAt) + '/' + iso(d.endsAt)).sort().join(',');

// Model hook: bump calendarSeq when a calendar-visible field changed.
function bumpOnChange(instance, fields) {
  if (instance.isNewRecord || instance.changed('calendarSeq')) return;
  if (fields.some((f) => instance.changed(f))) instance.set('calendarSeq', (instance.get('calendarSeq') || 0) + 1);
}

// Values to store with a schedule replacement (lib/schedule.saveSchedule).
// Days or time zone changed (and there were days before): bump SEQUENCE.
function scheduleUpdate(post, oldDays, newDays, newTz) {
  const oldTz = post.timeZone || schedule.defaultTimeZone();
  const tz = newTz || schedule.defaultTimeZone();
  const history = mergeHistory(mergeHistory(post.calendarDates, oldDays, oldTz), newDays, tz);
  const out = { calendarDates: history };
  const changed = signature(oldDays) !== signature(newDays) || oldTz !== tz;
  if ((oldDays || []).length && changed) out.calendarSeq = (post.calendarSeq || 0) + 1;
  return out;
}

function clip(s, n) { const t = String(s || '').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; }

function daysOf(post) {
  return (post.saleDays || []).map(plainDay).sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
}

// VEVENT data for one sale. opts.cancelled: include removed days (default true).
function postEvents(post, opts) {
  const o = opts || {};
  const tz = post.timeZone || schedule.defaultTimeZone();
  const url = baseUrl() + '/post/' + post.id;
  const location = post.street ? postAddress(post) : [post.city, post.state, post.zipCode].filter(Boolean).join(', ');
  const description = [clip(post.description, DESCRIPTION_MAX), url].filter(Boolean).join('\n\n');
  const current = daysOf(post);
  const live = new Set(current.map((d) => d.date));
  const base = { sequence: post.calendarSeq || 0, timeZone: tz, summary: post.title, description, location, url, lastModified: post.updatedAt };
  const out = current.map((d) => Object.assign({ uid: 'rapidgarage-post-' + post.id + '-' + d.date + '@' + host(), start: d.startsAt, end: d.endsAt }, base));
  if (o.cancelled !== false) {
    readHistory(post.calendarDates).filter((d) => !live.has(d.date)).forEach((d) => {
      out.push(Object.assign({ uid: 'rapidgarage-post-' + post.id + '-' + d.date + '@' + host(), start: d.startsAt, end: d.endsAt }, base, { status: 'CANCELLED', timeZone: d.timeZone || tz }));
    });
  }
  return out;
}

// VEVENT data for a neighborhood sale (its days are JSON on the row).
function eventEvents(ev, opts) {
  const o = opts || {};
  const tz = ev.timeZone || schedule.defaultTimeZone();
  const url = baseUrl() + '/events/' + ev.id;
  const description = [clip(ev.description, DESCRIPTION_MAX), url].filter(Boolean).join('\n\n');
  const current = (ev.days || []).map(plainDay);
  const live = new Set(current.map((d) => d.date));
  const base = { sequence: ev.calendarSeq || 0, timeZone: tz, summary: ev.name, description, location: ev.areaLabel, url, lastModified: ev.updatedAt };
  const out = current.map((d) => Object.assign({ uid: 'rapidgarage-event-' + ev.id + '-' + d.date + '@' + host(), start: d.startsAt, end: d.endsAt }, base));
  if (o.cancelled !== false) {
    readHistory(ev.calendarDates).filter((d) => !live.has(d.date)).forEach((d) => {
      out.push(Object.assign({ uid: 'rapidgarage-event-' + ev.id + '-' + d.date + '@' + host(), start: d.startsAt, end: d.endsAt }, base, { status: 'CANCELLED', timeZone: d.timeZone || tz }));
    });
  }
  return out;
}

// Safe ASCII file name: "moving-sale-2026-10-18.ics".
function fileName(title, fallback) {
  const slug = String(title || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 50);
  return (slug || fallback || 'sale') + '.ics';
}

function send(res, events, name, file) {
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="' + file + '"');
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.send(ics.calendar(events, { name, now: new Date() }));
}

module.exports = { postFields: POST_FIELDS, eventFields: EVENT_FIELDS, mergeHistory, readHistory, bumpOnChange, scheduleUpdate, postEvents, eventEvents, fileName, send, host };
