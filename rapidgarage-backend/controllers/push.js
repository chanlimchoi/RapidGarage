// Push notifications (lib/push.js).
//   GET    /push/settings        { available, publicKey, prefs, devices }
//   PUT    /push/settings        { messages?, follows?, reminders?, offers?, searches? }
//   POST   /push/subscriptions   { endpoint, keys: { p256dh, auth }, label? } this browser
//   DELETE /push/subscriptions   { endpoint }
//   POST   /push/test            send a test notification to my devices
const router = require('express').Router();
const models = require('../models');
const push = require('../lib/push');
const { badRequest, sendError, serverError, requireLogin } = require('../lib/http');

const PREFS = { messages: 'pushMessages', follows: 'pushFollows', reminders: 'pushReminders', offers: 'pushOffers', searches: 'pushSearches' };

router.use(requireLogin, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

async function settings(userId) {
  const user = await models.User.findByPk(userId, { attributes: ['id'].concat(Object.values(PREFS)) });
  const prefs = {};
  Object.keys(PREFS).forEach((k) => { prefs[k] = !!user.get(PREFS[k]); });
  return { available: push.isConfigured(), publicKey: push.publicKey(), prefs, devices: await push.deviceCount(userId) };
}

router.get('/settings', async (req, res) => {
  try { return res.json(await settings(req.user.id)); } catch (err) { return serverError(res, err); }
});

router.put('/settings', async (req, res) => {
  const body = req.body || {};
  const values = {};
  const errors = {};
  Object.keys(PREFS).forEach((k) => {
    if (body[k] === undefined) return;
    if (typeof body[k] !== 'boolean') errors[k] = k + ' must be true or false.';
    else values[PREFS[k]] = body[k];
  });
  if (Object.keys(errors).length) return badRequest(res, 'Invalid request.', errors);
  try {
    await models.User.update(values, { where: { id: req.user.id } });
    return res.json(await settings(req.user.id));
  } catch (err) { return serverError(res, err); }
});

router.post('/subscriptions', async (req, res) => {
  if (!push.isConfigured()) return sendError(res, 404, 'feature_disabled', "Push notifications aren't set up on this server.");
  try {
    const out = await push.subscribe(req.user.id, req.body || {}, req.body && req.body.label);
    if (out.reason === 'endpoint') return badRequest(res, "This browser's push service isn't supported.");
    if (out.reason === 'keys') return badRequest(res, 'Invalid push subscription.');
    return res.status(201).json(await settings(req.user.id));
  } catch (err) { return serverError(res, err); }
});

router.delete('/subscriptions', async (req, res) => {
  try {
    await push.unsubscribe(req.user.id, req.body && req.body.endpoint);
    return res.json(await settings(req.user.id));
  } catch (err) { return serverError(res, err); }
});

const tests = new Map();
router.post('/test', async (req, res) => {
  if (!push.isConfigured()) return sendError(res, 404, 'feature_disabled', "Push notifications aren't set up on this server.");
  const now = Date.now();
  const recent = (tests.get(req.user.id) || []).filter((t) => now - t < 3600000);
  if (recent.length >= 5) { res.set('Retry-After', '3600'); return sendError(res, 429, 'rate_limited', 'Too many requests. Please slow down and try again shortly.'); }
  tests.set(req.user.id, recent.concat(now));
  try {
    const i18n = require('../lib/i18n');
    const lang = i18n.requestLang(req);
    const delivered = await push.sendTo(req.user.id, null, { title: i18n.t(lang, 'push.testTitle'), body: i18n.t(lang, 'push.testBody'), url: '/settings#notifications', tag: 'test' });
    return res.json({ delivered });
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
