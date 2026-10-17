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
const events = require('../lib/events');
const scans = require('../lib/scans');
const wanted = require('../lib/wanted');
const curbside = require('../lib/curbside');
const calendar = require('../lib/calendar');

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
    // Sale alerts and wanted posts: match in the background; never slows or fails the request.
    alerts.schedulePostMatch(post);
    wanted.schedulePost(post.id);
  } catch (err) {
    serverError(res, err);
  }
});

router.use('/:id/photos', requireLogin, loadPost, (req, res, next) => requireOwnerOrAdmin(req, res, next), require('./photos'));

router.use('/:id/items', loadPost, require('./items'));
router.use('/:id/curbside', loadPost, require('./curbside'));
// QR code, flyers, sign and scan counts (login first, so logged-out callers get 401).
router.use('/:id/print', requireLogin, loadPost, require('./print'));

router.use('/:id/report', requireLogin, loadPost, require('./report'));

// Sale page view beacon (seller dashboard). Always 204, whether or not it was
// counted: counted like QR scans (lib/scans.js kind 'view'), never for hidden
// sales, bots, prefetches, the seller or admins.
router.post('/:id/view', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Post id must be a positive integer.');
  try {
    const post = await Post.findByPk(id, { attributes: ['id', 'userId', 'timeZone', 'hidden'] });
    if (!post) return notFound(res, 'Post not found.');
    if (!post.hidden) await scans.record(req, post, 'view');
    return res.status(204).end();
  } catch (err) { return serverError(res, err); }
});

// Share button beacon (seller dashboard "Shares"). Always 204; counted like
// views (once per person per day, never bots or hidden sales), but the
// seller's own shares count. Only the number per day is stored; which
// channel was used is checked but not kept.
const SHARE_CHANNELS = ['native', 'copy', 'facebook', 'whatsapp', 'x', 'kakao'];
router.post('/:id/share', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Post id must be a positive integer.');
  const channel = (req.body || {}).channel;
  if (channel !== undefined && SHARE_CHANNELS.indexOf(channel) === -1) return badRequest(res, 'Unknown share channel.');
  try {
    const post = await Post.findByPk(id, { attributes: ['id', 'userId', 'timeZone', 'hidden'] });
    if (!post) return notFound(res, 'Post not found.');
    if (!post.hidden) await scans.record(req, post, 'share');
    return res.status(204).end();
  } catch (err) { return serverError(res, err); }
});

// The seller is shown as "First L." with their rating summary; never an email.
// GET /post/:id/calendar.ics : every day of the sale (removed days CANCELLED).
// Same visibility as the sale page; 404 for a sale without dates.
router.get('/:id/calendar.ics', loadPost, (req, res) => {
  try {
    if (!(req.post.saleDays || []).length) return notFound(res, 'This sale has no dates yet.');
    return calendar.send(res, calendar.postEvents(req.post), req.post.title, calendar.fileName(req.post.title, 'sale-' + req.post.id));
  } catch (err) { return serverError(res, err); }
});

router.get('/:id', loadPost, async (req, res) => {
  try {
    const owner = await models.User.findByPk(req.post.userId, { attributes: ['id', 'firstName', 'lastName'] });
    const seller = owner ? Object.assign(publicUser(owner), { rating: await ratings.summaryOf(owner.id) }) : null;
    const ev = (await events.eventsForPosts([req.post.id], req.user)).get(req.post.id) || null;
    const json = Object.assign(req.post.toJSON(), { seller }, ev ? { event: ev } : {});
    await curbside.annotate([json], req.user, { marks: true });
    return res.json(json);
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
    // Any change (title, description, price, place, dates) may make it match a
    // wanted post now; each (wanted post, sale) pair is only ever told once.
    wanted.schedulePost(post.id);
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
