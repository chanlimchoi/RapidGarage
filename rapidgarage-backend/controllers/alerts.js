// Saved sale alerts (login required) + the public signed unsubscribe link.
const router = require('express').Router();
const models = require('../models');
const { badRequest, notFound, sendError, serverError, requireLogin, parseId } = require('../lib/http');
const geo = require('../lib/geo');
const { PRICE_CAP } = require('../lib/price');
const { saleAlertsEnabled } = require('../lib/features');
const alerts = require('../lib/alerts');

const LABEL_MAX = 80;

// Validate a create (partial=false) or update (partial=true) body.
// Location is { lat, lng } or { address } (geocoded on the server).
function validate(body, partial) {
  const errors = {};
  const values = {};
  const has = (k) => body[k] !== undefined;
  if (has('label')) {
    if (body.label !== null && typeof body.label !== 'string') errors.label = 'Name must be text.';
    else if (body.label && body.label.trim().length > LABEL_MAX) errors.label = 'Keep the name under ' + LABEL_MAX + ' characters.';
    else values.label = body.label ? body.label.trim() : null;
  }
  if (has('lat') || has('lng')) {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!geo.isLat(lat) || !geo.isLng(lng) || body.lat === null || body.lng === null || body.lat === '' || body.lng === '') errors.location = 'Location must be a valid latitude and longitude.';
    else { values.lat = lat; values.lng = lng; }
  } else if (has('address')) {
    if (typeof body.address !== 'string' || !body.address.trim()) errors.location = 'Enter an address or zip code.';
    else if (body.address.trim().length > 200) errors.location = 'Address is too long.';
  } else if (!partial) errors.location = 'Choose a location: an address, your current location or the map.';
  if (has('radiusMiles') || !partial) {
    const r = Number(body.radiusMiles);
    if (!Number.isInteger(r) || r < alerts.RADIUS_MIN || r > alerts.RADIUS_MAX) errors.radiusMiles = 'Radius must be a whole number of miles from ' + alerts.RADIUS_MIN + ' to ' + alerts.RADIUS_MAX + '.';
    else values.radiusMiles = r;
  }
  if (has('maxPrice')) {
    if (body.maxPrice === null || body.maxPrice === '') values.maxPrice = null;
    else {
      const p = Number(body.maxPrice);
      if (!Number.isInteger(p) || p < 0 || p > PRICE_CAP) errors.maxPrice = 'Max price must be whole dollars from 0 to ' + PRICE_CAP + '.';
      else values.maxPrice = p;
    }
  }
  ['freeOnly', 'enabled'].forEach((k) => {
    if (!has(k)) return;
    if (typeof body[k] !== 'boolean') errors[k] = k + ' must be true or false.';
    else values[k] = body[k];
  });
  if (values.freeOnly) values.maxPrice = null;
  return { errors, values };
}

// Geocode body.address into values (or answer the error). Returns false if it answered.
async function resolveAddress(req, res, body, values) {
  if (values.lat !== undefined || body.address === undefined) return true;
  const key = await geo.resolveGeocodeKey(req.user);
  if (!key) {
    sendError(res, 400, 'geocode_unavailable', "Address lookup isn't available on this server. Use your current location or the map instead.", { location: 'Use your current location or the map.' });
    return false;
  }
  if (!geo.allowClientGeocode('user:' + req.user.id, Date.now())) {
    sendError(res, 429, 'rate_limited', 'Too many address lookups. Please wait a minute.');
    return false;
  }
  const r = await geo.geocodeAddress(body.address, key);
  if (r.status !== 'ok') {
    const msg = r.status === 'not_found' ? "We couldn't find that address." : 'Address lookup failed. Please try again.';
    badRequest(res, msg, { location: msg });
    return false;
  }
  values.lat = r.lat;
  values.lng = r.lng;
  if (values.label === undefined || values.label === null) values.label = body.address.trim().slice(0, LABEL_MAX);
  return true;
}

// ---- public: one-click unsubscribe (no login) ---------------------------
// POST /alerts/unsubscribe { a, t } (or ?a=&t= for RFC 8058 List-Unsubscribe-Post)
router.post('/unsubscribe', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const body = req.body || {};
  const id = parseId(body.a !== undefined ? body.a : req.query.a);
  const token = body.t !== undefined ? body.t : req.query.t;
  if (!id || typeof token !== 'string' || !token) return sendError(res, 400, 'invalid_token', 'This unsubscribe link is invalid.');
  try {
    const alert = await models.SaleAlert.findByPk(id);
    if (!alert) return res.json({ ok: true, gone: true });
    if (!alerts.verifyToken(alert, token)) return sendError(res, 400, 'invalid_token', 'This unsubscribe link is invalid.');
    if (alert.enabled) await alert.update({ enabled: false });
    await models.AlertNotification.update({ status: 'skipped', lastError: 'unsubscribed' }, { where: { alertId: alert.id, status: 'pending' } });
    return res.json({ ok: true, alert: { id: alert.id, label: alert.label, radiusMiles: alert.radiusMiles, enabled: false } });
  } catch (err) {
    return serverError(res, err);
  }
});

// ---- logged-in CRUD -------------------------------------------------------
router.use(requireLogin);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/', async (req, res) => {
  try {
    const [rows, enabled] = await Promise.all([
      models.SaleAlert.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'ASC']] }),
      saleAlertsEnabled(),
    ]);
    return res.json({ results: rows, limit: alerts.maxPerUser(), globallyEnabled: enabled, radius: { min: alerts.RADIUS_MIN, max: alerts.RADIUS_MAX } });
  } catch (err) {
    return serverError(res, err);
  }
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const { errors, values } = validate(body, false);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid alert.', errors);
  try {
    if (!(await saleAlertsEnabled())) return sendError(res, 403, 'feature_disabled', 'Sale alerts are turned off on this site right now.');
    const count = await models.SaleAlert.count({ where: { userId: req.user.id } });
    if (count >= alerts.maxPerUser()) return sendError(res, 409, 'limit_reached', 'You can have up to ' + alerts.maxPerUser() + ' alerts. Delete one to add another.');
    if (!(await resolveAddress(req, res, body, values))) return undefined;
    const alert = await models.SaleAlert.create(Object.assign({ enabled: true, freeOnly: false, maxPrice: null }, values, { userId: req.user.id }));
    return res.status(201).json(alert);
  } catch (err) {
    return serverError(res, err);
  }
});

async function loadOwn(req, res, next) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Alert id must be a positive integer.');
  try {
    const alert = await models.SaleAlert.findByPk(id);
    if (!alert || alert.userId !== req.user.id) return notFound(res, 'Alert not found.');
    req.alert = alert;
    return next();
  } catch (err) {
    return serverError(res, err);
  }
}

router.put('/:id', loadOwn, async (req, res) => {
  const body = req.body || {};
  const { errors, values } = validate(body, true);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid alert.', errors);
  try {
    if (!(await resolveAddress(req, res, body, values))) return undefined;
    if (!Object.keys(values).length) return badRequest(res, 'Nothing to update.');
    await req.alert.update(values);
    if (values.enabled === false) {
      await models.AlertNotification.update({ status: 'skipped', lastError: 'alert_disabled' }, { where: { alertId: req.alert.id, status: 'pending' } });
    }
    return res.json(req.alert);
  } catch (err) {
    return serverError(res, err);
  }
});

router.delete('/:id', loadOwn, async (req, res) => {
  try {
    await models.AlertNotification.destroy({ where: { alertId: req.alert.id } });
    await req.alert.destroy();
    return res.status(204).end();
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
