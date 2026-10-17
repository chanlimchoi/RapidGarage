// Saved ("starred") sales and the route that visits them.
const router = require('express').Router();
const models = require('../models');
const { badRequest, notFound, sendError, serverError, requireLogin, parseId } = require('../lib/http');
const { canSee } = require('../lib/moderation');
const { isLat, isLng } = require('../lib/geo');
const schedule = require('../lib/schedule');
const curbside = require('../lib/curbside');
const route = require('../lib/route');

const MAX_SAVED = 200;
const includes = [
  { model: models.PostPhoto, as: 'photos' },
  { model: models.SaleDay, as: 'saleDays' },
];

router.use(requireLogin);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// The viewer's saved posts, newest save first, split by what they may still see.
async function savedPosts(user) {
  const rows = await models.SavedPost.findAll({
    where: { userId: user.id },
    include: [{ model: models.Post, as: 'post', include: includes }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
  });
  const posts = [];
  let unavailable = 0;
  rows.forEach((r) => {
    if (r.post && canSee(user, r.post)) posts.push(r.post);
    else unavailable += 1;
  });
  return { posts, unavailable };
}

// Ids only, for the star buttons. Hidden posts are left out (their stars never show).
router.get('/ids', async (req, res) => {
  try {
    const { posts } = await savedPosts(req.user);
    return res.json({ ids: posts.map((p) => p.id) });
  } catch (err) { return serverError(res, err); }
});

// { results: [post + status], unavailable } where status is open|upcoming|ended|null.
router.get('/', async (req, res) => {
  try {
    const { posts, unavailable } = await savedPosts(req.user);
    const at = schedule.now();
    const results = await curbside.annotate(posts.map((p) => Object.assign(p.toJSON(), { status: schedule.statusOf(p, at) })), req.user);
    return res.json({ results, unavailable, limit: MAX_SAVED });
  } catch (err) { return serverError(res, err); }
});

// Save (idempotent). Only posts the viewer can see; not their own.
router.put('/:postId', async (req, res) => {
  const id = parseId(req.params.postId);
  if (!id) return notFound(res, 'Sale not found.');
  try {
    const post = await models.Post.findByPk(id);
    if (!post || !canSee(req.user, post)) return notFound(res, 'Sale not found.');
    if (post.userId === req.user.id) return sendError(res, 400, 'own_post', "You can't save your own sale.");
    const existing = await models.SavedPost.findOne({ where: { userId: req.user.id, postId: id } });
    if (existing) return res.json({ saved: true, postId: id });
    const count = await models.SavedPost.count({ where: { userId: req.user.id } });
    if (count >= MAX_SAVED) return sendError(res, 400, 'too_many', 'You can save up to ' + MAX_SAVED + ' sales. Remove some first.');
    await models.SavedPost.findOrCreate({ where: { userId: req.user.id, postId: id } });
    return res.status(201).json({ saved: true, postId: id });
  } catch (err) { return serverError(res, err); }
});

// Unsave (idempotent; works even if the post was since hidden).
router.delete('/:postId', async (req, res) => {
  const id = parseId(req.params.postId);
  if (!id) return notFound(res, 'Sale not found.');
  try {
    await models.SavedPost.destroy({ where: { userId: req.user.id, postId: id } });
    return res.json({ saved: false, postId: id });
  } catch (err) { return serverError(res, err); }
});

function readStart(q) {
  if (q.lat === undefined && q.lng === undefined) return { start: null };
  const lat = Number(q.lat);
  const lng = Number(q.lng);
  if (q.lat === '' || q.lng === '' || !isLat(lat) || !isLng(lng)) return { error: 'Enter a valid location.' };
  return { start: { lat, lng } };
}

// GET /saved/route?when=weekend|today|all&lat=&lng=
// Visits saved sales that haven't ended (and match `when`) in nearest-neighbor order.
router.get('/route', async (req, res) => {
  const when = req.query.when === undefined || req.query.when === '' ? 'all' : String(req.query.when);
  if (route.WHEN.indexOf(when) < 0) return badRequest(res, 'Invalid filter.', { when: 'Choose today, this weekend or all upcoming.' });
  const s = readStart(req.query);
  if (s.error) return badRequest(res, s.error, { location: s.error });
  try {
    const at = schedule.now();
    const { posts, unavailable } = await savedPosts(req.user);
    const live = posts.filter((p) => !schedule.isEnded(p, at));
    const candidates = when === 'all' ? live : live.filter((p) => schedule.matchesWhen(p, when, at));
    const r = route.plan(candidates, s.start, at);
    const stops = r.ordered.map((x, i) => ({
      order: i + 1,
      legMiles: x.legMiles,
      status: schedule.statusOf(x.post, at),
      post: x.post.toJSON(),
    }));
    return res.json({
      when,
      start: s.start,
      stops,
      totalMiles: r.totalMiles,
      googleMapsUrl: route.googleMapsUrl(s.start, r.ordered.map((x) => x.post)),
      skipped: {
        ended: posts.length - live.length,
        notInWindow: live.length - candidates.length,
        noLocation: r.noLocation,
        overLimit: r.omitted,
        unavailable,
      },
      maxStops: route.MAX_STOPS,
    });
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
