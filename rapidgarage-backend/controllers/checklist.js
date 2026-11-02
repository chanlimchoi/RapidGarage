// /post/:id/checklist (seller only, lib/checklist.js): the sale-day checklist.
//   GET    /             the list (the default one is created on first open)
//   POST   /             { label, dueDays } add a to-do (0-14 days before the sale)
//   PUT    /settings     { remind } reminders on/off
//   PUT    /:itemId      { label?, dueDays?, done? }
//   DELETE /:itemId
//   POST   /reset        back to the default list
// req.post is loaded and owner-checked by post.js.
const router = require('express').Router({ mergeParams: true });
const models = require('../models');
const { badRequest, notFound, sendError, serverError, parseId } = require('../lib/http');
const checklist = require('../lib/checklist');
const schedule = require('../lib/schedule');

router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const reply = async (req, res, status) => {
  const post = await models.Post.findByPk(req.post.id, { include: [{ model: models.SaleDay, as: 'saleDays' }] });
  return res.status(status || 200).json(await checklist.list(post));
};

router.get('/', async (req, res) => {
  try { await checklist.ensure(req.post); return await reply(req, res); } catch (err) { return serverError(res, err); }
});

router.post('/', async (req, res) => {
  const v = checklist.validate(req.body || {}, false);
  if (v.errors) return badRequest(res, 'Invalid checklist item.', v.errors);
  try {
    await checklist.ensure(req.post);
    const n = await models.SaleChecklistItem.count({ where: { postId: req.post.id } });
    if (n >= checklist.MAX_ITEMS) return sendError(res, 409, 'too_many', 'A checklist can have up to ' + checklist.MAX_ITEMS + ' items.');
    await models.SaleChecklistItem.create({ postId: req.post.id, label: v.values.label, dueDays: v.values.dueDays, position: n });
    return await reply(req, res, 201);
  } catch (err) { return serverError(res, err); }
});

router.put('/settings', async (req, res) => {
  const remind = (req.body || {}).remind;
  if (typeof remind !== 'boolean') return badRequest(res, 'Invalid request.', { remind: 'remind must be true or false.' });
  try {
    await models.Post.update({ checklistRemind: remind }, { where: { id: req.post.id } });
    return await reply(req, res);
  } catch (err) { return serverError(res, err); }
});

router.post('/reset', async (req, res) => {
  try {
    await models.SaleChecklistItem.destroy({ where: { postId: req.post.id } });
    await checklist.ensure(req.post);
    return await reply(req, res);
  } catch (err) { return serverError(res, err); }
});

async function loadItem(req, res, next) {
  const id = parseId(req.params.itemId);
  try {
    const item = id && await models.SaleChecklistItem.findOne({ where: { id, postId: req.post.id } });
    if (!item) return notFound(res, 'Checklist item not found.');
    req.item = item;
    return next();
  } catch (err) { return serverError(res, err); }
}

router.put('/:itemId', loadItem, async (req, res) => {
  const v = checklist.validate(req.body || {}, true);
  if (v.errors) return badRequest(res, 'Invalid checklist item.', v.errors);
  try {
    const fields = {};
    if (v.values.label !== undefined) { fields.label = v.values.label; fields.key = null; }
    if (v.values.dueDays !== undefined) fields.dueDays = v.values.dueDays;
    if (v.values.done !== undefined) fields.doneAt = v.values.done ? (req.item.doneAt || schedule.now()) : null;
    await req.item.update(fields);
    return await reply(req, res);
  } catch (err) { return serverError(res, err); }
});

router.delete('/:itemId', loadItem, async (req, res) => {
  try { await req.item.destroy(); return await reply(req, res); } catch (err) { return serverError(res, err); }
});

module.exports = router;
