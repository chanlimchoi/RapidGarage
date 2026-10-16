const router = require('express').Router();
const passport = require('../middlewares/authentication');
const { notFound } = require('../lib/http');

const FRONTEND_ORIGIN = () => process.env.FRONTEND_ORIGIN || 'http://localhost:3000';

// Lets the frontend decide whether to show the "Sign in with Google" button.
router.get('/providers', (req, res) => {
  res.json({ local: true, google: !!passport.googleConfig() });
});

router.get('/google', (req, res, next) => {
  if (!passport.ensureGoogleStrategy()) return notFound(res, 'Google sign-in is not configured.');
  return passport.authenticate('google', { scope: ['openid', 'email', 'profile'], prompt: 'select_account' })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  if (!passport.ensureGoogleStrategy()) return notFound(res, 'Google sign-in is not configured.');
  return passport.authenticate('google', (err, user, info) => {
    const back = FRONTEND_ORIGIN();
    if (err || !user) {
      const reason = (info && info.message) || (err ? 'server_error' : 'denied');
      return res.redirect(back + '/login?googleError=' + encodeURIComponent(reason));
    }
    return req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      return res.redirect(back + '/');
    });
  })(req, res, next);
});

module.exports = router;
