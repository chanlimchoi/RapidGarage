const router = require('express').Router();
const passport = require('../middlewares/authentication');
const { userMapsKeysEnabled, saleAlertsEnabled, wantedEnabled, aiStatus } = require('../lib/features');
const { serverError } = require('../lib/http');
const mailer = require('../lib/mailer');

// Public, non-secret configuration the frontend uses to decide what to show.
router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  Promise.all([userMapsKeysEnabled(), saleAlertsEnabled(), wantedEnabled(), aiStatus()])
    .then(([userMapsKeys, saleAlerts, wantedPosts, ai]) => res.json({
      googleLogin: !!passport.googleConfig(), userMapsKeys, saleAlerts, wantedPosts, passwordReset: mailer.isConfigured(),
      // aiItems: drafting is available; aiSiteKey: the site pays; userAiKeys / userAiKeySave: own keys (one-time / saved).
      aiItems: ai.enabled, aiSiteKey: ai.site, userAiKeys: ai.userKeys, userAiKeySave: ai.userKeySave,
    }))
    .catch((err) => serverError(res, err));
});

module.exports = router;
