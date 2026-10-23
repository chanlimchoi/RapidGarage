// POST /holds/:id/accept { hours? }  seller: set the item aside (1-72 h, default
//                                     until an hour after the pickup time, else HOLD_HOURS)
// POST /holds/:id/counter { offerCents } seller: answer an offer with a higher price
// POST /holds/:id/take               buyer: take the counteroffer (reserves at that price)
// POST /holds/:id/decline            seller
// POST /holds/:id/release            seller: end an accepted hold early
// POST /holds/:id/cancel             buyer: withdraw a request or give up a hold
// Requests are made inside a conversation: POST /conversations/:id/holds.
// Only the two participants can see or act on a hold (everyone else: 404).
const router = require('express').Router();
const { Op } = require('sequelize');
const models = require('../models');
const { badRequest, notFound, sendError, serverError, requireLogin, parseId } = require('../lib/http');
const holds = require('../lib/holds');
const msg = require('../lib/messaging');

router.use(requireLogin);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

async function loadHold(req, res, next) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Hold id must be a positive integer.');
  try {
    await holds.sweep();
    const hold = await models.ItemHold.findByPk(id, { include: [{ model: models.SaleItem, as: 'item' }] });
    if (!hold || (hold.buyerId !== req.user.id && hold.sellerId !== req.user.id)) return notFound(res, 'Hold not found.');
    req.hold = hold;
    return next();
  } catch (err) { return serverError(res, err); }
}
const asSeller = (req, res, next) => (req.hold.sellerId === req.user.id ? next() : sendError(res, 403, 'forbidden', 'Only the seller can do this.'));
const asBuyer = (req, res, next) => (req.hold.buyerId === req.user.id ? next() : sendError(res, 403, 'forbidden', 'Only the buyer can do this.'));
const stateError = (res) => sendError(res, 409, 'hold_closed', 'This hold is no longer open.');
const json = (req, h) => holds.holdJSON(h, req.user.id);

async function canAct(req, res) {
  if (req.user.messagingBanned) { sendError(res, 403, 'messaging_banned', 'A moderator has turned off messaging for your account. You can still read your conversations.'); return false; }
  const other = req.hold.buyerId === req.user.id ? req.hold.sellerId : req.hold.buyerId;
  const b = await msg.blockState(req.user.id, other);
  if (b.byMe || b.byThem) { sendError(res, 403, 'blocked', "You can't message this person."); return false; }
  return true;
}

// Reserve the item for an open request and mark it accepted. `by`: who acts
// (the seller accepting, or the buyer taking a counteroffer); `fields`: extra
// hold fields (the agreed price). Sends the response.
async function reserve(req, res, hours, fields, event, cents, guard) {
  const h = req.hold;
  const post = await models.Post.findByPk(h.postId, { include: [{ model: models.SaleDay, as: 'saleDays' }] });
  const item = h.item;
  const t = holds.now();
  if (!post || !item || item.sold) return sendError(res, 409, 'item_unavailable', 'This item is no longer available.');
  if (item.reservedUntil && new Date(item.reservedUntil) > t) return sendError(res, 409, 'item_reserved', 'This item is already reserved.');
  const expiresAt = holds.acceptExpiry(h, post, hours, t);
  if (expiresAt <= t) return sendError(res, 409, 'sale_ended', 'This sale has ended.');
  // Reserve the item first, atomically, so two accepts can't both win it.
  const [reserved] = await models.SaleItem.update({ reservedUntil: expiresAt },
    { where: { id: item.id, sold: false, [Op.or]: [{ reservedUntil: null }, { reservedUntil: { [Op.lte]: t } }] } });
  if (!reserved) return sendError(res, 409, 'item_reserved', 'This item is already reserved.');
  const [changed] = await models.ItemHold.update(Object.assign({ status: 'accepted', expiresAt, decidedAt: t }, fields), { where: Object.assign({ id: h.id, status: 'pending' }, guard) });
  if (!changed) { await models.SaleItem.update({ reservedUntil: null }, { where: { id: item.id, reservedUntil: expiresAt } }); return stateError(res); }
  await h.reload({ include: [{ model: models.SaleItem, as: 'item' }] });
  await holds.postEvent(h, event, req.user.id, item.name, cents);
  // Other people waiting for the same item: it's taken.
  const others = await models.ItemHold.findAll({ where: { itemId: item.id, status: 'pending', id: { [Op.ne]: h.id } } });
  for (const o of others) {
    await o.update({ status: 'declined', endedReason: 'taken', decidedAt: t });
    await holds.postEvent(o, 'declined', o.sellerId, item.name);
  }
  return res.json(json(req, h));
}

