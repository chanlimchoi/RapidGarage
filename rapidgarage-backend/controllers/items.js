// /post/:id/items  - a sale's item list. Anyone who can see the sale can read
// it; the owner adds, edits, reorders and marks items sold; admins may delete
// items (moderation). req.post is loaded (and visibility-checked) by post.js.
const router = require('express').Router({ mergeParams: true });
const models = require('../models');
const { badRequest, forbidden, notFound, sendError, serverError, requireLogin, parseId } = require('../lib/http');
const { isAdmin } = require('../lib/roles');
const items = require('../lib/items');
const schedule = require('../lib/schedule');
const holds = require('../lib/holds');
const wanted = require('../lib/wanted');
const curbside = require('../lib/curbside');

const sorted = (list) => list.slice().sort((a, b) => a.position - b.position || a.id - b.id);
const listOf = async (post) => sorted(await models.SaleItem.findAll({ where: { postId: post.id } }));
const photoIds = (post) => (post.photos || []).map((p) => p.id);

function owner(req, res, next) {
  if (req.post.userId !== req.user.id) return forbidden(res, 'Only the seller can change the item list.');
  return next();
}

async function loadItem(req, res, next) {
  const id = parseId(req.params.itemId);
  if (!id) return notFound(res, 'Item not found.');
  try {
    const item = await models.SaleItem.findOne({ where: { id, postId: req.post.id } });
    if (!item) return notFound(res, 'Item not found.');
    req.item = item;
    return next();
  } catch (err) { return serverError(res, err); }
}

const soldFields = (sold, item) => (sold === undefined || (item && !!item.sold === sold) ? {} : { sold, soldAt: sold ? schedule.now() : null });

router.get('/', async (req, res) => {
  try { return res.json({ items: await listOf(req.post), max: items.MAX_ITEMS }); } catch (err) { return serverError(res, err); }
});

router.post('/', requireLogin, owner, async (req, res) => {
  const { errors, value } = items.validateItem(req.body, photoIds(req.post), false);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid item.', errors);
  try {
    const count = await models.SaleItem.count({ where: { postId: req.post.id } });
    if (count >= items.MAX_ITEMS) return sendError(res, 400, 'too_many', 'A sale can list up to ' + items.MAX_ITEMS + ' items.');
    const last = await models.SaleItem.max('position', { where: { postId: req.post.id } });
    const sold = value.sold;
    delete value.sold;
    const item = await models.SaleItem.create(Object.assign(value, soldFields(sold || false), { postId: req.post.id, position: (Number.isFinite(last) ? last : -1) + 1 }));
    res.status(201).json(item);
    // A new item may be what someone is looking for.
    if (!item.sold) wanted.schedulePost(req.post.id);
    return undefined;
  } catch (err) { return serverError(res, err); }
});

// Reorder: { ids: [...] } must list every item of the sale exactly once.
router.put('/order', requireLogin, owner, async (req, res) => {
  const ids = req.body && req.body.ids;
  try {
    const list = await listOf(req.post);
    const have = list.map((i) => i.id).sort((a, b) => a - b);
    const want = Array.isArray(ids) ? ids.slice().map(Number).sort((a, b) => a - b) : null;
    if (!want || want.length !== have.length || want.some((v, i) => v !== have[i])) {
      return badRequest(res, 'Invalid order.', { ids: 'List every item of this sale once.' });
    }
    await models.sequelize.transaction(async (transaction) => {
      for (let i = 0; i < ids.length; i += 1) {
        await models.SaleItem.update({ position: i }, { where: { id: Number(ids[i]), postId: req.post.id }, transaction });
      }
    });
    return res.json({ items: await listOf(req.post) });
  } catch (err) { return serverError(res, err); }
});

router.put('/:itemId', requireLogin, owner, loadItem, async (req, res) => {
  const { errors, value } = items.validateItem(req.body, photoIds(req.post), true);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid item.', errors);
  if (!Object.keys(value).length) return badRequest(res, 'Nothing to update.');
  const sold = value.sold;
  delete value.sold;
  try {
    const becameSold = sold === true && !req.item.sold;
    const updated = await req.item.update(Object.assign(value, soldFields(sold, req.item)));
    // Sold: an accepted hold is done; people waiting are told it's gone.
    if (becameSold) await holds.itemSold(updated);
    // A curbside item sold (or back): the offer may now be all gone (or not).
    if (sold !== undefined && updated.curbside) await curbside.refreshGone(req.post.id);
    res.json(updated);
    // Renamed, repriced or back on sale: it may match a wanted post now.
    if (!updated.sold && (value.name !== undefined || value.priceCents !== undefined || sold === false)) wanted.schedulePost(req.post.id);
    return undefined;
  } catch (err) { return serverError(res, err); }
});

router.delete('/:itemId', requireLogin, (req, res, next) => (isAdmin(req.user) ? next() : owner(req, res, next)), loadItem, async (req, res) => {
  try {
    const wasCurbside = req.item.curbside;
    await req.item.destroy();
    if (wasCurbside) await curbside.refreshGone(req.post.id);
    return res.status(204).end();
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
