// /post/:id/curbside: free on the curb (lib/curbside.js). req.post is loaded
// and visibility-checked by post.js.
//   PUT    /        seller starts or changes the offer { all | itemIds, until?, note? }
//   DELETE /        seller ends it
//   POST   /taken   { itemId? } a signed-in neighbor says it's gone (rate limited),
//                   or the seller marks it gone
//   POST   /undo    { itemId? } seller puts it back
const router = require('express').Router({ mergeParams: true });
const { Op } = require('sequelize');
const models = require('../models');
const { badRequest, forbidden, notFound, sendError, serverError, requireLogin, parseId } = require('../lib/http');
const curb = require('../lib/curbside');
const schedule = require('../lib/schedule');
const events = require('../lib/events');
const wanted = require('../lib/wanted');

const isOwner = (req) => !!req.user && req.user.id === req.post.userId;

function ownerOnly(req, res, next) {
  if (!isOwner(req)) return forbidden(res, 'Only the seller can change the curbside offer.');
  return next();
}

// The post's state as the caller sees it (same shape as GET /post/:id).
async function answer(req, res, status) {
  const post = await models.Post.findByPk(req.post.id, { include: [{ model: models.SaleItem, as: 'items' }] });
  const json = { id: post.id, items: post.toJSON().items };
  await curb.annotate([json], req.user, { marks: true });
  return res.status(status || 200).json(json);
}

router.put('/', requireLogin, ownerOnly, async (req, res) => {
  const post = req.post;
  const now = schedule.now();
  if (post.hidden) return sendError(res, 409, 'post_hidden', "This sale is hidden by a moderator, so it can't offer free leftovers.");
  if (!curb.canStart(post, now)) return sendError(res, 409, 'too_early', 'You can put leftovers on the curb from ' + curb.START_BEFORE_END_HOURS + ' hours before your sale ends.');
  const { errors, values } = curb.validate(req.body, post, now);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid curbside offer.', errors);
  try {
    let chosen = [];
    if (!values.all) {
      chosen = await models.SaleItem.findAll({ where: { postId: post.id, id: values.itemIds } });
      if (chosen.length !== values.itemIds.length) return badRequest(res, 'Invalid curbside offer.', { itemIds: 'Some of those items are not on this sale.' });
      if (chosen.some((i) => i.sold)) return badRequest(res, 'Invalid curbside offer.', { itemIds: "Sold items can't go on the curb." });
      if (chosen.some((i) => i.reservedUntil && new Date(i.reservedUntil) > now)) return badRequest(res, 'Invalid curbside offer.', { itemIds: "Reserved items can't go on the curb. Cancel the hold first." });
    }
    const wasLive = curb.rawState(post, now) === 'active';
    await models.sequelize.transaction(async (transaction) => {
      await models.SaleItem.update({ curbside: false, curbsideGoneAt: null, curbsideGoneSource: null }, { where: { postId: post.id, id: { [Op.notIn]: chosen.map((i) => i.id).concat([0]) } }, transaction });
      if (chosen.length) {
        // Items already taken in this offer stay taken; newly added ones start free.
        const keep = wasLive ? chosen.filter((i) => i.curbside).map((i) => i.id) : [];
        await models.SaleItem.update({ curbside: true }, { where: { id: chosen.map((i) => i.id) }, transaction });
        await models.SaleItem.update({ curbsideGoneAt: null, curbsideGoneSource: null }, { where: { id: chosen.map((i) => i.id).filter((id) => keep.indexOf(id) === -1) }, transaction });
      }
      await post.update({
        curbsideUntil: values.until, curbsideNote: values.note, curbsideAll: values.all,
        // Real time, like the marks' createdAt (which scopes marks to this offer).
        curbsideStartedAt: wasLive ? post.curbsideStartedAt : new Date(),
        curbsideGoneAt: wasLive && !values.all ? post.curbsideGoneAt : null, curbsideGoneSource: wasLive && !values.all ? post.curbsideGoneSource : null,
      }, { transaction });
      if (!values.all) await curb.refreshGone(post.id, transaction);
    });
    // Buyers whose wanted posts match a now-free item hear about it (once per sale).
    wanted.schedulePost(post.id);
    return answer(req, res, wasLive ? 200 : 201);
  } catch (err) { return serverError(res, err); }
});

