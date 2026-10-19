const router = require('express').Router();
const passport = require('../middlewares/authentication');
const { userMapsKeysEnabled, saleAlertsEnabled, wantedEnabled } = require('../lib/features');
const { serverError } = require('../lib/http');
const mailer = require('../lib/mailer');

// Public, non-secret configuration the frontend uses to decide what to show.
router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  Promise.all([userMapsKeysEnabled(), saleAlertsEnabled(), wantedEnabled()])
    .then(([userMapsKeys, saleAlerts, wantedPosts]) => res.json({ googleLogin: !!passport.googleConfig(), userMapsKeys, saleAlerts, wantedPosts, passwordReset: mailer.isConfigured() }))
    .catch((err) => serverError(res, err));
});

module.exports = router;
