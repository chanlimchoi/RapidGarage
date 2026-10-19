const router = require('express').Router();
const models = require('../models');
const secretBox = require('../lib/secretBox');
const i18n = require('../lib/i18n');
const bcrypt = require('bcrypt-nodejs');
const passwordReset = require('../lib/passwordReset');
const userAiKey = require('../lib/userAiKey');
const { keysOverHttps } = require('../lib/runtime');
const { userMapsKeysEnabled, userAiKeysEnabled } = require('../lib/features');
const { badRequest, unauthorized, notFound, sendError, serverError, requireLogin } = require('../lib/http');

// The server is the source of truth for who is logged in.
router.get('/', (req, res) => {
  if (!req.user) return unauthorized(res, 'Not logged in.');
  return res.json({ user: req.user.toJSON ? req.user.toJSON() : req.user });
});

// Google Maps browser keys are ~39 chars of [A-Za-z0-9_-] and start with "AIza".
const MAPS_KEY_RE = /^AIza[0-9A-Za-z_-]{20,80}$/;

function noStore(res) {
  res.set('Cache-Control', 'no-store');
}

function status(user) {
  return { hasKey: !!user.mapsKeyLast4, last4: user.mapsKeyLast4 || null };
}

// When the operator turns BYOK off (ENABLE_USER_MAPS_KEYS=false), these
// endpoints act as if they don't exist and never read or write stored keys.
// Stored keys are left untouched so turning the flag back on restores them.
function requireUserMapsKeys(req, res, next) {
  return userMapsKeysEnabled().then((on) => {
    if (!on) return sendError(res, 404, 'feature_disabled', 'Personal Google Maps keys are turned off on this server.');
    return next();
  }).catch((err) => serverError(res, err));
}
router.use('/maps-key', requireUserMapsKeys);

// Masked status for the settings page (never the key itself).
router.get('/maps-key', requireLogin, (req, res) => {
  noStore(res);
  res.json(status(req.user));
});

router.put('/maps-key', requireLogin, (req, res) => {
  noStore(res);
  if (!secretBox.isConfigured()) {
    return sendError(res, 503, 'not_configured', 'Saving keys is disabled: the server has no KEY_ENCRYPTION_SECRET.');
  }
  const key = req.body && typeof req.body.key === 'string' ? req.body.key.trim() : '';
  if (!MAPS_KEY_RE.test(key)) {
    return badRequest(res, 'That does not look like a Google Maps API key (they start with "AIza").');
  }
  models.User.findByPk(req.user.id)
    .then((user) => {
      if (!user) return notFound(res, 'User not found.');
      return user.update({ mapsKeyEncrypted: secretBox.encrypt(key), mapsKeyLast4: key.slice(-4) })
        .then((u) => res.json(status(u)));
    })
    .catch((err) => serverError(res, err));
});

router.delete('/maps-key', requireLogin, (req, res) => {
  noStore(res);
  models.User.findByPk(req.user.id)
    .then((user) => {
      if (!user) return notFound(res, 'User not found.');
      return user.update({ mapsKeyEncrypted: null, mapsKeyLast4: null }).then(() => res.status(204).end());
    })
    .catch((err) => serverError(res, err));
});

// The account's language (also sent as Accept-Language by the web app, which
// wins per request). Alert emails use this one.
router.put('/locale', requireLogin, (req, res) => {
  noStore(res);
  const code = req.body && typeof req.body.locale === 'string' ? i18n.CODES.find((c) => c.toLowerCase() === req.body.locale.trim().toLowerCase()) : null;
  if (!code) return badRequest(res, 'Choose a language: ' + i18n.CODES.join(', ') + '.');
  models.User.findByPk(req.user.id)
    .then((user) => {
      if (!user) return notFound(res, 'User not found.');
      return user.update({ locale: code }).then((u) => res.json({ locale: u.locale }));
    })
    .catch((err) => serverError(res, err));
});

