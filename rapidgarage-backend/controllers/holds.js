// POST /holds/:id/accept { hours? }  seller: set the item aside (1-72 h, default
//                                     until an hour after the pickup time, else HOLD_HOURS)
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

router.post('/:id/accept', loadHold, asSeller, async (req, res) => {
  const h = req.hold;
  const hours = holds.parseHours((req.body || {}).hours);
  if (hours.error) return badRequest(res, 'Invalid hold.', { hours: hours.error });
  try {
    if (h.status !== 'pending') return stateError(res);
    if (!(await canAct(req, res))) return undefined;
    const post = await models.Post.findByPk(h.postId, { include: [{ model: models.SaleDay, as: 'saleDays' }] });
    const item = h.item;
    const t = holds.now();
    if (!post || !item || item.sold) return sendError(res, 409, 'item_unavailable', 'This item is no longer available.');
    if (item.reservedUntil && new Date(item.reservedUntil) > t) return sendError(res, 409, 'item_reserved', 'This item is already reserved.');
    const expiresAt = holds.acceptExpiry(h, post, hours.value, t);
    if (expiresAt <= t) return sendError(res, 409, 'sale_ended', 'This sale has ended.');
    // Reserve the item first, atomically, so two accepts can't both win it.
    const [reserved] = await models.SaleItem.update({ reservedUntil: expiresAt },
      { where: { id: item.id, sold: false, [Op.or]: [{ reservedUntil: null }, { reservedUntil: { [Op.lte]: t } }] } });
    if (!reserved) return sendError(res, 409, 'item_reserved', 'This item is already reserved.');
    const [changed] = await models.ItemHold.update({ status: 'accepted', expiresAt, decidedAt: t }, { where: { id: h.id, status: 'pending' } });
    if (!changed) { await models.SaleItem.update({ reservedUntil: null }, { where: { id: item.id, reservedUntil: expiresAt } }); return stateError(res); }
    await h.reload({ include: [{ model: models.SaleItem, as: 'item' }] });
    await holds.postEvent(h, 'accepted', req.user.id, item.name);
    // Other people waiting for the same item: it's taken.
    const others = await models.ItemHold.findAll({ where: { itemId: item.id, status: 'pending', id: { [Op.ne]: h.id } } });
    for (const o of others) {
      await o.update({ status: 'declined', endedReason: 'taken', decidedAt: t });
      await holds.postEvent(o, 'declined', o.sellerId, item.name);
    }
    return res.json(json(req, h));
  } catch (err) { return serverError(res, err); }
});

async function close(req, res, from, status, event) {
  const h = req.hold;
  try {
    if (from.indexOf(h.status) === -1) return stateError(res);
    if (!(await canAct(req, res))) return undefined;
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
