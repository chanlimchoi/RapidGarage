'use strict';
// Seller dashboard: per-sale and overall numbers for the signed-in seller only.
//
//   views     sale page views per local day (lib/scans.js kind 'view')
//   scans     QR short-link scans per local day (PostScanDays)
//   saves     current saves, and new saves per day (SavedPosts.createdAt)
//   messages  buyer messages per day (text only, not removed, not the seller's)
//   conversations, unread, holds (pending / active), items sold vs total,
//   neighborhood sale membership.
//
// Days are each sale's local dates (its time zone), like scan counts; the
// overall series adds sales' counts by date. Nothing here identifies a visitor;
// saves are counts only (who saved a sale is never shown to its seller).
const { Op } = require('sequelize');
const schedule = require('./schedule');
const holds = require('./holds');
const msg = require('./messaging');
const events = require('./events');
const { publicName } = require('./people');

function models() { return require('../models'); }

const SPAN = 14;
const MAX_SALES = 200;
const METRICS = ['views', 'scans', 'saves', 'messages'];

const tzOf = (post) => (post.timeZone && schedule.isValidTimeZone(post.timeZone) ? post.timeZone : schedule.defaultTimeZone());
const dayStr = (v) => String(v).slice(0, 10);

// The last `span` local dates (oldest first) ending today in `tz`.
function dateRange(tz, span, at) {
  const today = schedule.localDate(at || schedule.now(), tz);
  const first = schedule.addDays(today, -(span - 1));
  const out = [];
  for (let i = 0; i < span; i++) out.push(schedule.addDays(first, i));
  return out;
}

function emptyStats(dates) {
  const s = { totals: {}, today: {}, series: {} };
  METRICS.forEach((k) => { s.totals[k] = 0; s.today[k] = 0; s.series[k] = new Map(dates.map((d) => [d, 0])); });
  return s;
}

function bump(s, metric, date, n) {
  if (s.series[metric].has(date)) s.series[metric].set(date, s.series[metric].get(date) + n);
}

const seriesJSON = (m) => Array.from(m.entries()).map(([date, count]) => ({ date, count }));

