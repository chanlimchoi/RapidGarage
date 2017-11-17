const passport = require('../middlewares/authentication');
const router = require('express').Router();

router.post('/', (req, res) => {
  passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login',
  })(req, res);
});

module.exports = router;
