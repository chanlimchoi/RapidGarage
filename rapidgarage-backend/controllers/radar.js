// GET /radar?lat&lng : the buyer wish radar for a place (lib/wishRadar.js),
// e.g. a seller planning a sale. Login required; count-only.
const router = require('express').Router();
const { badRequest, serverError, requireLogin } = require('../lib/http');
const wishRadar = require('../lib/wishRadar');

router.get('/', requireLogin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const lat = req.query.lat === undefined || req.query.lat === '' ? NaN : Number(req.query.lat);
  const lng = req.query.lng === undefined || req.query.lng === '' ? NaN : Number(req.query.lng);
  const errors = {};
  if (!(lat >= -90 && lat <= 90)) errors.lat = 'Choose a place on the map.';
  if (!(lng >= -180 && lng <= 180)) errors.lng = 'Choose a place on the map.';
  if (Object.keys(errors).length) return badRequest(res, 'Invalid request.', errors);
  try { return res.json(await wishRadar.demand({ lat, lng }, { viewerId: req.user.id })); } catch (err) { return serverError(res, err); }
});

module.exports = router;
