'use strict';
// Favorites updates: people who favorited (saved) a sale hear in-app when it
// gets cheaper or its items sell. The seller never hears about their own sale,
// and blocks (either way) stop it. Updates coalesce: one unseen notification
// per (person, sale, kind), refreshed as more changes come in.
const { Op } = require('sequelize');
const N = require('./notifications');

function models() { return require('../models'); }

const ITEMS_KEPT = 5;

// Who favorited this sale and may hear about it.
async function watchers(post) {
  const m = models();
  if (!post || post.hidden) return [];
  const rows = await m.SavedPost.findAll({ where: { postId: post.id, userId: { [Op.ne]: post.userId } }, attributes: ['userId'], raw: true });
  if (!rows.length) return [];
  const ids = rows.map((r) => r.userId);
  const blocks = await m.UserBlock.findAll({ where: { [Op.or]: [{ blockerId: post.userId, blockedId: ids }, { blockedId: post.userId, blockerId: ids }] }, raw: true });
  const out = new Set(ids);
  blocks.forEach((b) => out.delete(b.blockerId === post.userId ? b.blockedId : b.blockerId));
  return Array.from(out);
}

// data: { items: [{ id, name, from?, to? }], price?: { from, to }, markdown?: percent, soldOut? }
function merge(old, add) {
  const out = Object.assign({}, old || {});
  if (add.items) {
    const items = (out.items || []).filter((i) => !add.items.some((a) => a.id === i.id));
    out.items = add.items.concat(items).slice(0, ITEMS_KEPT);
    // "from" is the first price we told them about, so a run of drops reads "$40 → $25".
    out.items.forEach((i) => { const prev = (old && old.items || []).find((o) => o.id === i.id); if (prev && prev.from !== undefined && i.from !== undefined) i.from = Math.max(prev.from, i.from); });
  }
  if (add.price) out.price = { from: out.price ? out.price.from : add.price.from, to: add.price.to };
  if (add.markdown) out.markdown = add.markdown;
  if (add.soldOut !== undefined) out.soldOut = add.soldOut;
  return out;
}

async function tell(post, kind, data) {
  const ids = await watchers(post);
  if (!ids.length) return 0;
  return N.bump(ids.map((userId) => ({ userId, kind, postId: post.id, data })), merge);
}

// Prices: items in cents, the post's range in whole dollars.
const num = (v) => (v === null || v === undefined ? null : Number(v));
const lower = (before, after) => before !== null && after !== null && after < before;
// The headline price of a range: "up to" (max), else the min.
const top = (p) => (p.isFree ? 0 : num(p.priceMax) !== null ? num(p.priceMax) : num(p.priceMin));
const bottom = (p) => (p.isFree ? 0 : num(p.priceMin) !== null ? num(p.priceMin) : num(p.priceMax));

// The seller edited the sale: now free, a lower top, or a lower bottom (top not raised) is a drop.
async function postEdited(post, before) {
  const t0 = top(before); const t1 = top(post);
  const dropped = (post.isFree && !before.isFree) || lower(t0, t1) || (lower(bottom(before), bottom(post)) && !(t0 !== null && t1 !== null && t1 > t0));
  if (!dropped) return 0;
  return tell(post, 'price_drop', { price: { from: t0, to: t1 } });
}

// An item changed: cheaper, or sold (and maybe the last one).
async function itemChanged(post, item, before) {
  if (item.sold && !before.sold) {
    const left = await models().SaleItem.count({ where: { postId: post.id, sold: false } });
    return tell(post, 'item_sold', { items: [{ id: item.id, name: item.name }], soldOut: left === 0 });
  }
  if (!item.sold && lower(before.priceCents, item.priceCents)) {
    return tell(post, 'price_drop', { items: [{ id: item.id, name: item.name, from: before.priceCents, to: item.priceCents }] });
  }
  return 0;
}

// Worker pass: a scheduled markdown that just started is a price drop too.
// Once per markdown window (dedupeKey markdown:<post>:<start>).
async function markdownsStarted(now) {
  const m = models();
  const md = require('./markdown');
  const schedule = require('./schedule');
  const at = now || schedule.now();
  const posts = await m.Post.findAll({
    where: { hidden: false, markdownPercent: { [Op.ne]: null }, markdownFrom: { [Op.ne]: null } },
    include: [{ model: m.SaleDay, as: 'saleDays', where: { endsAt: { [Op.gt]: at } }, required: true }],
    limit: 500,
  });
  let n = 0;
  for (const p of posts) {
    const st = md.state(p, at);
    if (!st || !st.active) continue;
    const ids = await watchers(p);
    if (!ids.length) continue;
    n += await N.add(ids.map((userId) => ({ userId, kind: 'price_drop', postId: p.id, dedupeKey: 'markdown:' + p.id + ':' + st.startsAt, data: { markdown: st.percent } })));
  }
  return n;
}

// Fire-and-forget from request handlers (errors are logged, never thrown).
function schedule(fn) {
  return require('./alerts').track(fn, 'Favorites update failed');
}

module.exports = { watchers, merge, top, bottom, postEdited, itemChanged, markdownsStarted, schedule };
