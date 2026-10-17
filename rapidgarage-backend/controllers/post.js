const router = require('express').Router();
const models = require('../models');
const { badRequest, forbidden, notFound, serverError, requireLogin, parseId } = require('../lib/http');
const { validatePost } = require('../lib/validate');
const { isAdmin } = require('../lib/roles');
const { removePhotoFiles } = require('./photos');

const Post = models.Post;
const photoInclude = { model: models.PostPhoto, as: 'photos' };
const photoOrder = [[{ model: models.PostPhoto, as: 'photos' }, 'position', 'ASC']];

// Load the post named by :id (400 if the id is malformed, 404 if missing).
function loadPost(req, res, next) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Post id must be a positive integer.');
  Post.findByPk(id, { include: [photoInclude], order: photoOrder })
    .then((post) => {
      if (!post) return notFound(res, 'Post not found.');
      req.post = post;
      return next();
    })
    .catch((err) => serverError(res, err));
}

function requireOwner(req, res, next) {
  if (req.post.userId !== req.user.id) return forbidden(res, 'Only the owner can change this post.');
  return next();
}

// Create: the owner is always the session user, never a body userId.
router.post('/', requireLogin, (req, res) => {
  const { errors, values } = validatePost(req.body || {}, false);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid post.', errors);
  Post.create(Object.assign({}, values, { userId: req.user.id }))
    .then((post) => res.status(201).json(post))
    .catch((err) => serverError(res, err));
});

router.use('/:id/photos', requireLogin, loadPost, (req, res, next) => requireOwnerOrAdmin(req, res, next), require('./photos'));

router.get('/:id', loadPost, (req, res) => res.json(req.post));

router.put('/:id', requireLogin, loadPost, requireOwner, (req, res) => {
  const { errors, values } = validatePost(req.body || {}, true);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid post.', errors);
  if (!Object.keys(values).length) return badRequest(res, 'Nothing to update.');
  req.post.update(values)
    .then((post) => res.json(post))
    .catch((err) => serverError(res, err));
});

// Admins may delete any post (moderation); editing stays owner-only.
function requireOwnerOrAdmin(req, res, next) {
  if (isAdmin(req.user)) return next();
  return requireOwner(req, res, next);
}

router.delete('/:id', requireLogin, loadPost, requireOwnerOrAdmin, (req, res) => {
  // Remove stored files, then the rows (the FK also cascades in Postgres).
  const photos = req.post.photos || [];
  removePhotoFiles(photos)
    .then(() => models.PostPhoto.destroy({ where: { postId: req.post.id } }))
    .then(() => req.post.destroy())
    .then(() => res.status(204).end())
    .catch((err) => serverError(res, err));
});

module.exports = router;
