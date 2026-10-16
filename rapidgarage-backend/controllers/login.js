const passport = require('../middlewares/authentication');
const router = require('express').Router();
const { badRequest, unauthorized } = require('../lib/http');
const { applyAdminBootstrap } = require('../lib/roles');

router.post('/', (req, res, next) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return badRequest(res, 'Email and password are required.');
  }
  // Emails are stored lower-cased at signup.
  req.body.email = email.trim().toLowerCase();
  passport.authenticate('local', (err, user) => {
    if (err) return next(err);
    // Same message for unknown email and wrong password (no account enumeration).
    if (!user) return unauthorized(res, 'Incorrect email or password.');
    // Local emails are unverified: only promoted if ADMIN_BOOTSTRAP_LOCAL=true.
    applyAdminBootstrap(user, false).then((u) => {
      req.logIn(u, (loginErr) => {
        if (loginErr) return next(loginErr);
        return res.json({ success: true, user: u.toJSON() });
      });
    }).catch(next);
  })(req, res, next);
});

module.exports = router;