// Gather everything for `posts` (Sequelize rows with saleDays) of seller `me`.
async function collect(me, posts, span, at) {
  const M = models();
  const ids = posts.map((p) => p.id);
  const now = at || schedule.now();
  const per = new Map();
  posts.forEach((p) => {
    const dates = dateRange(tzOf(p), span, now);
    per.set(p.id, Object.assign(emptyStats(dates), {
      dates, todayDate: dates[dates.length - 1], conversations: 0, unread: 0,
      holds: { pending: 0, active: 0 }, items: { total: 0, sold: 0, reserved: 0 }, saveCount: 0, event: null,
    }));
  });
  if (!ids.length) return per;
  const oldest = per.size ? Array.from(per.values()).reduce((m, s) => (s.dates[0] < m ? s.dates[0] : m), '9999-12-31') : null;
  const since = new Date(Date.parse(oldest + 'T00:00:00Z') - 2 * 86400000); // covers every time zone

  await holds.sweep(now);
  const [views, viewTotals, scanDays, scanTotals, saves, saveRecent, convs, items, openHolds, parts] = await Promise.all([
    M.PostViewDay.findAll({ where: { postId: ids, day: { [Op.gte]: oldest } }, raw: true }),
    M.PostViewDay.findAll({ where: { postId: ids }, attributes: ['postId', [M.sequelize.fn('SUM', M.sequelize.col('count')), 'n']], group: ['postId'], raw: true }),
    M.PostScanDay.findAll({ where: { postId: ids, day: { [Op.gte]: oldest } }, raw: true }),
    M.PostScanDay.findAll({ where: { postId: ids }, attributes: ['postId', [M.sequelize.fn('SUM', M.sequelize.col('count')), 'n']], group: ['postId'], raw: true }),
    M.SavedPost.findAll({ where: { postId: ids }, attributes: ['postId', [M.sequelize.fn('COUNT', M.sequelize.col('id')), 'n']], group: ['postId'], raw: true }),
    M.SavedPost.findAll({ where: { postId: ids, createdAt: { [Op.gte]: since } }, attributes: ['postId', 'createdAt'], raw: true }),
    M.Conversation.findAll({ where: { postId: ids, sellerId: me }, attributes: ['id', 'postId'], raw: true }),
    M.SaleItem.findAll({ where: { postId: ids }, attributes: ['postId', 'sold', 'reservedUntil'], raw: true }),
    M.ItemHold.findAll({ where: { postId: ids, sellerId: me, status: M.ItemHold.ACTIVE, expiresAt: { [Op.gt]: now } }, attributes: ['postId', 'status'], raw: true }),
    M.EventParticipant.findAll({ where: { postId: ids }, include: [{ model: M.SaleEvent, as: 'event' }] }),
  ]);
  views.forEach((r) => { const s = per.get(r.postId); bump(s, 'views', dayStr(r.day), r.count); });
  viewTotals.forEach((r) => { per.get(r.postId).totals.views = Number(r.n) || 0; });
  scanDays.forEach((r) => { const s = per.get(r.postId); bump(s, 'scans', dayStr(r.day), r.count); });
  scanTotals.forEach((r) => { per.get(r.postId).totals.scans = Number(r.n) || 0; });
  saves.forEach((r) => { const s = per.get(r.postId); s.saveCount = Number(r.n) || 0; s.totals.saves = s.saveCount; });
  const byPost = new Map(posts.map((p) => [p.id, p]));
  saveRecent.forEach((r) => { const s = per.get(r.postId); bump(s, 'saves', schedule.localDate(new Date(r.createdAt), tzOf(byPost.get(r.postId))), 1); });
  items.forEach((r) => {
    const s = per.get(r.postId);
    s.items.total += 1;
    if (r.sold) s.items.sold += 1;
    else if (r.reservedUntil && new Date(r.reservedUntil) > now) s.items.reserved += 1;
  });
  openHolds.forEach((r) => { const s = per.get(r.postId); if (r.status === 'pending') s.holds.pending += 1; else s.holds.active += 1; });

  const convIds = convs.map((c) => c.id);
  const convPost = new Map(convs.map((c) => [c.id, c.postId]));
  convs.forEach((c) => { per.get(c.postId).conversations += 1; });
  if (convIds.length) {
    const buyerMsgs = { conversationId: convIds, senderId: { [Op.ne]: me }, kind: 'text', removedAt: null };
    const [counts, recent, unread] = await Promise.all([
      M.Message.findAll({ where: buyerMsgs, attributes: ['conversationId', [M.sequelize.fn('COUNT', M.sequelize.col('id')), 'n']], group: ['conversationId'], raw: true }),
      M.Message.findAll({ where: Object.assign({ createdAt: { [Op.gte]: since } }, buyerMsgs), attributes: ['conversationId', 'createdAt'], raw: true }),
      msg.unreadCounts(me, convIds),
    ]);
    counts.forEach((r) => { per.get(convPost.get(r.conversationId)).totals.messages += Number(r.n) || 0; });
    recent.forEach((r) => {
      const pid = convPost.get(r.conversationId);
      bump(per.get(pid), 'messages', schedule.localDate(new Date(r.createdAt), tzOf(byPost.get(pid))), 1);
    });
    unread.forEach((n, cid) => { per.get(convPost.get(cid)).unread += n; });
  }
  // A moderator-hidden event is not shown (the seller can't open it either).
  parts.forEach((pt) => {
    const e = pt.event;
    if (!e || e.hidden) return;
    per.get(pt.postId).event = { id: e.id, name: e.name, status: pt.status, ended: events.isEnded(e, now) };
  });
  per.forEach((s) => { METRICS.forEach((k) => { s.today[k] = s.series[k].get(s.todayDate) || 0; }); });
  return per;
}

function saleJSON(p, s) {
  return {
    id: p.id, title: p.title, city: p.city, state: p.state, hidden: !!p.hidden,
    status: p.hidden ? 'hidden' : schedule.statusOf(p) || 'nodates',
    ended: schedule.isEnded(p), schedule: schedule.toJSON(p), createdAt: p.createdAt,
    totals: s.totals, today: s.today,
    series: Object.fromEntries(METRICS.map((k) => [k, seriesJSON(s.series[k])])),
    conversations: s.conversations, unread: s.unread, holds: s.holds, items: s.items, event: s.event,
  };
}

