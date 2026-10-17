const express = require('express');
const models = require('../models');
const { badRequest, notFound, serverError, parseId } = require('../lib/http');
const { ZIP_RE } = require('../lib/validate');
const { Op } = require('sequelize');
const { visibleWhere } = require('../lib/moderation');
const { isAdmin } = require('../lib/roles');
const { publicUser } = require('../lib/people');
const schedule = require('../lib/schedule');

// AND a listing filter with the viewer's visibility rule (hidden posts).
// Ended sales drop out of listings, except the owner's and admins' views of a seller's sales.
const visible = (req, where, keepEnded) => ({ [Op.and]: [where || {}, visibleWhere(req.user) || {}, keepEnded ? {} : schedule.notEndedWhere()] });

const router = express.Router();
const newestFirst = {
  include: [{ model: models.PostPhoto, as: 'photos' }, { model: models.SaleDay, as: 'saleDays' }],
  order: [['createdAt', 'DESC'], [{ model: models.PostPhoto, as: 'photos' }, 'position', 'ASC']],
};

// Destroy the passport session.
router.post('/logout', (req, res, next) => {
  req.logout();
  if (!req.session) return res.json({ success: true });
  req.session.destroy((err) => {
    if (err) return next(err);
    // Same attributes as the session cookie, or browsers keep it.
    res.clearCookie('connect.sid', { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    return res.json({ success: true });
  });
});

// ?when=today|weekend|now narrows to sales open in that window (sale's local time).
router.get('/allPosts', (req, res) => {
  const w = schedule.parseWhen(req.query.when);
  if (w.error) return badRequest(res, 'Invalid filter.', { when: w.error });
  models.Post.findAll(Object.assign({ where: visible(req) }, newestFirst))
    .then((posts) => res.json(w.when ? posts.filter((p) => schedule.matchesWhen(p, w.when)) : posts))
    .catch((err) => serverError(res, err));
});

router.get('/profile/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'User id must be a positive integer.');
  models.User.findByPk(id)
    .then((user) => {
      if (!user) return notFound(res, 'User not found.');
      // Full profile (email etc.) only for yourself and admins; everyone else
      // gets first name + last initial.
      if (req.user && (req.user.id === user.id || isAdmin(req.user))) return res.json(user);
      return res.json(Object.assign(publicUser(user), { createdAt: user.createdAt }));
    })
    .catch((err) => serverError(res, err));
});

router.get('/all/:zipCode', (req, res) => {
  const zipCode = req.params.zipCode;
  if (!ZIP_RE.test(zipCode)) return badRequest(res, 'Zip code must be 5 digits.');
  models.Post.findAll(Object.assign({ where: visible(req, { zipCode }) }, newestFirst))
    .then((posts) => res.json(posts))
    .catch((err) => serverError(res, err));
});

router.get('/allbyuserId/:userId', (req, res) => {
  const userId = parseId(req.params.userId);
  if (!userId) return badRequest(res, 'User id must be a positive integer.');
  const own = !!req.user && (req.user.id === userId || isAdmin(req.user));
  models.Post.findAll(Object.assign({ where: visible(req, { userId }, own) }, newestFirst))
    .then((posts) => res.json(posts))
    .catch((err) => serverError(res, err));
});

// The old catch-all GET /:id (which shadowed other routes) is replaced by GET /post/:id.

module.exports = router;
