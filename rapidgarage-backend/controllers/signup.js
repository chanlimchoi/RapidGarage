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
    // Never send the stored (hashed) password back to the client.
    const safeUser = user.toJSON();
    delete safeUser.password;
    req.login(safeUser, () =>
      res.json(safeUser)
    );
  }).catch((err) => {
      console.log('Failure creating user:', err.message);
      res.status(400).json({ msg: 'failed to create user' });
  });
});

module.exports = router;
