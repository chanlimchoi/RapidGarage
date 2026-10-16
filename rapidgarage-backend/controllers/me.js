const router = require('express').Router();
const models = require('../models');
const secretBox = require('../lib/secretBox');
const { userMapsKeysEnabled } = require('../lib/features');
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

module.exports = router;
