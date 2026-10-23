'use strict';
// In-app notifications (the bell): saved-search matches now, favorites
// updates later. Rows are written once per (user, dedupeKey); reading filters
// out anything the user can no longer see (hidden or deleted sales, sellers
// they blocked or who blocked them), so nothing leaks after moderation.
// Sellers appear as "First L." only; no emails are ever stored or returned.
const { Op } = require('sequelize');
const { publicUser } = require('./people');

function models() { return require('../models'); }

const KINDS = ['search_match'];
const LIST_MAX = 50;
const KEEP_DAYS = 60;

// rows: [{ userId, kind, postId?, alertId?, dedupeKey, data? }]. Returns how many were new.
async function add(rows) {
  if (!rows.length) return 0;
  const m = models();
  const keys = rows.map((r) => r.userId + '|' + r.dedupeKey);
  const existing = await m.Notification.findAll({
    where: { [Op.or]: rows.map((r) => ({ userId: r.userId, dedupeKey: r.dedupeKey })) }, attributes: ['userId', 'dedupeKey'], raw: true,
  });
  const have = new Set(existing.map((e) => e.userId + '|' + e.dedupeKey));
  const fresh = rows.filter((r, i) => !have.has(keys[i]))
    .map((r) => Object.assign({}, r, { data: r.data === undefined || r.data === null ? null : JSON.stringify(r.data) }));
  if (!fresh.length) return 0;
  await m.Notification.bulkCreate(fresh, { ignoreDuplicates: true });
  const live = require('./live');
  Array.from(new Set(fresh.map((r) => r.userId))).forEach((id) => live.emit(id, 'badges', {}));
  return fresh.length;
}

async function blockedWith(userId) {
  const rows = await models().UserBlock.findAll({ where: { [Op.or]: [{ blockerId: userId }, { blockedId: userId }] }, raw: true });
  return new Set(rows.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));
}

// The user's notifications, newest first, only about sales they may still see.
async function list(user, opts) {
  const m = models();
  const limit = Math.min((opts && opts.limit) || LIST_MAX, LIST_MAX);
  const rows = await m.Notification.findAll({
    where: { userId: user.id }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: limit * 2,
    include: [
      { model: m.Post, attributes: ['id', 'title', 'city', 'state', 'userId', 'hidden', 'priceMin', 'priceMax', 'isFree'], include: [{ model: m.User, attributes: ['id', 'firstName', 'lastName'] }] },
      { model: m.SaleAlert, attributes: ['id', 'label', 'keyword'] },
    ],
  });
  const blocked = await blockedWith(user.id);
  const out = [];
  for (const n of rows) {
    const p = n.Post;
    if (n.postId && (!p || p.hidden || blocked.has(p.userId))) continue;
    let data = null;
    try { data = n.data ? JSON.parse(n.data) : null; } catch (e) { data = null; }
    out.push({
      id: n.id, kind: n.kind, createdAt: n.createdAt, seen: !!n.seenAt, data,
      post: p ? { id: p.id, title: p.title, city: p.city, state: p.state, priceMin: p.priceMin, priceMax: p.priceMax, isFree: p.isFree, seller: publicUser(p.User) } : null,
      search: n.SaleAlert ? { id: n.SaleAlert.id, label: n.SaleAlert.label, keyword: n.SaleAlert.keyword || null } : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function unreadCount(user) {
  return (await list(user)).filter((n) => !n.seen).length;
}

// ids: array of ids, or undefined for all. Only the user's own rows change.
async function markSeen(userId, ids) {
  const where = { userId, seenAt: null };
  if (ids) where.id = ids;
  const [n] = await models().Notification.update({ seenAt: new Date() }, { where });
  return n;
}

async function prune(now) {
  return models().Notification.destroy({ where: { createdAt: { [Op.lt]: new Date((now || new Date()).getTime() - KEEP_DAYS * 86400000) } } });
}

module.exports = { KINDS, LIST_MAX, KEEP_DAYS, add, list, unreadCount, markSeen, prune };
