const router = require('express').Router();
const models = require('../models');
const secretBox = require('../lib/secretBox');
const { userMapsKeysEnabled } = require('../lib/features');
const { sendError, serverError } = require('../lib/http');

// Which Maps key should this browser load the script with?
//   1. the logged-in user's own key (decrypted, returned only to its owner)
//   2. the server-wide GOOGLE_MAPS_API_KEY, if set
//   3. none → 404 { code: 'no_maps_key' } so the UI can prompt for one
// Maps JS keys are browser keys and become visible in the page anyway; owners
// must restrict them by HTTP referrer and API in Google Cloud Console.
router.get('/key', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const serverKey = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
  return userMapsKeysEnabled().then((byok) => {
    const fallback = () => {
      if (serverKey) return res.json({ key: serverKey, source: 'server' });
      // With BYOK off, don't prompt users to add a key they can't add.
      if (!byok) return sendError(res, 404, 'no_maps_key', 'The map is unavailable on this server.');
      return sendError(res, 404, 'no_maps_key', req.user
        ? 'Add your Google Maps API key in Settings to see the map.'
        : 'Log in and add your Google Maps API key in Settings to see the map.');
    };

    // With BYOK off, stored user keys are never read.
    if (!byok || !req.user || !req.user.mapsKeyLast4) return fallback();
    return models.User.scope('withMapsKey').findByPk(req.user.id)
      .then((user) => {
        if (!user || !user.mapsKeyEncrypted) return fallback();
        let key;
        try {
          key = secretBox.decrypt(user.mapsKeyEncrypted);
        } catch (err) {
          // Wrong/rotated KEY_ENCRYPTION_SECRET: don't leak details, fall back.
          console.error('Could not decrypt a stored Maps key for user', user.id);
          return fallback();
        }
        return res.json({ key, source: 'user' });
      })
      .catch((err) => serverError(res, err));
  }).catch((err) => serverError(res, err));
});

module.exports = router;
