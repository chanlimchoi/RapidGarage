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
      // New accounts must confirm their email before posting or messaging.
      emailVerification: require('../lib/emailVerify').required(),
      // The app reports its own crashes to POST /client-errors (only when error tracking is on).
      errorReporting: require('../lib/errorTracking').enabled(),
      // Photo-to-listing: suggestions come from a vision model (true) or from similar sales (false).
      listingSuggestAi: require('../lib/listingSuggest').isConfigured(),
    }))
    .catch((err) => serverError(res, err));
});

module.exports = router;