// Sum per-sale series by date over the last `span` days in `tz`.
function overall(sales, tz, span, at) {
  const dates = dateRange(tz, span, at);
  const out = emptyStats(dates);
  const counts = { sales: sales.length, active: 0, ended: 0, conversations: 0, unread: 0, holdsPending: 0, holdsActive: 0, itemsTotal: 0, itemsSold: 0, inEvents: 0 };
  sales.forEach((s) => {
    METRICS.forEach((k) => {
      out.totals[k] += s.totals[k];
      s.series[k].forEach(({ date, count }) => bump(out, k, date, count));
    });
    if (s.ended) counts.ended += 1; else if (s.status !== 'hidden') counts.active += 1;
    counts.conversations += s.conversations; counts.unread += s.unread;
    counts.holdsPending += s.holds.pending; counts.holdsActive += s.holds.active;
    counts.itemsTotal += s.items.total; counts.itemsSold += s.items.sold;
    if (s.event) counts.inEvents += 1;
  });
  METRICS.forEach((k) => { out.today[k] = out.series[k].get(dates[dates.length - 1]) || 0; });
  return Object.assign(counts, { timeZone: tz, totals: out.totals, today: out.today, series: Object.fromEntries(METRICS.map((k) => [k, seriesJSON(out.series[k])])) });
}

const postInclude = () => [{ model: models().SaleDay, as: 'saleDays' }];

// GET /dashboard: all my sales (newest first, ended and hidden included).
async function forSeller(me, tz, at) {
  const M = models();
  const zone = tz && schedule.isValidTimeZone(tz) ? tz : schedule.defaultTimeZone();
  const posts = await M.Post.findAll({ where: { userId: me }, include: postInclude(), order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: MAX_SALES });
  const per = await collect(me, posts, SPAN, at);
  const sales = posts.map((p) => saleJSON(p, per.get(p.id)));
  return { span: SPAN, metrics: METRICS, overall: overall(sales, zone, SPAN, at), sales, truncated: posts.length === MAX_SALES };
}

// GET /dashboard/sales/:id: one of my sales, plus its open holds and conversations.
async function forSale(me, post, at) {
  const M = models();
  const per = await collect(me, [post], SPAN, at);
  const sale = saleJSON(post, per.get(post.id));
  const now = at || schedule.now();
  const [openHolds, convs] = await Promise.all([
    M.ItemHold.findAll({ where: { postId: post.id, sellerId: me, status: M.ItemHold.ACTIVE, expiresAt: { [Op.gt]: now } },
      include: [{ model: M.SaleItem, as: 'item', attributes: ['id', 'name'] }, { model: M.User, as: 'buyer', attributes: ['id', 'firstName', 'lastName'] }],
      order: [['createdAt', 'ASC']] }),
    M.Conversation.findAll({ where: { postId: post.id, sellerId: me }, include: [{ model: M.User, as: 'buyer', attributes: ['id', 'firstName', 'lastName'] }], order: [['lastMessageAt', 'DESC'], ['id', 'DESC']], limit: 50 }),
  ]);
  const unread = convs.length ? await msg.unreadCounts(me, convs.map((c) => c.id)) : new Map();
  sale.holdList = openHolds.map((h) => ({
    id: h.id, status: h.status, conversationId: h.conversationId, item: h.item ? h.item.name : null,
    buyer: h.buyer ? publicName(h.buyer) : null, pickupAt: h.pickupAt, expiresAt: h.expiresAt,
  }));
  sale.conversationList = convs.map((c) => ({ id: c.id, buyer: c.buyer ? publicName(c.buyer) : null, lastMessageAt: c.lastMessageAt, unread: unread.get(c.id) || 0 }));
  return { span: SPAN, metrics: METRICS, sale };
}

module.exports = { SPAN, MAX_SALES, METRICS, dateRange, forSeller, forSale, postInclude };
