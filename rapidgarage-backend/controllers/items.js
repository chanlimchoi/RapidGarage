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
const aiItems = require('../lib/aiItems');
const { aiStatus } = require('../lib/features');
const userAiKey = require('../lib/userAiKey');
const { keysOverHttps } = require('../lib/runtime');
const i18n = require('../lib/i18n');

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
  try {
    // annotate() clears the curbside item flags unless this viewer can see the offer.
    const json = { id: req.post.id, items: (await listOf(req.post)).map((i) => i.toJSON()) };
    await curbside.annotate([json], req.user);
    return res.json({ items: json.items, max: items.MAX_ITEMS });
  } catch (err) { return serverError(res, err); }
});

// Draft items from the sale's photos with Claude (lib/aiItems.js). Returns
// suggestions only; the seller adds the ones they keep with POST / below.
//   body: { photoIds?: [id], oneTimeKey?: "sk-ant-..." } (default: the first 5 photos)
// Key used: a one-time key from the body (used for this call, never stored),
// else the person's saved key, else the site's.
router.post('/suggest', requireLogin, owner, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const body = req.body || {};
  // Take the one-time key out of the request right away so nothing later
  // (logging, error handlers) can see it.
  const oneTime = body.oneTimeKey;
  delete body.oneTimeKey;
  let apiKey = null;
  try {
    const ai = await aiStatus();
    if (!ai.enabled) return sendError(res, 404, 'feature_disabled', 'Drafting items from photos is turned off on this server.');
    let source = 'site';
    if (oneTime !== undefined) {
      if (!ai.userKeys) return sendError(res, 404, 'feature_disabled', 'Using your own AI key is turned off on this server.');
      if (!keysOverHttps(req)) return badRequest(res, 'Keys can only be sent over HTTPS.');
      if (!(await userAiKey.takeAttempt(req.user.id))) { res.set('Retry-After', '3600'); return sendError(res, 429, 'rate_limited', 'Too many key attempts. Please try again later.'); }
      apiKey = userAiKey.normalize(oneTime);
      if (!apiKey) return badRequest(res, 'Invalid request.', { oneTimeKey: 'That does not look like an Anthropic API key (they start with "sk-ant-").' });
      source = 'one_time';
    } else if (ai.userKeys && (apiKey = await userAiKey.load(req.user.id))) {
      source = 'saved';
    } else if (!ai.site) {
      return sendError(res, 400, 'needs_key', 'Add your own Anthropic key in Settings, or paste one to use just once.');
    }
    const all = (req.post.photos || []).slice().sort((a, b) => a.position - b.position || a.id - b.id);
    const want = req.body && req.body.photoIds;
    if (want !== undefined && (!Array.isArray(want) || want.some((id) => !parseId(id)))) return badRequest(res, 'Invalid request.', { photoIds: 'photoIds must be a list of photo ids.' });
    const photos = want ? all.filter((p) => want.map(Number).includes(p.id)) : all;
    if (!photos.length) return badRequest(res, 'Add photos to the sale first, then draft items from them.');
    const bucket = source === 'site' ? req.user.id : 'own:' + req.user.id;
    if (!(await aiItems.takeSlot(bucket, source === 'site' ? aiItems.perDay() : aiItems.perDayOwnKey()))) {
      res.set('Retry-After', '3600');
      return sendError(res, 429, 'rate_limited', "You've used today's item drafts. Try again tomorrow, or add items by hand.");
    }
    try {
      const out = await aiItems.suggest(photos.slice(0, aiItems.MAX_PHOTOS), i18n.requestLang(req), apiKey ? { apiKey } : null);
      apiKey = null;
      const room = Math.max(0, items.MAX_ITEMS - (await models.SaleItem.count({ where: { postId: req.post.id } })));
      return res.json({ suggestions: out.suggestions, room, photosUsed: Math.min(photos.length, aiItems.MAX_PHOTOS), keySource: source });
    } catch (err) {
      await aiItems.giveBack(bucket);
      if (err.code === 'own_key_rejected') return sendError(res, 400, 'own_key_rejected', 'Anthropic rejected that key. Check it in the Anthropic Console, or update the one saved in Settings.');
      if (err.code === 'refused') return sendError(res, 422, 'ai_refused', "Couldn't draft items from these photos. Add items by hand instead.");
      if (err.code === 'truncated' || err.code === 'bad_output') return sendError(res, 502, 'ai_failed', 'The item draft came back incomplete. Please try again.');
      if (err.code === 'ai_rate_limited') { res.set('Retry-After', '60'); return sendError(res, 503, 'ai_busy', 'Item drafting is busy right now. Please try again in a minute.'); }
      console.error('AI item draft failed for post ' + req.post.id + ':', err.code, err.cause ? (err.cause.status || err.cause.name) : err.message);
      return sendError(res, 503, 'ai_unavailable', "Item drafting isn't available right now. Please try again later.");
    }
  } catch (err) { return serverError(res, err); } finally { apiKey = null; }
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
    require('../lib/aiReview').schedule(req.post.id);
    return undefined;
  } catch (err) { return serverError(res, err); }
});

// Add several items at once (e.g. the drafts the seller kept): { items: [...] }.
// All or nothing: one invalid item rejects the request, with errors keyed by
// position ("2.name"). Up to the sale's remaining room.
router.post('/bulk', requireLogin, owner, async (req, res) => {
  const list = req.body && req.body.items;
  if (!Array.isArray(list) || !list.length) return badRequest(res, 'Invalid request.', { items: 'items must be a non-empty list.' });
  const ids = photoIds(req.post);
  const errors = {};
  const values = list.map((b, i) => {
    const v = items.validateItem(b, ids, false);
    Object.keys(v.errors).forEach((k) => { errors[i + '.' + k] = v.errors[k]; });
    return v.value;
  });
  if (Object.keys(errors).length) return badRequest(res, 'Invalid item.', errors);
  try {
    const count = await models.SaleItem.count({ where: { postId: req.post.id } });
    if (count + values.length > items.MAX_ITEMS) return sendError(res, 400, 'too_many', 'A sale can list up to ' + items.MAX_ITEMS + ' items.');
    const last = await models.SaleItem.max('position', { where: { postId: req.post.id } });
    let pos = (Number.isFinite(last) ? last : -1) + 1;
    const rows = values.map((v) => { const sold = v.sold; delete v.sold; return Object.assign(v, soldFields(sold || false), { postId: req.post.id, position: pos++ }); });
    const created = await models.sequelize.transaction((transaction) => models.SaleItem.bulkCreate(rows, { transaction }));
    const fresh = await models.SaleItem.findAll({ where: { id: created.map((c) => c.id).filter(Boolean) } });
    res.status(201).json({ items: sorted(fresh.length ? fresh : created).map((i) => i.toJSON()) });
    wanted.schedulePost(req.post.id);
    require('../lib/aiReview').schedule(req.post.id);
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
