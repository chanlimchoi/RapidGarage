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
    req.login(user, () =>
      res.send(user)
    );
  }).catch(() => {
      res.send('error')
  });
});

module.exports = router;
