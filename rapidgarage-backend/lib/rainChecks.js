'use strict';
// Rain-check alerts. For each upcoming sale (days opening in the next
// RAIN_CHECK_DAYS, default 3), the Open-Meteo forecast (lib/weather.js) is
// checked; if storms, snow, heavy rain or strong wind are likely, the seller
// gets a bell notice (and a push, under their "reminders" switch) suggesting
// they postpone, plus a prompt on the sale page and the dashboard. When the
// seller postpones (POST /post/:id/postpone), everyone who saved the sale
// (favorites, including those with "Remind me" on) hears about the new date in
// the bell and by push. Weather problems never block anything: with no
// forecast there is simply no prompt.
const { Op } = require('sequelize');
const schedule = require('./schedule');
const weather = require('./weather');
const notifications = require('./notifications');

function models() { return require('../models'); }
function intEnv(name, dflt, min, max) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
}
const HOUR = 3600000;
const checkDays = () => intEnv('RAIN_CHECK_DAYS', 3, 1, 7);
const everyMinutes = () => intEnv('RAIN_CHECK_MINUTES', 60, 5, 1440);
const MAX_POSTS = 200;
const MAX_SHIFT_DAYS = 14;

let lastRun = 0;
function resetThrottle() { lastRun = 0; }

// Upcoming sale days within the check window, by post: Map(postId -> { post, days }).
async function upcoming(where, now) {
  const m = models();
  const t = now.getTime();
  const days = await m.SaleDay.findAll({
    where: { endsAt: { [Op.gt]: now }, startsAt: { [Op.lt]: new Date(t + checkDays() * 24 * HOUR) } },
    include: [{ model: m.Post, attributes: ['id', 'userId', 'title', 'hidden', 'lat', 'lng', 'timeZone', 'rainCheckDismissed'], where: Object.assign({ hidden: false, lat: { [Op.ne]: null } }, where) }],
    order: [['startsAt', 'ASC']], limit: MAX_POSTS * 3,
  });
  const by = new Map();
  days.forEach((d) => {
    if (!by.has(d.postId)) by.set(d.postId, { post: d.Post, days: [] });
    by.get(d.postId).days.push(d);
  });
  return by;
}

// The first bad day the seller hasn't dismissed: { date, reason, pop } | null.
function firstBad(w, post) {
  if (!w || !w.bad) return null;
  const d = w.days.find((x) => x.bad && x.date !== post.rainCheckDismissed);
  return d ? { date: d.date, reason: d.reason, pop: d.pop } : null;
}

// Worker pass (lib/alerts processQueue): tell sellers about bad forecasts.
async function processDue(now, opts) {
  now = now || schedule.now();
  const summary = { checked: 0, flagged: 0, created: 0 };
  if (!weather.enabled()) return Object.assign(summary, { off: true });
  if (!(opts && opts.force) && now.getTime() - lastRun < everyMinutes() * 60000) return Object.assign(summary, { skipped: true });
  lastRun = now.getTime();
  const by = await upcoming({}, now);
  for (const { post, days } of Array.from(by.values()).slice(0, MAX_POSTS)) {
    summary.checked++;
    const bad = firstBad(await weather.saleWeather(post, days, now), post);
    if (!bad) continue;
    summary.flagged++;
    const n = await notifications.add([{ userId: post.userId, kind: 'rain_check', postId: post.id, dedupeKey: 'rain:' + post.id + ':' + bad.date, data: bad }]);
    if (n) { summary.created += n; require('./push').rainCheck(post.userId, { title: post.title, postId: post.id }); }
  }
  return summary;
}

// The signed-in seller's sales with a bad forecast (dashboard prompt).
async function forSeller(userId, now) {
  now = now || schedule.now();
  if (!weather.enabled()) return [];
  const by = await upcoming({ userId }, now);
  const out = [];
  for (const { post, days } of by.values()) {
    const bad = firstBad(await weather.saleWeather(post, days, now), post);
    if (bad) out.push(Object.assign({ postId: post.id, title: post.title }, bad));
  }
  return out;
}

// New schedule for "postpone by N days": every upcoming day moves N days later
// (same hours); days already over are dropped.
function shiftedSchedule(post, saleDays, byDays, now) {
  const tz = post.timeZone || schedule.defaultTimeZone();
  const days = saleDays.filter((d) => new Date(d.endsAt) > now)
    .map((d) => ({ date: schedule.addDays(d.date, byDays), start: d.startTime, end: d.endTime }));
  return { timeZone: tz, days };
}

// After a postponement: tell everyone who saved the sale (not the seller, not
// across a block). Returns how many people were newly told.
async function notifyPostponed(post, fromDate, toDay) {
  const watchers = await require('./favorites').watchers(post);
  if (!watchers.length || !toDay) return 0;
  const data = { from: fromDate, date: toDay.date, start: toDay.startTime, end: toDay.endTime, timeZone: post.timeZone || schedule.defaultTimeZone() };
  const n = await notifications.add(watchers.map((userId) => ({ userId, kind: 'sale_postponed', postId: post.id, dedupeKey: 'postponed:' + post.id + ':' + toDay.date, data })));
  if (n) watchers.forEach((userId) => require('./push').salePostponed(userId, { title: post.title, postId: post.id }));
  return n;
}

module.exports = { checkDays, everyMinutes, MAX_SHIFT_DAYS, resetThrottle, processDue, forSeller, firstBad, shiftedSchedule, notifyPostponed };
