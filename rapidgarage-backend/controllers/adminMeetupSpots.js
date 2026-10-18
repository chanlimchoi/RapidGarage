// Admin CRUD for "Safe meetup spots" (see lib/meetups.js). Mounted inside
// controllers/admin.js, so every route is behind requireLogin + requireAdmin.
// Nothing here touches conversations: admins still can't read them unless reported.
//   GET    /admin/meetup-spots?q=&active=     list (name/city search)
//   POST   /admin/meetup-spots                create
//   PUT    /admin/meetup-spots/:id            update (any subset of fields)
//   DELETE /admin/meetup-spots/:id            delete (past suggestions keep their copy of the place)
// Without lat/lng the address is geocoded with the server key (if set).
const router = require('express').Router();
const { Op } = require('sequelize');
const models = require('../models');
const { badRequest, notFound, sendError, serverError, parseId } = require('../lib/http');
const meetups = require('../lib/meetups');
const geo = require('../lib/geo');

const serverGeocodeKey = () => String(process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim() || null;

// Fill lat/lng from the address when they weren't given. -> error message or null.
async function locate(values, existing) {
  if (values.lat !== undefined) return null;
  const address = ['address', 'city', 'state'].map((f) => (values[f] !== undefined ? values[f] : existing && existing[f])).filter(Boolean).join(', ');
  const moved = ['address', 'city', 'state'].some((f) => values[f] !== undefined && (!existing || values[f] !== existing[f]));
  if (existing && !moved) return null;
  const key = serverGeocodeKey();
  if (!key || !address) return 'Add the latitude and longitude (no server geocoding key is set, or there is no address to look up).';
  const r = await geo.geocodeAddress(address, key);
  if (r.status !== 'ok') return "Couldn't find that address. Add the latitude and longitude.";
  values.lat = r.lat; values.lng = r.lng;
  return null;
}

router.get('/meetup-spots', async (req, res) => {
  try {
    const where = {};
    if (req.query.active === 'true') where.active = true;
    if (req.query.active === 'false') where.active = false;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    if (q) where[Op.or] = ['name', 'city', 'state', 'address'].map((f) => models.sequelize.where(models.sequelize.fn('lower', models.sequelize.col(f)), { [Op.like]: '%' + q.toLowerCase().replace(/[%_\\]/g, '') + '%' }));
    const rows = await models.MeetupSpot.findAll({ where, order: [['state', 'ASC'], ['city', 'ASC'], ['name', 'ASC']], limit: 500 });
    return res.json({ results: rows.map((s) => meetups.spotJSON(s, true)), kinds: models.MeetupSpot.KINDS, geocoding: !!serverGeocodeKey() });
  } catch (err) { return serverError(res, err); }
});

router.post('/meetup-spots', async (req, res) => {
  const { errors, values } = meetups.validateSpot(req.body || {}, false);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid meetup spot.', errors);
  try {
    const where = await locate(values, null);
    if (where) return badRequest(res, 'Invalid meetup spot.', { lat: where });
    const s = await models.MeetupSpot.create(Object.assign(values, { createdBy: req.user.id, updatedBy: req.user.id }));
    return res.status(201).json(meetups.spotJSON(s, true));
  } catch (err) { return serverError(res, err); }
});

router.put('/meetup-spots/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Spot id must be a positive integer.');
  const { errors, values } = meetups.validateSpot(req.body || {}, true);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid meetup spot.', errors);
  if (!Object.keys(values).length) return badRequest(res, 'Nothing to change.');
  try {
    const s = await models.MeetupSpot.findByPk(id);
    if (!s) return notFound(res, 'Meetup spot not found.');
    const where = await locate(values, s);
    if (where) return badRequest(res, 'Invalid meetup spot.', { lat: where });
    await s.update(Object.assign(values, { updatedBy: req.user.id }));
    return res.json(meetups.spotJSON(s, true));
  } catch (err) { return serverError(res, err); }
});

router.delete('/meetup-spots/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Spot id must be a positive integer.');
  try {
    const s = await models.MeetupSpot.findByPk(id);
    if (!s) return notFound(res, 'Meetup spot not found.');
    await models.MeetupProposal.update({ spotId: null }, { where: { spotId: id } });
    await s.destroy();
    return res.status(204).end();
  } catch (err) {
    if (err && err.name === 'SequelizeForeignKeyConstraintError') return sendError(res, 409, 'conflict', 'This spot is still in use. Turn it off instead.');
    return serverError(res, err);
  }
});

module.exports = router;
