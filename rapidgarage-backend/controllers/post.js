const router = require('express').Router();
const models = require('../models');
const { badRequest, forbidden, notFound, sendError, serverError, requireLogin, parseId } = require('../lib/http');
const { validatePost } = require('../lib/validate');
const { isAdmin } = require('../lib/roles');
const { removePhotoFiles } = require('./photos');
const { geocodePost } = require('../lib/geo');
const mod = require('../lib/moderation');
const alerts = require('../lib/alerts');
const favorites = require('../lib/favorites');
const schedule = require('../lib/schedule');
const ratings = require('../lib/ratings');
const { publicUser } = require('../lib/people');
const events = require('../lib/events');
const scans = require('../lib/scans');
const wanted = require('../lib/wanted');
const follows = require('../lib/follows');
const aiReview = require('../lib/aiReview');
const { requireVerified } = require('../lib/emailVerify');
const curbside = require('../lib/curbside');
const calendar = require('../lib/calendar');
const sellerTools = require('../lib/sellerTools');
const aiItems = require('../lib/aiItems');
const aiAccess = require('../lib/aiAccess');
const i18n = require('../lib/i18n');
const listingSuggest = require('../lib/listingSuggest');
const multer = require('multer');
const { MAX_FILE_BYTES, sniffImageType } = require('../lib/photos');

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

// Photo-to-listing: suggest a title, category and price range from one photo
// (multipart field "photo", optional) and the words typed so far ("hint").
// Nothing is stored: not the photo, not the suggestion.
const suggestUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 4, parts: 6 },
}).single('photo');
router.post('/suggest', requireLogin, (req, res, next) => suggestUpload(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return sendError(res, 413, 'file_too_large', 'Each photo must be 8 MB or smaller.');
  return badRequest(res, 'Invalid upload.');
}), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const file = req.file || null;
  if (file && !sniffImageType(file.buffer)) return sendError(res, 415, 'unsupported_type', `"${file.originalname}" is not a JPEG, PNG or WebP image.`);
  try {
    const out = await listingSuggest.suggest({
      userId: req.user.id, buf: file ? file.buffer : null, fileName: file ? file.originalname : '',
      hint: req.body && typeof req.body.hint === 'string' ? req.body.hint : '', lang: i18n.requestLang(req),
    });
    return res.json(out);
  } catch (err) { return serverError(res, err); }
});

// Create: the owner is always the session user, never a body userId.
// body.schedule ({ timeZone, days }) wins over the legacy startDate/endDate.
router.post('/', requireLogin, requireVerified, async (req, res) => {
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
    // People who follow the seller hear about new sales (not edits).
    follows.schedulePost(post);
    // AI listing review for admins (advisory; lib/aiReview.js).
    aiReview.schedule(post.id);
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

// Duplicate a sale for next time: same details, prices, markdown, unsold items
// and photo copies; no dates. Hidden (moderated) sales can't be copied.
router.post('/:id/duplicate', requireLogin, requireVerified, loadPost, requireOwner, async (req, res) => {
  if (req.post.hidden) return forbidden(res, "A hidden sale can't be duplicated.");
  try {
    const id = await sellerTools.duplicate(req.post);
    const post = await reload({ id });
    res.status(201).json(post);
    // Like a new sale (POST /): alerts, wanted posts, followers, AI review.
    alerts.schedulePostMatch(post);
    wanted.schedulePost(post.id);
    follows.schedulePost(post);
    aiReview.schedule(post.id);
  } catch (err) { serverError(res, err); }
  return undefined;
});

// How the sale went (owner only): items sold, views, saves, conversations.
router.get('/:id/summary', requireLogin, loadPost, requireOwner, async (req, res) => {
  try { return res.json(await sellerTools.summary(req.post)); } catch (err) { return serverError(res, err); }
});

// "Write title & description with AI": a suggestion only; the seller edits
// and saves it with PUT /:id. body: { oneTimeKey? } (same key rules as item drafts).
router.post('/:id/describe', requireLogin, loadPost, requireOwner, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const body = req.body || {};
  // Out of the request right away, so nothing later can see it.
  const oneTime = body.oneTimeKey;
  delete body.oneTimeKey;
  let apiKey = null;
  try {
    const picked = await aiAccess.pickKey(req, oneTime, 'Writing with AI is turned off on this server.');
    if (picked.error) return aiAccess.sendPicked(res, picked.error);
    apiKey = picked.apiKey;
    const source = picked.source;
    const photos = (req.post.photos || []).slice().sort((a, b) => a.position - b.position || a.id - b.id);
    const list = (req.post.items || []).slice().sort((a, b) => a.position - b.position || a.id - b.id);
    if (!photos.length && !list.length) return badRequest(res, 'Add photos or items first, then write with AI.');
    if (!(await aiAccess.takeBudget(req.user.id, source))) {
      res.set('Retry-After', '3600');
      return sendError(res, 429, 'rate_limited', "You've used today's AI requests. Try again tomorrow.");
    }
    try {
      const out = await aiItems.describe(req.post, list, photos, i18n.requestLang(req), apiKey ? { apiKey } : null);
      apiKey = null;
      return res.json(Object.assign(out, { keySource: source }));
    } catch (err) {
      await aiAccess.giveBack(req.user.id, source);
      if (err.code === 'own_key_rejected') return sendError(res, 400, 'own_key_rejected', 'Anthropic rejected that key. Check it in the Anthropic Console, or update the one saved in Settings.');
      if (err.code === 'refused') return sendError(res, 422, 'ai_refused', "Couldn't write a description for this sale. Please write it yourself.");
      if (err.code === 'truncated' || err.code === 'bad_output') return sendError(res, 502, 'ai_failed', 'The AI answer came back incomplete. Please try again.');
      if (err.code === 'ai_rate_limited') { res.set('Retry-After', '60'); return sendError(res, 503, 'ai_busy', 'The AI is busy right now. Please try again in a minute.'); }
      console.error('AI describe failed for post ' + req.post.id + ':', err.code, err.cause ? (err.cause.status || err.cause.name) : err.message);
      return sendError(res, 503, 'ai_unavailable', "AI writing isn't available right now. Please try again later.");
    }
  } catch (err) { return serverError(res, err); } finally { apiKey = null; }
});


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
    const before = { priceMin: req.post.priceMin, priceMax: req.post.priceMax, isFree: req.post.isFree };
    let post = await req.post.update(values);
    if (sched.value) await schedule.saveSchedule(models, post, sched.value);
    // Legacy startDate/endDate replace any day-by-day schedule.
    else if (legacyDates) await schedule.saveSchedule(models, post, { timeZone: null, days: [], startDate: post.startDate, endDate: post.endDate });
    if (moved) post = await geocodePost(post, req.user);
    post = await reload(post);
    res.json(post);
    // A sale that moved (or only now has coordinates) can match alerts;
    // the (user, post) unique index means nobody is told twice.
    // Saved searches with words are re-checked on any edit (the title may now match).
    alerts.schedulePostMatch(post, moved ? undefined : { keywordOnly: true });
    // Cheaper (or now free): people who favorited it hear about it.
    favorites.schedule(() => favorites.postEdited(post, before));
    // Any change (title, description, price, place, dates) may make it match a
    // wanted post now; each (wanted post, sale) pair is only ever told once.
    wanted.schedulePost(post.id);
    // Text may have changed: review again (unchanged text is skipped by hash).
    aiReview.schedule(post.id);
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
    .then(() => require('../lib/activity').forget('post', req.post.id))
    .then(() => req.post.destroy())
    .then(() => res.status(204).end())
    .catch((err) => serverError(res, err));
});

