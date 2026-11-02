// /donations: leftover donation lots (lib/donations.js).
//   GET    /nearby?lat&lng&radius   open lots near a point (radius 1, 2, 5, 10 or 25 miles; default 10)
//   GET    /mine                    lots I listed or claimed
//   GET    /:postId                 one sale's lot
//   PUT    /:postId                 seller: list or change { itemIds?, note?, slots, minutes } (sale ended, not claimed)
//   DELETE /:postId                 seller: take it down
//   POST   /:postId/claim           { slot, org? } claim it for one pickup slot
//   POST   /:postId/unclaim         claimer: give it back
//   POST   /:postId/release         seller: release the claim (it is open again)
//   POST   /:postId/done            seller: picked up
const router = require('express').Router();
const { Op } = require('sequelize');
const models = require('../models');
const { badRequest, forbidden, notFound, sendError, serverError, requireLogin, parseId } = require('../lib/http');
const { requireVerified } = require('../lib/emailVerify');
const donations = require('../lib/donations');
const schedule = require('../lib/schedule');
const mod = require('../lib/moderation');
const msg = require('../lib/messaging');

const MAX_CLAIMS = 3;
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const num = (v) => (v === undefined || v === null || v === '' ? NaN : Number(v));

router.get('/nearby', async (req, res) => {
  const lat = num(req.query.lat);
  const lng = num(req.query.lng);
  const radius = req.query.radius === undefined ? 10 : Number(req.query.radius);
  const errors = {};
  if (!(lat >= -90 && lat <= 90)) errors.lat = 'Choose a place on the map.';
  if (!(lng >= -180 && lng <= 180)) errors.lng = 'Choose a place on the map.';
  if (!donations.RADII.includes(radius)) errors.radius = 'Choose 1, 2, 5, 10 or 25 miles.';
  if (Object.keys(errors).length) return badRequest(res, 'Invalid request.', errors);
  try {
    return res.json({ results: await donations.nearby({ lat, lng }, radius, req.user || null), radii: donations.RADII });
  } catch (err) { return serverError(res, err); }
});

async function full(lot, viewer) {
  const post = await models.Post.findByPk(lot.postId, { include: [{ model: models.User, attributes: ['id', 'firstName', 'lastName'] }] });
  const claimer = lot.claimerId ? await models.User.findByPk(lot.claimerId, { attributes: ['id', 'firstName', 'lastName'] }) : null;
  return donations.lotJSON(lot, post, await donations.itemsOf(lot), viewer, schedule.now(), { claimer });
}

router.get('/mine', requireLogin, async (req, res) => {
  try {
    const me = req.user.id;
    const rows = await models.DonationLot.findAll({ where: { [Op.or]: [{ sellerId: me, status: ['open', 'claimed'] }, { claimerId: me, status: 'claimed' }] }, order: [['updatedAt', 'DESC']], limit: 50 });
    const results = [];
    for (const l of rows) results.push(await full(l, req.user));
    return res.json({ results });
  } catch (err) { return serverError(res, err); }
});

// Loads req.post (visible to the viewer) and req.lot (may be null).
async function load(req, res, next) {
  const id = parseId(req.params.postId);
  if (!id) return notFound(res, 'Post not found.');
  try {
    const post = await models.Post.findByPk(id, { include: [{ model: models.SaleDay, as: 'saleDays' }] });
    if (!post || !mod.canSee(req.user, post)) return notFound(res, 'Post not found.');
    req.post = post;
    req.lot = await models.DonationLot.findOne({ where: { postId: id } });
    return next();
  } catch (err) { return serverError(res, err); }
}
const seller = (req, res, next) => (req.post.userId === req.user.id ? next() : forbidden(res, 'Only the seller can do this.'));
const NONE = (res) => notFound(res, 'There is no donation lot for this sale.');
const CHANGED = (res) => sendError(res, 409, 'lot_changed', 'This donation lot changed. Refresh and try again.');

router.get('/:postId', load, async (req, res) => {
  try {
    const lot = req.lot;
    const mine = req.user && lot && (req.user.id === lot.sellerId || req.user.id === lot.claimerId);
    if (!lot || (!mine && (lot.status === 'cancelled' || lot.status === 'done'))) return NONE(res);
    if (req.user && !mine && await donations.blockedBetween(req.user.id, lot.sellerId)) return NONE(res);
    if (req.post.hidden && !mine) return NONE(res);
    return res.json(await full(lot, req.user || null));
  } catch (err) { return serverError(res, err); }
});

router.put('/:postId', requireLogin, load, seller, async (req, res) => {
  try {
    const t = schedule.now();
    if (!schedule.windowsOf(req.post).length || !schedule.isEnded(req.post, t)) return sendError(res, 409, 'sale_not_ended', 'You can list leftovers for donation once the sale has ended.');
    if (req.post.hidden) return sendError(res, 403, 'post_unavailable', 'This sale is unavailable.');
    if (req.lot && req.lot.status === 'claimed') return sendError(res, 409, 'lot_claimed', 'Someone has claimed this lot. Release the claim first to change it.');
    const unsold = await models.SaleItem.findAll({ where: { postId: req.post.id, sold: false }, attributes: ['id'], order: [['position', 'ASC'], ['id', 'ASC']] });
    const v = donations.validate(req.body, unsold, t);
    if (v.errors) return badRequest(res, 'Invalid donation lot.', v.errors);
    const fields = { sellerId: req.post.userId, status: 'open', itemIds: JSON.stringify(v.value.itemIds), note: v.value.note, slots: JSON.stringify(v.value.slots), slotMinutes: v.value.slotMinutes,
      timeZone: req.post.timeZone || schedule.defaultTimeZone(), lat: req.post.lat, lng: req.post.lng, claimerId: null, claimOrg: null, chosenAt: null, claimedAt: null, conversationId: null, doneAt: null };
    const fresh = !req.lot || req.lot.status !== 'open';
    let lot = req.lot;
    if (lot) await lot.update(fields); else lot = await models.DonationLot.create(Object.assign({ postId: req.post.id }, fields));
    if (fresh) await donations.notifyNearby(lot, req.post);
    return res.status(req.lot ? 200 : 201).json(await full(lot, req.user));
  } catch (err) { return serverError(res, err); }
});

