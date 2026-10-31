'use strict';
// Seller sale report (GET /post/:id/report, owner only): a printable,
// PDF-friendly after-sale summary built on the same count-only analytics as
// the dashboard (lib/sellerTools.summary). It never names or identifies a
// visitor or buyer: views, QR scans and shares are per-day counters, saves
// (favorites), conversations and messages are counts.
//
// Earnings use the prices the seller recorded: for each sold item, the agreed
// offer price of its completed hold (lib/holds.js, offers and bundle deals),
// else its listed price. Sold items with neither count as "no price".
const { Op } = require('sequelize');
const schedule = require('./schedule');

function models() { return require('../models'); }

const DAY_LIMIT = 60;

async function daily(m, postId) {
  const rows = {};
  const add = (list, key) => list.forEach((r) => {
    const day = String(r.day).slice(0, 10);
    rows[day] = rows[day] || { day, views: 0, scans: 0, shares: 0 };
    rows[day][key] += Number(r.count) || 0;
  });
  const opts = { where: { postId }, attributes: ['day', 'count'], raw: true };
  const [v, s, sh] = await Promise.all([m.PostViewDay.findAll(opts), m.PostScanDay.findAll(opts), m.PostShareDay.findAll(opts)]);
  add(v, 'views'); add(s, 'scans'); add(sh, 'shares');
  return Object.keys(rows).sort().slice(-DAY_LIMIT).map((k) => rows[k]);
}

async function build(post, at) {
  const m = models();
  const items = await m.SaleItem.findAll({ where: { postId: post.id }, order: [['position', 'ASC'], ['id', 'ASC']], raw: true });
  const soldIds = items.filter((i) => i.sold).map((i) => i.id);
  const holds = soldIds.length ? await m.ItemHold.findAll({
    where: { itemId: soldIds, status: 'completed', offerCents: { [Op.ne]: null } },
    attributes: ['itemId', 'offerCents', 'decidedAt', 'id'], order: [['decidedAt', 'DESC'], ['id', 'DESC']], raw: true,
  }) : [];
  const agreed = new Map();
  holds.forEach((h) => { if (!agreed.has(h.itemId)) agreed.set(h.itemId, h.offerCents); });

  const sold = [];
  const unsold = [];
  items.forEach((i) => {
    if (!i.sold) { unsold.push({ id: i.id, name: i.name, listedCents: i.priceCents }); return; }
    const offer = agreed.get(i.id);
    const soldCents = offer != null ? offer : i.priceCents;
    sold.push({ id: i.id, name: i.name, listedCents: i.priceCents, soldCents: soldCents == null ? null : soldCents,
      priceSource: offer != null ? 'offer' : i.priceCents != null ? 'listed' : null, soldAt: i.soldAt ? new Date(i.soldAt).toISOString() : null });
  });

  const convIds = (await m.Conversation.findAll({ where: { postId: post.id }, attributes: ['id'], raw: true })).map((c) => c.id);
  const sumOf = async (model) => Number((await model.sum('count', { where: { postId: post.id } })) || 0);
  const [views, scans, shares, saves, messages, holdsCompleted, days] = await Promise.all([
    sumOf(m.PostViewDay), sumOf(m.PostScanDay), sumOf(m.PostShareDay),
    m.SavedPost.count({ where: { postId: post.id } }),
    convIds.length ? m.Message.count({ where: { conversationId: convIds, kind: 'text', removedAt: null } }) : 0,
    m.ItemHold.count({ where: { postId: post.id, status: 'completed' } }),
    daily(m, post.id),
  ]);
  const earned = sold.reduce((s, i) => s + (i.soldCents || 0), 0);
  const listedSold = sold.reduce((s, i) => s + (i.listedCents || 0), 0);
  const t = at || schedule.now();
  return {
    post: {
      id: post.id, title: post.title, city: post.city || null, state: post.state || null, isFree: !!post.isFree,
      status: schedule.statusOf(post, t), schedule: schedule.toJSON(post),
      startDate: post.startDate ? new Date(post.startDate).toISOString() : null, endDate: post.endDate ? new Date(post.endDate).toISOString() : null,
    },
    generatedAt: new Date(t).toISOString(),
    totals: {
      items: items.length, sold: sold.length, unsold: unsold.length,
      earnedCents: earned, listedValueSoldCents: listedSold, unsoldListedCents: unsold.reduce((s, i) => s + (i.listedCents || 0), 0),
      soldWithoutPrice: sold.filter((i) => i.soldCents == null).length, soldByOffer: sold.filter((i) => i.priceSource === 'offer').length,
    },
    sold, unsold,
    reach: { views, scans, shares, saves, conversations: convIds.length, messages, holdsCompleted },
    daily: days,
  };
}

module.exports = { build, DAY_LIMIT };