// ---- Own Anthropic key (lib/userAiKey.js) --------------------------------
// GET shows only whether one is saved and its last 4 characters. PUT saves
// (password required when the account has one, checked with Anthropic first,
// HTTPS only in production); DELETE erases it at once.
function requireUserAiKeys(req, res, next) {
  return userAiKeysEnabled().then((on) => {
    if (!on) return sendError(res, 404, 'feature_disabled', 'Using your own AI key is turned off on this server.');
    return next();
  }).catch((err) => serverError(res, err));
}
router.use('/ai-key', requireUserAiKeys);

router.get('/ai-key', requireLogin, async (req, res) => {
  noStore(res);
  try { return res.json(await userAiKey.status(req.user.id)); } catch (err) { return serverError(res, err); }
});

router.put('/ai-key', requireLogin, async (req, res) => {
  noStore(res);
  const body = req.body || {};
  const raw = body.key;
  delete body.key; // keep it out of anything that might log the body
  if (!secretBox.isConfigured()) return sendError(res, 503, 'not_configured', 'Saving keys is disabled: the server has no KEY_ENCRYPTION_SECRET.');
  if (!keysOverHttps(req)) return badRequest(res, 'Keys can only be sent over HTTPS.');
  if (!(await userAiKey.takeAttempt(req.user.id))) { res.set('Retry-After', '3600'); return sendError(res, 429, 'rate_limited', 'Too many key attempts. Please try again later.'); }
  const key = userAiKey.normalize(raw);
  if (!key) return badRequest(res, 'Invalid request.', { key: 'That does not look like an Anthropic API key (they start with "sk-ant-").' });
  try {
    const user = await models.User.scope('withPassword').findByPk(req.user.id);
    if (!user) return notFound(res, 'User not found.');
    if (user.password) {
      let ok = false;
      try { ok = typeof body.currentPassword === 'string' && bcrypt.compareSync(body.currentPassword, user.password); } catch (e) { ok = false; }
      if (!ok) return badRequest(res, 'Invalid request.', { currentPassword: 'Your current password is incorrect.' });
    }
    const check = await userAiKey.verify(key);
    if (check === 'rejected') return sendError(res, 400, 'own_key_rejected', 'Anthropic rejected that key. Check it in the Anthropic Console, or update the one saved in Settings.');
    if (check !== 'ok') return sendError(res, 503, 'ai_unavailable', "Couldn't check the key with Anthropic right now. Please try again.");
    await userAiKey.save(user, key);
    return res.json(await userAiKey.status(user.id));
  } catch (err) { return serverError(res, err); }
});

router.delete('/ai-key', requireLogin, async (req, res) => {
  noStore(res);
  try {
    const user = await models.User.findByPk(req.user.id, { attributes: ['id', 'email', 'firstName', 'locale', 'aiKeyLast4'] });
    if (!user) return notFound(res, 'User not found.');
    await userAiKey.remove(user);
    return res.json(await userAiKey.status(user.id));
  } catch (err) { return serverError(res, err); }
});

// Whether the account has a password of its own (Google-only accounts don't),
// so Settings knows whether to ask for the current one.
router.get('/password', requireLogin, (req, res) => {
  noStore(res);
  models.User.scope('withPassword').findByPk(req.user.id)
    .then((user) => (user ? res.json({ hasPassword: !!user.password }) : notFound(res, 'User not found.')))
    .catch((err) => serverError(res, err));
});

// Change (or, for Google-only accounts, add) a password. Signs out every other
// session; this one stays logged in.
router.put('/password', requireLogin, async (req, res, next) => {
  noStore(res);
  const body = req.body || {};
  const pwError = passwordReset.passwordError(body.newPassword);
  if (pwError) return badRequest(res, 'Invalid request.', { newPassword: pwError });
  try {
    const user = await models.User.scope('withPassword').findByPk(req.user.id);
    if (!user) return notFound(res, 'User not found.');
    if (user.password) {
      let ok = false;
      try { ok = typeof body.currentPassword === 'string' && bcrypt.compareSync(body.currentPassword, user.password); } catch (e) { ok = false; }
      if (!ok) return badRequest(res, 'Invalid request.', { currentPassword: 'Your current password is incorrect.' });
    }
    const updated = await passwordReset.setPassword(user.id, body.newPassword);
    return req.login(updated, (err) => (err ? next(err) : res.json({ ok: true })));
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