router.delete('/', requireLogin, ownerOnly, async (req, res) => {
  try {
    await models.sequelize.transaction(async (transaction) => {
      await models.SaleItem.update({ curbside: false, curbsideGoneAt: null, curbsideGoneSource: null }, { where: { postId: req.post.id }, transaction });
      await req.post.update({ curbsideUntil: null, curbsideNote: null, curbsideAll: false, curbsideStartedAt: null, curbsideGoneAt: null, curbsideGoneSource: null }, { transaction });
    });
    return answer(req, res);
  } catch (err) { return serverError(res, err); }
});

// Resolve body.itemId to a curbside item of this post (or none for "everything").
async function target(req, res) {
  const post = req.post;
  const b = req.body || {};
  if (b.itemId === undefined || b.itemId === null) {
    if (!post.curbsideAll) { badRequest(res, 'Say which item was taken.', { itemId: 'Choose an item.' }); return null; }
    return { item: null };
  }
  const id = parseId(b.itemId);
  const item = id ? await models.SaleItem.findOne({ where: { id, postId: post.id } }) : null;
  if (!item || (!post.curbsideAll && !item.curbside)) { notFound(res, 'That item is not free on the curb.'); return null; }
  if (post.curbsideAll) { badRequest(res, 'This offer is everything that is left; mark the whole offer taken.', { itemId: 'Leave out itemId.' }); return null; }
  return { item };
}

router.post('/taken', requireLogin, async (req, res) => {
  const post = req.post;
  const now = schedule.now();
  try {
    if (!curb.isLive(post, now) || (await curb.isReported(post.id))) return sendError(res, 409, 'curbside_over', 'Nothing here is free on the curb right now.');
    const t = await target(req, res);
    if (!t) return undefined;
    const gone = t.item ? !!t.item.curbsideGoneAt || t.item.sold : !!post.curbsideGoneAt;
    if (gone) return sendError(res, 409, 'already_taken', 'Someone already marked that taken.');
    const owner = isOwner(req);
    if (!owner) {
      if (await events.blockedBetween(req.user.id, post.userId)) return sendError(res, 403, 'blocked', "You can't do that for this seller.");
      const prior = await models.CurbsideMark.findOne({ where: { postId: post.id, itemId: t.item ? t.item.id : null, userId: req.user.id, createdAt: { [Op.gte]: post.curbsideStartedAt || new Date(0) } } });
      if (prior) return sendError(res, 409, 'already_marked', 'You already marked that taken, and the seller says it is still there.');
      const recent = await models.CurbsideMark.count({ where: { userId: req.user.id, createdAt: { [Op.gte]: new Date(Date.now() - 3600000) } } });
      if (recent >= curb.takenPerHour()) {
        res.set('Retry-After', '3600');
        return sendError(res, 429, 'rate_limited', 'You have marked a lot of things taken. Please try again later.');
      }
    }
    await models.sequelize.transaction(async (transaction) => {
      const source = owner ? 'seller' : 'neighbor';
      if (!owner) await models.CurbsideMark.create({ postId: post.id, itemId: t.item ? t.item.id : null, userId: req.user.id }, { transaction });
      if (t.item) {
        await t.item.update({ curbsideGoneAt: now, curbsideGoneSource: source }, { transaction });
        await curb.refreshGone(post.id, transaction);
      } else await post.update({ curbsideGoneAt: now, curbsideGoneSource: source }, { transaction });
    });
    return answer(req, res);
  } catch (err) { return serverError(res, err); }
});

router.post('/undo', requireLogin, ownerOnly, async (req, res) => {
  const post = req.post;
  const now = schedule.now();
  if (!post.curbsideUntil || new Date(post.curbsideUntil) <= now) return sendError(res, 409, 'curbside_over', 'This curbside offer is over. Start a new one instead.');
  try {
    const t = await target(req, res);
    if (!t) return undefined;
    await models.sequelize.transaction(async (transaction) => {
      if (t.item) {
        await t.item.update({ curbsideGoneAt: null, curbsideGoneSource: null }, { transaction });
        await curb.refreshGone(post.id, transaction);
      } else await post.update({ curbsideGoneAt: null, curbsideGoneSource: null }, { transaction });
      await models.CurbsideMark.update({ undoneAt: now }, { where: { postId: post.id, itemId: t.item ? t.item.id : null, undoneAt: null }, transaction });
    });
    return answer(req, res);
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
