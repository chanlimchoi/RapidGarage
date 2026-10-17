const router = require('express').Router();
const models = require('../models');
const { badRequest, conflict, serverError } = require('../lib/http');
const { validateSignup } = require('../lib/validate');
const { applyAdminBootstrap } = require('../lib/roles');
const i18n = require('../lib/i18n');

const User = models.User;

router.post('/', (req, res, next) => {
  const body = req.body || {};
  const errors = validateSignup(body);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid signup details.', errors);

  const email = body.email.trim().toLowerCase();
  User.findOne({ where: { email } })
    .then((existing) => {
      if (existing) return conflict(res, 'An account with that email already exists.');
      return User.create({
        firstName: body.firstName.trim(),
        lastName: typeof body.lastName === 'string' ? body.lastName.trim() : null,
        email,
        password: body.password,
        // The language the person signed up in (web app sends it), else their browser's.
        locale: i18n.normalize(body.locale) || i18n.fromAcceptLanguage(req.get('Accept-Language')),
      }).then((created) => applyAdminBootstrap(created, false)).then((user) => {
        req.login(user, (err) => {
          if (err) return next(err);
          return res.status(201).json(user.toJSON());
        });
      });
    })
    .catch((err) => {
      if (err && err.name === 'SequelizeUniqueConstraintError') {
        return conflict(res, 'An account with that email already exists.');
      }
      return serverError(res, err);
    });
});

module.exports = router;