router.delete('/:postId', requireLogin, load, seller, async (req, res) => {
  const lot = req.lot;
  if (!lot || lot.status === 'cancelled' || lot.status === 'done') return NONE(res);
  try {
    const claimer = lot.status === 'claimed' ? lot.claimerId : null;
    const [n] = await models.DonationLot.update({ status: 'cancelled' }, { where: { id: lot.id, status: lot.status } });
    if (!n) return CHANGED(res);
    if (claimer) await donations.notifyChange(lot, req.post, claimer, 'withdrawn', req.user);
    return res.status(204).end();
  } catch (err) { return serverError(res, err); }
});

router.post('/:postId/claim', requireLogin, requireVerified, load, async (req, res) => {
  const lot = req.lot;
  const me = req.user.id;
  const b = req.body || {};
  if (!lot || lot.status === 'cancelled' || lot.status === 'done') return NONE(res);
  if (lot.sellerId === me) return forbidden(res, "You can't claim your own donation lot.");
  if (req.user.messagingBanned) return sendError(res, 403, 'messaging_banned', 'A moderator has turned off messaging for your account. You can still read your conversations.');
  const org = typeof b.org === 'string' ? b.org.trim().replace(/\s+/g, ' ') : '';
  if (b.org !== undefined && b.org !== null && typeof b.org !== 'string') return badRequest(res, 'Invalid claim.', { org: 'Must be text.' });
  if (org.length > donations.ORG_MAX) return badRequest(res, 'Invalid claim.', { org: 'Keep it to ' + donations.ORG_MAX + ' characters.' });
  try {
    if (req.post.hidden) return NONE(res);
    const blocks = await msg.blockState(me, lot.sellerId);
    if (blocks.byMe || blocks.byThem) return NONE(res);
    if (lot.status !== 'open') return sendError(res, 409, 'lot_claimed', 'Someone already claimed this lot.');
    const t = schedule.now();
    const slot = typeof b.slot === 'string' ? donations.futureSlots(lot, t).find((s) => Math.abs(new Date(s).getTime() - new Date(b.slot).getTime()) < 60000) : null;
    if (!slot) return badRequest(res, 'Invalid claim.', { slot: 'Pick one of the pickup times offered.' });
    if (await models.DonationLot.count({ where: { claimerId: me, status: 'claimed' } }) >= MAX_CLAIMS) {
      return sendError(res, 429, 'too_many', 'You can have up to ' + MAX_CLAIMS + ' donation pickups at a time.');
    }
    const [conv] = await models.Conversation.findOrCreate({ where: { postId: lot.postId, buyerId: me, sellerId: lot.sellerId }, defaults: { postTitle: req.post.title } });
    const [n] = await models.DonationLot.update({ status: 'claimed', claimerId: me, claimOrg: org || null, chosenAt: new Date(slot), claimedAt: t, conversationId: conv.id },
      { where: { id: lot.id, status: 'open' } });
    if (!n) return sendError(res, 409, 'lot_claimed', 'Someone already claimed this lot.');
    await lot.reload();
    await donations.notifyChange(lot, req.post, lot.sellerId, 'claimed', req.user);
    return res.json(await full(lot, req.user));
  } catch (err) { return serverError(res, err); }
});

async function reopen(req, res, who, event) {
  const lot = req.lot;
  if (!lot || lot.status !== 'claimed') return CHANGED(res);
  if (who === 'claimer' && lot.claimerId !== req.user.id) return forbidden(res, 'Only the person who claimed it can do this.');
  try {
    const other = who === 'claimer' ? lot.sellerId : lot.claimerId;
    const [n] = await models.DonationLot.update({ status: 'open', claimerId: null, claimOrg: null, chosenAt: null, claimedAt: null, conversationId: null },
      { where: { id: lot.id, status: 'claimed', claimerId: lot.claimerId } });
    if (!n) return CHANGED(res);
    await donations.notifyChange(lot, req.post, other, event, req.user);
    await lot.reload();
    return res.json(await full(lot, req.user));
  } catch (err) { return serverError(res, err); }
}
router.post('/:postId/unclaim', requireLogin, load, (req, res) => reopen(req, res, 'claimer', 'unclaimed'));
router.post('/:postId/release', requireLogin, load, seller, (req, res) => reopen(req, res, 'seller', 'released'));

router.post('/:postId/done', requireLogin, load, seller, async (req, res) => {
  const lot = req.lot;
  if (!lot || lot.status !== 'claimed') return CHANGED(res);
  try {
    const [n] = await models.DonationLot.update({ status: 'done', doneAt: schedule.now() }, { where: { id: lot.id, status: 'claimed' } });
    if (!n) return CHANGED(res);
    await donations.notifyChange(lot, req.post, lot.claimerId, 'done', req.user);
    await lot.reload();
    return res.json(await full(lot, req.user));
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
