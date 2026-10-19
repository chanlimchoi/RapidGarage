// Admin analytics: site-wide counts for the last 7, 30 or 90 days, with the
// previous period of the same length for comparison, daily series and a few
// top lists. Days are UTC calendar days. Everything is aggregate: no emails,
// no message text, sellers only as "First L.".
const { Op, fn, col, literal } = require('sequelize');
const schedule = require('./schedule');
const { publicName } = require('./people');

function models() { return require('../models'); }

const RANGES = [7, 30, 90];
const DAY = 86400000;

const isoDay = (d) => d.toISOString().slice(0, 10);

// The window: `days` UTC days ending today, and the same length before it.
function windowOf(days, now) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(today.getTime() - (days - 1) * DAY);
  const prevStart = new Date(start.getTime() - days * DAY);
  const end = new Date(today.getTime() + DAY); // exclusive
  const dates = [];
  for (let t = start.getTime(); t < end.getTime(); t += DAY) dates.push(isoDay(new Date(t)));
  return { start, end, prevStart, dates };
}

// { 'YYYY-MM-DD': n } -> [{ date, count }] over every day of the window.
const fill = (dates, byDay) => dates.map((date) => ({ date, count: Number(byDay[date] || 0) }));

// Rows created per UTC day for a model with createdAt (one GROUP BY query).
async function perDay(model, w, where) {
  const day = fn('date', col('createdAt'));
  const rows = await model.findAll({
    attributes: [[day, 'day'], [fn('count', col('id')), 'n']],
    where: Object.assign({ createdAt: { [Op.gte]: w.start, [Op.lt]: w.end } }, where || {}),
    group: [day],
    raw: true,
  });
  const out = {};
  // SQLite returns 'YYYY-MM-DD'; Postgres a Date or string.
  rows.forEach((r) => { out[(r.day instanceof Date ? isoDay(r.day) : String(r.day)).slice(0, 10)] = Number(r.n); });
  return out;
}

// Sum of a *Day table's counts per day (PostViewDay, PostScanDay, ...).
async function dayTable(model, w) {
  const rows = await model.findAll({
    attributes: ['day', [fn('sum', col('count')), 'n']],
    where: { day: { [Op.gte]: isoDay(w.prevStart), [Op.lt]: isoDay(w.end) } },
    group: ['day'],
    raw: true,
  });
  const out = {};
  rows.forEach((r) => { out[String(r.day).slice(0, 10)] = Number(r.n); });
  return out;
}

const sumDays = (byDay, from, to) => Object.keys(byDay).reduce((s, d) => (d >= from && d < to ? s + byDay[d] : s), 0);

async function countBetween(model, from, to, where) {
  return model.count({ where: Object.assign({ createdAt: { [Op.gte]: from, [Op.lt]: to } }, where || {}) });
}

// One metric: this period's total, the previous period's, and the daily series.
async function createdMetric(model, w, where) {
  const [byDay, previous] = await Promise.all([perDay(model, w, where), countBetween(model, w.prevStart, w.start, where)]);
  const series = fill(w.dates, byDay);
  return { total: series.reduce((s, d) => s + d.count, 0), previous, series };
}

function dayMetric(byDay, w) {
  const series = fill(w.dates, byDay);
  return { total: series.reduce((s, d) => s + d.count, 0), previous: sumDays(byDay, isoDay(w.prevStart), isoDay(w.start)), series };
}

async function summary(days, now) {
  const m = models();
  now = now || schedule.now();
  const w = windowOf(days, now);
  const live = { [Op.and]: [{ hidden: false }, schedule.notEndedWhere(now)] };
  const [signups, posts, messages, conversations, saves, views, scans, shares, users, activeSales, openReports, follows] = await Promise.all([
    createdMetric(m.User, w),
    createdMetric(m.Post, w),
    createdMetric(m.Message, w, { kind: 'text' }),
    createdMetric(m.Conversation, w),
    createdMetric(m.SavedPost, w),
    dayTable(m.PostViewDay, w).then((d) => dayMetric(d, w)),
    dayTable(m.PostScanDay, w).then((d) => dayMetric(d, w)),
    dayTable(m.PostShareDay, w).then((d) => dayMetric(d, w)),
    m.User.count(),
    m.Post.count({ where: live }),
    m.Report.count({ where: { status: 'open' } }),
    m.Follow ? createdMetric(m.Follow, w) : null,
  ]);

  // Where the current sales are.
  const cities = await m.Post.findAll({
    attributes: ['city', 'state', [fn('count', col('id')), 'n']],
    where: { [Op.and]: [live, { city: { [Op.ne]: null } }, { city: { [Op.ne]: '' } }] },
    group: ['city', 'state'],
    order: [[literal('n'), 'DESC'], ['city', 'ASC']],
    limit: 8,
    raw: true,
  });

  // Most-viewed sales in the period.
  const topViews = await m.PostViewDay.findAll({
    attributes: ['postId', [fn('sum', col('count')), 'n']],
    where: { day: { [Op.gte]: isoDay(w.start), [Op.lt]: isoDay(w.end) } },
    group: ['postId'],
    order: [[literal('n'), 'DESC']],
    limit: 5,
    raw: true,
  });
  const topPosts = topViews.length ? await m.Post.findAll({
    where: { id: topViews.map((r) => r.postId) },
    attributes: ['id', 'title', 'city', 'state', 'hidden'],
    include: [{ model: m.User, attributes: ['id', 'firstName', 'lastName'] }],
  }) : [];
  const byId = new Map(topPosts.map((p) => [p.id, p]));

  return {
    days,
    from: w.dates[0],
    to: w.dates[w.dates.length - 1],
    totals: { users, activeSales, openReports },
    metrics: Object.assign({ signups, posts, messages, conversations, saves, views, scans, shares }, follows ? { follows } : {}),
    topCities: cities.map((c) => ({ city: c.city, state: c.state || null, sales: Number(c.n) })),
    topSales: topViews.filter((r) => byId.has(r.postId)).map((r) => {
      const p = byId.get(r.postId);
      return { id: p.id, title: p.title, city: p.city || null, state: p.state || null, hidden: !!p.hidden, seller: publicName(p.User), views: Number(r.n) };
    }),
  };
}

module.exports = { RANGES, windowOf, summary };
