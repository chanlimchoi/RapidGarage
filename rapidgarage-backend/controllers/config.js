const router = require('express').Router();
const passport = require('../middlewares/authentication');
const { userMapsKeysEnabled, saleAlertsEnabled } = require('../lib/features');
const { serverError } = require('../lib/http');

// Public, non-secret configuration the frontend uses to decide what to show.
router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  Promise.all([userMapsKeysEnabled(), saleAlertsEnabled()])
    .then(([userMapsKeys, saleAlerts]) => res.json({ googleLogin: !!passport.googleConfig(), userMapsKeys, saleAlerts }))
    .catch((err) => serverError(res, err));
});

module.exports = router;
