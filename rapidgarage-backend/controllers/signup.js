const router = require('express').Router();
const models = require('../models');
const User = models.User;

router.post('/', (req, res) => {
  User.create({
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    email: req.body.email,
    password: req.body.password,
  }).then((user) => {
    res.send('heyyy')
    // req.login(user, () =>
    //   res.send('went through')
    // );
  }).catch(() => {
      res.send('error')
  });
});

module.exports = router;