// ---- bundles (lib/bundles.js): the seller answers the whole bundle ---------
const withItem = { include: [{ model: models.SaleItem, as: 'item' }], order: [['id', 'ASC']] };
const names = (rows) => rows.map((x) => (x.item && x.item.name) || 'an item').join(', ');
const total = (rows) => rows.reduce((s, x) => s + (x.offerCents || 0), 0);

async function bundleRows(h, statuses) {
  return models.ItemHold.findAll(Object.assign({ where: { bundleKey: h.bundleKey, status: statuses } }, withItem));
}

// Accept every pending hold in the bundle, or none: each item is reserved
// atomically and the reservations are undone if any item was taken meanwhile.
async function acceptBundle(req, res, hours) {
  const h = req.hold;
  const rows = await bundleRows(h, ['pending']);
  const post = await models.Post.findByPk(h.postId, { include: [{ model: models.SaleDay, as: 'saleDays' }] });
  const t = holds.now();
  if (!post || rows.some((x) => !x.item || x.item.sold)) return sendError(res, 409, 'item_unavailable', 'This item is no longer available.');
  const expiresAt = holds.acceptExpiry(h, post, hours, t);
  if (expiresAt <= t) return sendError(res, 409, 'sale_ended', 'This sale has ended.');
  const done = [];
  const undo = async () => { for (const x of done) await models.SaleItem.update({ reservedUntil: null }, { where: { id: x.itemId, reservedUntil: expiresAt } }); };
  for (const x of rows) {
    const [ok] = await models.SaleItem.update({ reservedUntil: expiresAt },
      { where: { id: x.itemId, sold: false, [Op.or]: [{ reservedUntil: null }, { reservedUntil: { [Op.lte]: t } }] } });
    if (!ok) { await undo(); return sendError(res, 409, 'item_reserved', 'This item is already reserved.'); }
    done.push(x);
  }
  const [changed] = await models.ItemHold.update({ status: 'accepted', expiresAt, decidedAt: t, counterCents: null }, { where: { id: rows.map((x) => x.id), status: 'pending' } });
  if (changed !== rows.length) {
    // Someone cancelled part of it meanwhile: put everything back.
    await models.ItemHold.update({ status: 'pending', decidedAt: null }, { where: { id: rows.map((x) => x.id), status: 'accepted', decidedAt: t } });
    await undo();
    return stateError(res);
  }
  await holds.postEvent(h, 'bundle_accepted', req.user.id, names(rows), total(rows));
  const others = await models.ItemHold.findAll({ where: { itemId: rows.map((x) => x.itemId), status: 'pending', id: { [Op.notIn]: rows.map((x) => x.id) } }, include: [{ model: models.SaleItem, as: 'item' }] });
  for (const o of others) {
    await o.update({ status: 'declined', endedReason: 'taken', decidedAt: t });
    await holds.postEvent(o, 'declined', o.sellerId, o.item && o.item.name);
  }
  await h.reload({ include: [{ model: models.SaleItem, as: 'item' }] });
  return res.json(json(req, h));
}

// Decline, release or cancel every hold of the bundle still in `from`.
async function closeBundle(req, res, from, status, event) {
  const h = req.hold;
  const rows = await bundleRows(h, from);
  if (!rows.length) return stateError(res);
  const t = holds.now();
  const ended = [];
  for (const x of rows) {
    const [changed] = await models.ItemHold.update({ status, decidedAt: t }, { where: { id: x.id, status: x.status } });
    if (!changed) continue;
    if (x.status === 'accepted') await holds.clearReservation(x);
    ended.push(x);
  }
  if (!ended.length) return stateError(res);
  await holds.postEvent(h, event, req.user.id, names(ended));
  await h.reload({ include: [{ model: models.SaleItem, as: 'item' }] });
  return res.json(json(req, h));
}

