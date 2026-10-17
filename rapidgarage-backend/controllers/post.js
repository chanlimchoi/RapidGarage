const router = require('express').Router();
const models = require('../models');
const { badRequest, forbidden, notFound, serverError, requireLogin, parseId } = require('../lib/http');
const { validatePost } = require('../lib/validate');
const { isAdmin } = require('../lib/roles');
const { removePhotoFiles } = require('./photos');
const { geocodePost } = require('../lib/geo');
const mod = require('../lib/moderation');
const alerts = require('../lib/alerts');
const schedule = require('../lib/schedule');
const ratings = require('../lib/ratings');
const { publicUser } = require('../lib/people');

const ADDRESS_FIELDS = ['street', 'city', 'state', 'zipCode'];

const Post = models.Post;
const photoInclude = { model: models.PostPhoto, as: 'photos' };
const daysInclude = { model: models.SaleDay, as: 'saleDays' };
const itemsInclude = { model: models.SaleItem, as: 'items' };
const photoOrder = [[{ model: models.PostPhoto, as: 'photos' }, 'position', 'ASC']];

// Load the post named by :id (400 if the id is malformed, 404 if missing).
function loadPost(req, res, next) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Post id must be a positive integer.');
  Post.findByPk(id, { include: [photoInclude, daysInclude, itemsInclude], order: photoOrder })
    .then((post) => {
      // Hidden posts look like missing posts to everyone but the owner and admins.
      if (!post || !mod.canSee(req.user, post)) return notFound(res, 'Post not found.');
      req.post = post;
      return next();
    })
    .catch((err) => serverError(res, err));
}

function requireOwner(req, res, next) {
  if (req.post.userId !== req.user.id) return forbidden(res, 'Only the owner can change this post.');
  return next();
}

// Validate body.schedule (if present). Returns { errors, value } (value null when absent).
function readSchedule(body, creating) {
  if (body.schedule === undefined) return { errors: {}, value: null };
  return schedule.validateSchedule(body.schedule, creating);
}

const reload = (post) => Post.findByPk(post.id, { include: [photoInclude, daysInclude, itemsInclude], order: photoOrder });

// Create: the owner is always the session user, never a body userId.
// body.schedule ({ timeZone, days }) wins over the legacy startDate/endDate.
router.post('/', requireLogin, async (req, res) => {
  const body = req.body || {};
  const { errors, values } = validatePost(body, false);
  const sched = readSchedule(body, true);
  Object.assign(errors, sched.errors);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid post.', errors);
  if (sched.value) { delete values.startDate; delete values.endDate; }
  try {
    // Explicit price defaults so the 201 body always has all three price fields.
    let post = await Post.create(Object.assign({ priceMin: null, priceMax: null, isFree: false }, values, { userId: req.user.id }));
    if (sched.value) await schedule.saveSchedule(models, post, sched.value);
    // Geocoding never fails the request; without a key the post just has no coordinates.
    post = await geocodePost(post, req.user);
    post = await reload(post);
    res.status(201).json(post);
    // Sale alerts: match in the background; never slows or fails the request.
    alerts.schedulePostMatch(post);
  } catch (err) {
    serverError(res, err);
  }
});

router.use('/:id/photos', requireLogin, loadPost, (req, res, next) => requireOwnerOrAdmin(req, res, next), require('./photos'));

router.use('/:id/items', loadPost, require('./items'));

router.use('/:id/report', requireLogin, loadPost, require('./report'));

// The seller is shown as "First L." with their rating summary; never an email.
router.get('/:id', loadPost, async (req, res) => {
  try {
    const owner = await models.User.findByPk(req.post.userId, { attributes: ['id', 'firstName', 'lastName'] });
    const seller = owner ? Object.assign(publicUser(owner), { rating: await ratings.summaryOf(owner.id) }) : null;
    return res.json(Object.assign(req.post.toJSON(), { seller }));
  } catch (err) { return serverError(res, err); }
});

router.put('/:id', requireLogin, loadPost, requireOwner, async (req, res) => {
  const body = req.body || {};
  const { errors, values } = validatePost(body, true, req.post);
  const sched = readSchedule(body, false);
  Object.assign(errors, sched.errors);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid post.', errors);
  if (sched.value) { delete values.startDate; delete values.endDate; }
  const legacyDates = !sched.value && (values.startDate !== undefined || values.endDate !== undefined);
  if (!Object.keys(values).length && !sched.value) return badRequest(res, 'Nothing to update.');
  const moved = ADDRESS_FIELDS.some((f) => values[f] !== undefined && values[f] !== req.post[f]);
  try {
    let post = await req.post.update(values);
    if (sched.value) await schedule.saveSchedule(models, post, sched.value);
    // Legacy startDate/endDate replace any day-by-day schedule.
    else if (legacyDates) await schedule.saveSchedule(models, post, { timeZone: null, days: [], startDate: post.startDate, endDate: post.endDate });
    if (moved) post = await geocodePost(post, req.user);
    post = await reload(post);
    res.json(post);
    // A sale that moved (or only now has coordinates) can match alerts;
    // the (user, post) unique index means nobody is told twice.
    if (moved) alerts.schedulePostMatch(post);
  } catch (err) {
    serverError(res, err);
  }
});

// Admins may delete any post (moderation); editing stays owner-only.
function requireOwnerOrAdmin(req, res, next) {
  if (isAdmin(req.user)) return next();
  return requireOwner(req, res, next);
}

router.delete('/:id', requireLogin, loadPost, requireOwnerOrAdmin, (req, res) => {
  // Remove stored files, then the rows (the FK also cascades in Postgres).
  const photos = req.post.photos || [];
  const byAdmin = isAdmin(req.user) && req.user.id !== req.post.userId;
  removePhotoFiles(photos)
    // Open reports are closed, not deleted, so the moderation history stays.
    .then(() => mod.closeOpenReports(req.post.id, { status: 'actioned', action: 'deleted', reviewerId: byAdmin ? req.user.id : null,
      resolutionNote: byAdmin ? null : 'Deleted by the owner.' }))
    .then(() => models.SaleItem.destroy({ where: { postId: req.post.id } }))
    .then(() => models.PostPhoto.destroy({ where: { postId: req.post.id } }))
    .then(() => req.post.destroy())
    .then(() => res.status(204).end())
    .catch((err) => serverError(res, err));
});

module.exports = router;
