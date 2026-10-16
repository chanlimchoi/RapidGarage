const router = require('express').Router();
const passport = require('../middlewares/authentication');
const { userMapsKeysEnabled } = require('../lib/features');
const { serverError } = require('../lib/http');

// Public, non-secret configuration the frontend uses to decide what to show.
router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  userMapsKeysEnabled()
    .then((userMapsKeys) => res.json({ googleLogin: !!passport.googleConfig(), userMapsKeys }))
    .catch((err) => serverError(res, err));
});

module.exports = router;
