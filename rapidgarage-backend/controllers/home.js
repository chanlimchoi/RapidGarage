const express = require('express');
const models = require('../models');
const { badRequest, notFound, serverError, parseId } = require('../lib/http');
const { ZIP_RE } = require('../lib/validate');

const router = express.Router();
const newestFirst = { order: [['createdAt', 'DESC']] };

// Destroy the passport session.
router.post('/logout', (req, res, next) => {
  req.logout();
  if (!req.session) return res.json({ success: true });
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    return res.json({ success: true });
  });
});

router.get('/allPosts', (req, res) => {
  models.Post.findAll(newestFirst)
    .then((posts) => res.json(posts))
    .catch((err) => serverError(res, err));
});

router.get('/profile/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'User id must be a positive integer.');
  models.User.findById(id)
    .then((user) => (user ? res.json(user) : notFound(res, 'User not found.')))
    .catch((err) => serverError(res, err));
});

router.get('/all/:zipCode', (req, res) => {
  const zipCode = req.params.zipCode;
  if (!ZIP_RE.test(zipCode)) return badRequest(res, 'Zip code must be 5 digits.');
  models.Post.findAll(Object.assign({ where: { zipCode } }, newestFirst))
    .then((posts) => res.json(posts))
    .catch((err) => serverError(res, err));
});

router.get('/allbyuserId/:userId', (req, res) => {
  const userId = parseId(req.params.userId);
  if (!userId) return badRequest(res, 'User id must be a positive integer.');
  models.Post.findAll(Object.assign({ where: { userId } }, newestFirst))
    .then((posts) => res.json(posts))
    .catch((err) => serverError(res, err));
});

// The old catch-all GET /:id (which shadowed other routes) is replaced by GET /post/:id.

module.exports = router;
