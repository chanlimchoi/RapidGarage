'use strict';
// Sale-day checklist: a seller's to-dos tied to the sale's first day. Opening
// it the first time creates the default list (flyers, pricing, signs, change,
// setup), which the seller edits freely: rename, change when each is due,
// add their own, delete, tick off.
//
// Reminders (bell + push "reminder" switch) go to the seller on each due day
// that still has open items: at CHECKLIST_REMINDER_HOUR (default 9) in the
// sale's time zone, or for sale-day items up to an hour before opening when
// the sale starts earlier than that. One per (sale, due date), listing the
// open items' count; dedupe via the bell row's unique key. Due dates are
// calendar days in the sale's time zone (schedule.addDays on YYYY-MM-DD), so
// DST changes never shift them. Off with Post.checklistRemind. Runs in the
// alert worker tick (lib/alerts processQueue) next to the other reminders.
const { Op } = require('sequelize');
const schedule = require('./schedule');
const notifications = require('./notifications');

function models() { return require('../models'); }

function intEnv(name, dflt, min, max) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
}
const reminderHour = () => intEnv('CHECKLIST_REMINDER_HOUR', 9, 5, 20);
const HOUR = 3600000;
const MAX_ITEMS = 30;
const LABEL_MAX = 120;
const DUE_MAX = 14;
// Default list: key (translated by the apps) and days before the sale.
const DEFAULTS = [
  { key: 'flyers', dueDays: 3 },
  { key: 'pricing', dueDays: 2 },
  { key: 'signs', dueDays: 1 },
  { key: 'change', dueDays: 1 },
  { key: 'setup', dueDays: 0 },
];
const KEYS = DEFAULTS.map((d) => d.key);
const dedupeKey = (postId, date) => 'checklist:' + postId + ':' + date;

// The sale's first day: { date (YYYY-MM-DD in its zone), startsAt (ms), timeZone } or null.
function firstDay(post) {
  const tz = post.timeZone || schedule.defaultTimeZone();
  const days = (post.saleDays || []).slice().sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  if (days.length) return { date: days[0].date, startsAt: new Date(days[0].startsAt).getTime(), timeZone: tz };
  if (!post.startDate) return null;
  const s = new Date(post.startDate);
  if (isNaN(s.getTime())) return null;
  return { date: schedule.localDate(s, tz), startsAt: s.getTime(), timeZone: tz };
}

const dueDate = (first, dueDays) => schedule.addDays(first.date, -dueDays);

// When the reminder for `date` (a due date) is sent: { sendAt, until } (ms).
function windowFor(first, date) {
  const hh = String(reminderHour()).padStart(2, '0') + ':00';
  let sendAt = schedule.zonedToUtc(date, hh, first.timeZone).getTime();
  const nextMidnight = schedule.zonedToUtc(schedule.addDays(date, 1), '00:00', first.timeZone).getTime();
  let until = nextMidnight;
  if (date === first.date) {
    // Sale day: before opening, at the latest an hour before.
    sendAt = Math.min(sendAt, first.startsAt - HOUR);
    until = Math.min(until, first.startsAt);
  }
  return { sendAt, until };
}

async function ensure(post) {
  const m = models();
  const have = await m.SaleChecklistItem.count({ where: { postId: post.id } });
  if (!have) await m.SaleChecklistItem.bulkCreate(DEFAULTS.map((d, i) => ({ postId: post.id, key: d.key, dueDays: d.dueDays, position: i })));
}

async function list(post) {
  const m = models();
  const rows = await m.SaleChecklistItem.findAll({ where: { postId: post.id }, order: [['dueDays', 'DESC'], ['position', 'ASC'], ['id', 'ASC']] });
  const first = firstDay(post);
  return {
    items: rows.map((r) => Object.assign(r.toJSON(), { dueDate: first ? dueDate(first, r.dueDays) : null })),
    saleDate: first ? first.date : null,
    timeZone: first ? first.timeZone : null,
    remind: post.checklistRemind !== false,
    reminderHour: reminderHour(),
    limits: { maxItems: MAX_ITEMS, labelMax: LABEL_MAX, dueMax: DUE_MAX },
  };
}

// body -> { values } | { errors }; partial for updates.
function validate(body, partial) {
  const errors = {};
  const values = {};
  if (!partial || body.label !== undefined) {
    const l = typeof body.label === 'string' ? body.label.trim().replace(/\s+/g, ' ') : '';
    if (!l) errors.label = 'Write what needs doing.';
    else if (l.length > LABEL_MAX) errors.label = 'Keep it to ' + LABEL_MAX + ' characters.';
    else values.label = l;
  }
  if (body.dueDays !== undefined || !partial) {
    const raw = body.dueDays === undefined ? 0 : body.dueDays;
    const n = typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw) : raw;
    if (!Number.isInteger(n) || n < 0 || n > DUE_MAX) errors.dueDays = 'Choose 0 to 14 days before the sale.';
    else values.dueDays = n;
  }
  if (partial && body.done !== undefined) {
    if (typeof body.done !== 'boolean') errors.done = 'done must be true or false.';
    else values.done = body.done;
  }
  return Object.keys(errors).length ? { errors } : { values };
}

// ---- reminders -----------------------------------------------------------
async function processDue(now) {
  const m = models();
  now = now || schedule.now();
  const t = now.getTime();
  const summary = { due: 0, created: 0 };
  // Sales not over yet with open items and reminders on.
  const open = await m.SaleChecklistItem.findAll({ where: { doneAt: null }, attributes: ['postId'], group: ['postId'], raw: true });
  if (!open.length) return summary;
  const posts = await m.Post.findAll({
    where: { id: open.map((r) => r.postId), hidden: false, checklistRemind: true, [Op.or]: [{ endDate: null }, { endDate: { [Op.gt]: now } }] },
    attributes: ['id', 'userId', 'title', 'timeZone', 'startDate', 'endDate'],
    include: [{ model: m.SaleDay, as: 'saleDays', attributes: ['date', 'startsAt'] }],
  });
  for (const post of posts) {
    const first = firstDay(post);
    if (!first || first.startsAt <= t) continue;
    const items = await m.SaleChecklistItem.findAll({ where: { postId: post.id, doneAt: null }, order: [['position', 'ASC'], ['id', 'ASC']] });
    const byDate = new Map();
    items.forEach((i) => { const d = dueDate(first, i.dueDays); if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push(i); });
    for (const [date, due] of byDate) {
      const w = windowFor(first, date);
      if (t < w.sendAt || t >= w.until) continue;
      summary.due++;
      const data = { date, saleDate: first.date, count: due.length, keys: due.map((i) => i.key).filter(Boolean).slice(0, 5), labels: due.filter((i) => !i.key).map((i) => i.label).slice(0, 3) };
      const n = await notifications.add([{ userId: post.userId, kind: 'checklist', postId: post.id, dedupeKey: dedupeKey(post.id, date), data }]);
      if (n) require('./push').checklistDue(post.userId, { title: post.title, postId: post.id, count: due.length });
      summary.created += n;
    }
  }
  return summary;
}

module.exports = { DEFAULTS, KEYS, MAX_ITEMS, LABEL_MAX, DUE_MAX, reminderHour, firstDay, dueDate, windowFor, ensure, list, validate, processDue, dedupeKey };
