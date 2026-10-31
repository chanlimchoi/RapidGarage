// /curb: free stuff at the curb (lib/curbAlerts.js).
//   POST   /             quick post { title?, note?, hours?, lat & lng | street, city?, state?, zipCode }
//                       -> 201 post (add a photo with POST /post/:id/photos). Rate limited.
//   POST   /:id/end      the poster ends it now (it's gone)
//   GET    /alert        my nearby alert (or { alert: null })
//   PUT    /alert        { lat, lng, radiusMiles, enabled? } create or change it
//   DELETE /alert        turn it off (deletes it)
const router = require('express').Router();
const models = require('../models');
const { badRequest, forbidden, notFound, sendError, serverError, requireLogin, parseId } = require('../lib/http');
const { requireVerified } = require('../lib/emailVerify');
const curbAlerts = require('../lib/curbAlerts');
const curbside = require('../lib/curbside');
const schedule = require('../lib/schedule');
const geo = require('../lib/geo');
const i18n = require('../lib/i18n');
const alerts = require('../lib/alerts');
const wanted = require('../lib/wanted');

router.use(requireLogin, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/alert', async (req, res) => {
  try {
    const a = await models.CurbAlert.findOne({ where: { userId: req.user.id } });
    return res.json({ alert: a ? a.toJSON() : null, radii: curbAlerts.RADII });
  } catch (err) { return serverError(res, err); }
});

router.put('/alert', async (req, res) => {
  const { errors, values } = curbAlerts.validateAlert(req.body);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid alert.', errors);
  try {
    const existing = await models.CurbAlert.findOne({ where: { userId: req.user.id } });
    const a = existing ? await existing.update(values) : await models.CurbAlert.create(Object.assign({ enabled: true }, values, { userId: req.user.id }));
    return res.status(existing ? 200 : 201).json({ alert: a.toJSON(), radii: curbAlerts.RADII });
  } catch (err) { return serverError(res, err); }
});

router.delete('/alert', async (req, res) => {
  try {
    await models.CurbAlert.destroy({ where: { userId: req.user.id } });
    return res.status(204).end();
  } catch (err) { return serverError(res, err); }
});

router.post('/', requireVerified, async (req, res) => {
  const { errors, values } = curbAlerts.validatePost(req.body);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid curb post.', errors);
  try {
    const budget = await curbAlerts.canPost(req.user.id);
    if (!budget.ok) {
      res.set('Retry-After', String(budget.retryAfter));
      return sendError(res, 429, 'rate_limited', "You've posted a lot of free stuff lately. Please try again later.");
    }
    let point = values.lat !== undefined ? { lat: values.lat, lng: values.lng } : null;
    if (!point) {
      const r = await geo.geocodeAddress(geo.postAddress(values), await geo.resolveGeocodeKey(req.user));
      if (r.status !== 'ok') return badRequest(res, 'Invalid curb post.', { location: "We couldn't place that address. Use your location instead." });
      point = { lat: r.lat, lng: r.lng };
    }
    const now = schedule.now();
    const until = new Date(now.getTime() + values.hours * 3600000);
    const lang = i18n.requestLang(req);
    const post = await models.Post.create({
      userId: req.user.id, quickCurb: true, isFree: true, priceMin: null, priceMax: null,
      title: values.title || i18n.t(lang, 'curb.defaultTitle'), description: values.note,
      street: values.street, city: values.city, state: values.state, zipCode: values.zipCode,
      lat: point.lat, lng: point.lng, geocodeStatus: 'ok', geocodedAt: new Date(),
      startDate: now, endDate: until,
      curbsideAll: true, curbsideUntil: until, curbsideNote: values.note, curbsideStartedAt: new Date(),
    });
    const full = await models.Post.findByPk(post.id, { include: [{ model: models.PostPhoto, as: 'photos' }, { model: models.SaleDay, as: 'saleDays' }, { model: models.SaleItem, as: 'items' }] });
    const json = full.toJSON();
    await curbside.annotate([json], req.user, { marks: true });
    res.status(201).json(json);
    // Nearby alerts and wanted posts, in the background.
    alerts.track(() => curbAlerts.notifyNearby(full), 'Curb alerts failed for post ' + post.id);
    wanted.schedulePost(post.id);
    require('../lib/aiReview').schedule(post.id);
    return undefined;
  } catch (err) { return serverError(res, err); }
});

router.post('/:id/end', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return notFound(res, 'Post not found.');
  try {
    const post = await models.Post.findByPk(id);
    if (!post || !post.quickCurb || (post.hidden && post.userId !== req.user.id)) return notFound(res, 'Post not found.');
    if (post.userId !== req.user.id) return forbidden(res, 'Only the person who posted it can end it.');
    const now = schedule.now();
    if (new Date(post.endDate) > now) {
      await post.update({ endDate: now, curbsideUntil: now, curbsideGoneAt: post.curbsideGoneAt || new Date(), curbsideGoneSource: post.curbsideGoneSource || 'seller' });
    }
    const json = post.toJSON();
    await curbside.annotate([json], req.user, { marks: false });
    return res.json({ id: post.id, endDate: json.endDate, curbside: json.curbside });
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
