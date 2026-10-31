'use strict';
// Early-bird access: the seller opens a preview window before each sale day
// starts (Posts.earlyMinutes: 15–180, in steps of 15; null = off), visible
// only to people who follow the seller or saved (favorited) the sale.
//
// - Eligible viewers (and the seller) get post.earlyBird = { minutes,
//   startsAt, until, active } on GET /post/:id and a bell + push when the
//   window opens (worker pass, once per sale day).
// - Everyone else sees the normal start time. They only learn that early
//   access exists ({ offered: true }, never when), so they can follow or save.
// - Blocks either way stop it; hidden sales never notify.
const { Op } = require('sequelize');
const schedule = require('./schedule');
const { isAdmin } = require('./roles');

function models() { return require('../models'); }

const MIN_MINUTES = 15;
const MAX_MINUTES = 180;
const STEP = 15;
const MIN = 60000;

// body.earlyMinutes -> { errors, values }. null / '' / 0 turns it off.
function validate(body) {
  const errors = {};
  const values = {};
  if (body.earlyMinutes === undefined) return { errors, values };
  const raw = body.earlyMinutes;
  if (raw === null || raw === '' || raw === 0 || raw === '0') { values.earlyMinutes = null; return { errors, values }; }
  const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN);
  if (!Number.isInteger(n) || n < MIN_MINUTES || n > MAX_MINUTES || n % STEP) errors.earlyMinutes = 'Early-bird access is 15 minutes to 3 hours before the start, in 15-minute steps.';
  else values.earlyMinutes = n;
  return { errors, values };
}

// The current or next early window: { startsAt, until, active } (Dates) or null.
function windowOf(post, at) {
  const mins = post && post.earlyMinutes;
  if (!mins) return null;
  const t = (at || schedule.now()).getTime();
  const w = schedule.windowsOf(post).find((x) => x.startsAt > t);
  if (!w) return null;
  const startsAt = w.startsAt - mins * MIN;
  return { startsAt: new Date(startsAt), until: new Date(w.startsAt), active: t >= startsAt };
}

// Does `user` get early access to `post`? (seller, admin, follower, saver; no block)
async function eligible(user, post) {
  if (!user || !post) return false;
  if (user.id === post.userId || isAdmin(user)) return true;
  const m = models();
  const blocked = await m.UserBlock.count({ where: { [Op.or]: [{ blockerId: user.id, blockedId: post.userId }, { blockerId: post.userId, blockedId: user.id }] } });
  if (blocked) return false;
  const [follows, saved] = await Promise.all([
    m.Follow.count({ where: { followerId: user.id, sellerId: post.userId } }),
    m.SavedPost.count({ where: { userId: user.id, postId: post.id } }),
  ]);
  return follows + saved > 0;
}

// Everyone with early access to `post` other than the seller (ids), minus blocks.
async function audience(post) {
  const m = models();
  const [followers, savers] = await Promise.all([
    m.Follow.findAll({ where: { sellerId: post.userId }, attributes: ['followerId'], raw: true }),
    m.SavedPost.findAll({ where: { postId: post.id }, attributes: ['userId'], raw: true }),
  ]);
  const ids = new Set(followers.map((f) => f.followerId).concat(savers.map((s) => s.userId)));
  ids.delete(post.userId);
  if (!ids.size) return [];
  const list = Array.from(ids);
  const blocks = await m.UserBlock.findAll({ where: { [Op.or]: [{ blockerId: post.userId, blockedId: list }, { blockedId: post.userId, blockerId: list }] }, raw: true });
  blocks.forEach((b) => ids.delete(b.blockerId === post.userId ? b.blockedId : b.blockerId));
  return Array.from(ids);
}

// Adds json.earlyBird for this viewer (see the header). Mutates and returns json.
async function annotate(json, post, user, at) {
  delete json.earlyMinutes;
  if (!post.earlyMinutes) return json;
  const win = windowOf(post, at);
  if (await eligible(user, post)) {
    json.earlyBird = { minutes: post.earlyMinutes, forYou: true,
      startsAt: win ? win.startsAt.toISOString() : null, until: win ? win.until.toISOString() : null, active: !!(win && win.active) };
  } else if (win) {
    json.earlyBird = { offered: true, forYou: false };
  }
  return json;
}

// Worker pass: tell the audience when an early window opens (bell + push),
// once per (person, sale day). Looks at sale days starting within MAX_MINUTES.
async function processDue(now) {
  const m = models();
  const at = now || schedule.now();
  const summary = { sales: 0, told: 0 };
  const horizon = new Date(at.getTime() + MAX_MINUTES * MIN);
  const fromDays = await m.SaleDay.findAll({ where: { startsAt: { [Op.gt]: at, [Op.lte]: horizon } }, attributes: ['postId'], raw: true });
  const legacy = await m.Post.findAll({ where: { earlyMinutes: { [Op.ne]: null }, hidden: false, startDate: { [Op.gt]: at, [Op.lte]: horizon } }, attributes: ['id'], raw: true });
  const ids = Array.from(new Set(fromDays.map((d) => d.postId).concat(legacy.map((p) => p.id))));
  if (!ids.length) return summary;
  const posts = await m.Post.findAll({ where: { id: ids, earlyMinutes: { [Op.ne]: null }, hidden: false }, include: [{ model: m.SaleDay, as: 'saleDays' }] });
  const N = require('./notifications');
  const push = require('./push');
  for (const post of posts) {
    const win = windowOf(post, at);
    if (!win || !win.active) continue;
    summary.sales += 1;
    const people = await audience(post);
    if (!people.length) continue;
    const key = 'early:' + post.id + ':' + win.until.getTime().toString(36);
    const rows = people.map((userId) => ({ userId, kind: 'early_bird', postId: post.id, dedupeKey: key,
      data: { until: win.until.toISOString(), minutes: post.earlyMinutes } }));
    // Only people who weren't told yet get a push.
    const before = new Set((await m.Notification.findAll({ where: { dedupeKey: key, userId: people }, attributes: ['userId'], raw: true })).map((r) => r.userId));
    const n = await N.add(rows);
    summary.told += n;
    people.filter((id) => !before.has(id)).forEach((userId) => push.earlyBird(userId, { title: post.title, postId: post.id }));
  }
  return summary;
}

module.exports = { MIN_MINUTES, MAX_MINUTES, STEP, validate, windowOf, eligible, audience, annotate, processDue };
