const router = require('express').Router();
const models = require('../models');
const { badRequest, forbidden, notFound, conflict, serverError, requireLogin, parseId } = require('../lib/http');
const { ROLES, isAdmin } = require('../lib/roles');
const { SETTINGS, getAllSettings, setSetting } = require('../lib/features');

function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) return forbidden(res, 'Admins only.');
  return next();
}

router.use(requireLogin, requireAdmin);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const USER_FIELDS = ['id', 'email', 'firstName', 'lastName', 'role', 'createdAt'];

router.get('/users', (req, res) => {
  models.User.findAll({ attributes: USER_FIELDS, order: [['id', 'ASC']] })
    .then((users) => res.json(users.map((u) => {
      const out = {};
      USER_FIELDS.forEach((f) => { out[f] = u.get(f); });
      return out;
    })))
    .catch((err) => serverError(res, err));
});

router.put('/users/:id/role', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'User id must be a positive integer.');
  const role = req.body && req.body.role;
  if (ROLES.indexOf(role) === -1) return badRequest(res, 'Role must be one of: ' + ROLES.join(', ') + '.');
  return models.sequelize.transaction((t) =>
    models.User.findByPk(id, { transaction: t }).then((user) => {
      if (!user) return { status: 404 };
      if (user.role === role) return { status: 200, user };
      if (user.role === 'admin' && role !== 'admin') {
        return models.User.count({ where: { role: 'admin' }, transaction: t }).then((admins) => {
          if (admins <= 1) return { status: 409 };
          return user.update({ role }, { transaction: t }).then((u) => ({ status: 200, user: u }));
        });
      }
      return user.update({ role }, { transaction: t }).then((u) => ({ status: 200, user: u }));
    }))
    .then((r) => {
      if (r.status === 404) return notFound(res, 'User not found.');
      if (r.status === 409) return conflict(res, 'Cannot demote the last admin.');
      const out = {};
      USER_FIELDS.forEach((f) => { out[f] = r.user.get(f); });
      return res.json(out);
    })
    .catch((err) => serverError(res, err));
});

router.get('/settings', (req, res) => {
  getAllSettings().then((s) => res.json(s)).catch((err) => serverError(res, err));
});

router.put('/settings', (req, res) => {
  const body = req.body || {};
  const names = Object.keys(body);
  if (!names.length) return badRequest(res, 'No settings given.');
  const errors = {};
  names.forEach((n) => {
    if (!SETTINGS[n]) errors[n] = 'Unknown setting.';
    else if (typeof body[n] !== SETTINGS[n].type) errors[n] = 'Must be a ' + SETTINGS[n].type + '.';
  });
  if (Object.keys(errors).length) return badRequest(res, 'Invalid settings.', errors);
  return Promise.all(names.map((n) => setSetting(n, body[n])))
    .then(() => getAllSettings())
    .then((s) => res.json(s))
    .catch((err) => serverError(res, err));
});

module.exports = router;
module.exports.requireAdmin = requireAdmin;
