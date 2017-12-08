const passport = require('../middlewares/authentication');
const router = require('express').Router();

// router.post('/', (req, res) => {
//   passport.authenticate('local', {
//     successRedirect: '/',
//     failureRedirect: '/login',
//   })(req, res);
// });

router.post('/',  passport.authenticate('local'), (req, res) => {
  console.log('You are logged in')
  return res.json({ success:true, user: req.user});
});

module.exports = router;