// Accepting an offer agrees to the buyer's price (any counteroffer is dropped).
router.post('/:id/accept', loadHold, asSeller, async (req, res) => {
  const h = req.hold;
  const hours = holds.parseHours((req.body || {}).hours);
  if (hours.error) return badRequest(res, 'Invalid hold.', { hours: hours.error });
  try {
    if (h.status !== 'pending') return stateError(res);
    if (!(await canAct(req, res))) return undefined;
    if (h.bundleKey) return await acceptBundle(req, res, hours.value);
    return await reserve(req, res, hours.value, { counterCents: null }, 'accepted', h.offerCents);
  } catch (err) { return serverError(res, err); }
});

// POST /holds/:id/counter { offerCents } seller: answer an offer with a higher
// price (up to the asking price). The buyer can take it, which reserves the
// item at that price; the request gets a fresh answer window.
router.post('/:id/counter', loadHold, asSeller, async (req, res) => {
  const h = req.hold;
  try {
    if (h.status !== 'pending') return stateError(res);
    if (h.bundleKey) return sendError(res, 409, 'bundle', 'A bundle is accepted or declined as a whole. Message the buyer to change it.');
    if (!h.offerCents) return sendError(res, 409, 'no_offer', 'There is no offer to counter.');
    if (!h.item || h.item.sold) return sendError(res, 409, 'item_unavailable', 'This item is no longer available.');
    const counter = holds.parseOffer((req.body || {}).offerCents, h.item, h.offerCents);
    if (counter.error || counter.value === null) return badRequest(res, 'Invalid offer.', { offerCents: counter.error || 'Enter an amount in dollars, like 5 or 4.50.' });
    if (!(await canAct(req, res))) return undefined;
    const post = await models.Post.findByPk(h.postId, { include: [{ model: models.SaleDay, as: 'saleDays' }] });
    const t = holds.now();
    const expiresAt = post ? holds.requestExpiry(post, t) : t;
    if (expiresAt <= t) return sendError(res, 409, 'sale_ended', 'This sale has ended.');
    const [changed] = await models.ItemHold.update({ counterCents: counter.value, expiresAt }, { where: { id: h.id, status: 'pending' } });
    if (!changed) return stateError(res);
    await h.reload({ include: [{ model: models.SaleItem, as: 'item' }] });
    await holds.postEvent(h, 'countered', req.user.id, h.item.name, counter.value);
    return res.json(json(req, h));
  } catch (err) { return serverError(res, err); }
});

// POST /holds/:id/take buyer: agree to the seller's counteroffer; the item is
// reserved at that price (default hold length).
router.post('/:id/take', loadHold, asBuyer, async (req, res) => {
  const h = req.hold;
  try {
    if (h.status !== 'pending') return stateError(res);
    if (!h.counterCents) return sendError(res, 409, 'no_offer', 'There is no counteroffer to take.');
    if (!(await canAct(req, res))) return undefined;
    const price = h.counterCents;
    return await reserve(req, res, null, { offerCents: price, counterCents: null }, 'agreed', price, { counterCents: price });
  } catch (err) { return serverError(res, err); }
});

async function close(req, res, from, status, event) {
  const h = req.hold;
  try {
    if (from.indexOf(h.status) === -1) return stateError(res);
    if (!(await canAct(req, res))) return undefined;
    if (h.bundleKey) return await closeBundle(req, res, from, status, 'bundle_' + event);
    const wasAccepted = h.status === 'accepted';
    const [changed] = await models.ItemHold.update({ status, decidedAt: holds.now() }, { where: { id: h.id, status: h.status } });
    if (!changed) return stateError(res);
    if (wasAccepted) await holds.clearReservation(h);
    await h.reload({ include: [{ model: models.SaleItem, as: 'item' }] });
    await holds.postEvent(h, event, req.user.id, h.item && h.item.name);
    return res.json(json(req, h));
  } catch (err) { return serverError(res, err); }
}
router.post('/:id/decline', loadHold, asSeller, (req, res) => close(req, res, ['pending'], 'declined', 'declined'));
router.post('/:id/release', loadHold, asSeller, (req, res) => close(req, res, ['accepted'], 'released', 'released'));
router.post('/:id/cancel', loadHold, asBuyer, (req, res) => close(req, res, ['pending', 'accepted'], 'cancelled', 'cancelled'));

module.exports = router;
