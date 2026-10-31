'use strict';
// Live "what's left": while a sale runs, the seller taps items sold or
// available (controllers/items.js) and buyers' open pages follow along.
//
// - Every change to the item list stamps Posts.itemsUpdatedAt ("updated 3 min ago").
// - GET /post/:id/items/status is a small, cacheable (ETag) snapshot the
//   sale page polls while the sale is on: ids with sold/reserved only.
// - People who saved the sale and have a tab open get an 'items' live event
//   (lib/live.js, ids only) so their page refreshes at once instead of at the
//   next poll. Bell notifications for sold items stay with lib/favorites.js
//   (coalesced), and holds on a sold item are closed by lib/holds.js.
const schedule = require('./schedule');

function models() { return require('../models'); }

// Seconds between polls the client should use (the server's hint): fast
// while the sale is open (or its curbside leftovers are), slow otherwise.
const POLL_OPEN_SECONDS = 20;
const POLL_IDLE_SECONDS = 300;

function pollSeconds(post, at) {
  const now = at || schedule.now();
  const st = schedule.statusOf(post, now);
  const curb = post.curbsideUntil && new Date(post.curbsideUntil) > now && !post.curbsideGoneAt;
  if (st === 'open' || curb) return POLL_OPEN_SECONDS;
  // Starting within the hour: get ready.
  const soon = schedule.windowsOf(post).some((w) => w.startsAt > now.getTime() && w.startsAt - now.getTime() <= 3600000);
  return soon ? POLL_OPEN_SECONDS : st === 'ended' ? 0 : POLL_IDLE_SECONDS;
}

// The list changed: stamp the post and nudge watchers' open tabs.
async function touched(post, at) {
  const m = models();
  const when = at || schedule.now();
  // Static update: no instance hooks (calendar sequence) for a list change.
  await m.Post.update({ itemsUpdatedAt: when }, { where: { id: post.id }, hooks: false, silent: true });
  post.itemsUpdatedAt = when;
  try {
    const watchers = await require('./favorites').watchers(post);
    const live = require('./live');
    watchers.forEach((uid) => live.emit(uid, 'items', { postId: post.id }));
    return watchers.length;
  } catch (err) {
    console.error('What\'s-left live event failed:', err && err.message);
    return 0;
  }
}

// { postId, updatedAt, pollSeconds, total, sold, items: [{ id, sold, reserved }] }
async function status(post, at) {
  const now = at || schedule.now();
  const rows = await models().SaleItem.findAll({ where: { postId: post.id }, attributes: ['id', 'sold', 'reservedUntil', 'position'], order: [['position', 'ASC'], ['id', 'ASC']], raw: true });
  const items = rows.map((r) => ({ id: r.id, sold: !!r.sold, reserved: !r.sold && !!r.reservedUntil && new Date(r.reservedUntil) > now }));
  return {
    postId: post.id,
    updatedAt: post.itemsUpdatedAt ? new Date(post.itemsUpdatedAt).toISOString() : null,
    pollSeconds: pollSeconds(post, now),
    total: items.length,
    sold: items.filter((i) => i.sold).length,
    items,
  };
}

module.exports = { POLL_OPEN_SECONDS, POLL_IDLE_SECONDS, pollSeconds, touched, status };
