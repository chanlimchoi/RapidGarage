const passport = require('../middlewares/authentication');
const router = require('express').Router();

// Custom callback so we always answer with JSON.
// The default passport.authenticate('local') replies 401 with a plain-text body,
// which the frontend tried to response.json() — that threw and left the UI hanging.
router.post('/', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.status(401).json({
        success: false,
        message: (info && info.message) || 'Incorrect email or password.',
      });
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        return next(loginErr);
      }
      // Strip the stored (hashed) password before returning the user.
      const safeUser = Object.assign({}, user.toJSON ? user.toJSON() : user);
      delete safeUser.password;
      return res.json({ success: true, user: safeUser });
    });
  })(req, res, next);
});

module.exports = router;