// ---- rain checks (lib/weather.js, lib/rainChecks.js) --------------------------
// GET /post/:id/weather : the forecast for the sale's upcoming days (Open-Meteo,
// cached), or { weather: null } when off or unavailable. Never an error page.
router.get('/:id/weather', loadPost, async (req, res) => {
  try {
    const w = await require('../lib/weather').saleWeather(req.post, req.post.saleDays || [], schedule.now());
    const isOwner = !!(req.user && req.user.id === req.post.userId);
    const rain = isOwner ? require('../lib/rainChecks').firstBad(w, req.post) : null;
    res.set('Cache-Control', isOwner ? 'private, no-store' : 'private, max-age=600');
    return res.json({ weather: w, rainCheck: rain && !schedule.isEnded(req.post) ? rain : null });
  } catch (err) { return res.json({ weather: null, rainCheck: null }); }
});

// POST /post/:id/postpone { byDays: 1-14 } | { schedule } (owner): move the sale
// later. Everyone who saved it hears about the new date (bell + push).
router.post('/:id/postpone', requireLogin, loadPost, requireOwner, async (req, res) => {
  const rc = require('../lib/rainChecks');
  const body = req.body || {};
  const t = schedule.now();
  try {
    const before = (req.post.saleDays || []).filter((d) => new Date(d.endsAt) > t).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    if (!before.length || schedule.isEnded(req.post)) return sendError(res, 409, 'sale_ended', 'This sale has no upcoming days to postpone.');
    let raw;
    if (body.schedule !== undefined) raw = body.schedule;
    else {
      const n = Number(body.byDays);
      if (!Number.isInteger(n) || n < 1 || n > rc.MAX_SHIFT_DAYS) return badRequest(res, 'Invalid request.', { byDays: 'Postpone by 1 to ' + rc.MAX_SHIFT_DAYS + ' days.' });
      raw = rc.shiftedSchedule(req.post, before, n, t);
    }
    const sched = schedule.validateSchedule(raw, true);
    if (Object.keys(sched.errors).length) return badRequest(res, 'Invalid schedule.', sched.errors);
    if (!sched.value.days.length) return badRequest(res, 'Invalid schedule.', { schedule: 'Pick at least one new day.' });
    if (new Date(sched.value.days[0].startsAt) <= new Date(before[0].startsAt)) return badRequest(res, 'Invalid schedule.', { schedule: 'Pick a later start than the current one to postpone.' });
    await schedule.saveSchedule(models, req.post, sched.value);
    await req.post.update({ postponedAt: t, postponedFrom: before[0].date, rainCheckDismissed: null });
    const post = await reload(req.post);
    const first = sched.value.days[0];
    const told = await rc.notifyPostponed(post, before[0].date, first);
    return res.json({ post, told });
  } catch (err) { return serverError(res, err); }
});

// POST /post/:id/rain-check/dismiss { date } (owner): keep the date; no more prompt for it.
router.post('/:id/rain-check/dismiss', requireLogin, loadPost, requireOwner, async (req, res) => {
  const date = (req.body || {}).date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest(res, 'Invalid request.', { date: 'date must be YYYY-MM-DD.' });
  try {
    await req.post.update({ rainCheckDismissed: date });
    return res.json({ ok: true });
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
