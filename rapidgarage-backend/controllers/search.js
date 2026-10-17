// GET /search  - posts near a point, sorted by distance, paginated.
//   center: lat & lng (e.g. the browser's location)  OR  q (address / zip, geocoded)
//   radius: 5 | 10 | 25 | 50 miles (default 10)
//   page (default 1), pageSize (default 20, max 50)
//   maxPrice: whole dollars; sales with something at or under it (see lib/price.js)
//   free=true: free sales only (wins over maxPrice)
//   when=today|weekend|now: sales open in that window (sale's local time)
// Ended sales never show up.
// Without a usable geocoding key, q falls back to a plain text/zip match
// (no distances) and the response says so in `notice`.
const router = require('express').Router();
const { Op } = require('sequelize');
const models = require('../models');
const { badRequest, sendError, serverError } = require('../lib/http');
const { ZIP_RE } = require('../lib/validate');
const geo = require('../lib/geo');
const { PRICE_CAP, priceWhere } = require('../lib/price');
const { visibleWhere } = require('../lib/moderation');
const schedule = require('../lib/schedule');

const MAX_PAGE_SIZE = 50;
const MAX_CANDIDATES = 5000; // hard cap on rows pulled by the bounding box
const photoInclude = { model: models.PostPhoto, as: 'photos' };
const photoOrder = [{ model: models.PostPhoto, as: 'photos' }, 'position', 'ASC'];
const daysInclude = { model: models.SaleDay, as: 'saleDays' };

function parseQuery(query) {
  const errors = {};
  const out = {};
  const num = (v) => (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN);
  const hasLat = query.lat !== undefined && query.lat !== '';
  const hasLng = query.lng !== undefined && query.lng !== '';
  const q = typeof query.q === 'string' ? query.q.trim().replace(/\s+/g, ' ') : '';
  if (query.q !== undefined && typeof query.q !== 'string') errors.q = 'Must be text.';
  if (hasLat || hasLng) {
    const lat = num(query.lat);
    const lng = num(query.lng);
    if (!geo.isLat(lat)) errors.lat = 'lat must be a number between -90 and 90.';
    if (!geo.isLng(lng)) errors.lng = 'lng must be a number between -180 and 180.';
    out.center = { lat, lng };
  } else if (q) {
    if (q.length > 200) errors.q = 'Search text is too long (200 characters max).';
    out.q = q;
  } else if (!errors.q) {
    errors.center = 'Give lat & lng, or q (an address or zip code).';
  }
  const radius = query.radius === undefined || query.radius === '' ? 10 : num(query.radius);
  if (geo.RADII_MI.indexOf(radius) === -1) errors.radius = 'radius must be one of ' + geo.RADII_MI.join(', ') + ' (miles).';
  out.radius = radius;
  const page = query.page === undefined ? 1 : num(query.page);
  if (!Number.isInteger(page) || page < 1 || page > 1000) errors.page = 'page must be an integer from 1 to 1000.';
  out.page = page;
  const pageSize = query.pageSize === undefined ? 20 : num(query.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) errors.pageSize = 'pageSize must be an integer from 1 to ' + MAX_PAGE_SIZE + '.';
  out.pageSize = pageSize;
  // Price filter: maxPrice (whole dollars, 0..cap) and/or free=true.
  const free = query.free;
  if (free !== undefined && free !== '') {
    if (free === 'true' || free === '1') out.freeOnly = true;
    else if (free !== 'false' && free !== '0') errors.free = 'free must be true or false.';
  }
  if (query.maxPrice !== undefined && query.maxPrice !== '') {
    const mp = num(query.maxPrice);
    if (!Number.isInteger(mp) || mp < 0 || mp > PRICE_CAP) errors.maxPrice = 'maxPrice must be whole dollars from 0 to ' + PRICE_CAP + '.';
    else out.maxPrice = mp;
  }
  const w = schedule.parseWhen(query.when);
  if (w.error) errors.when = w.error;
  else out.when = w.when;
  return { errors, values: out };
}

function paginate(items, page, pageSize) {
  const total = items.length;
  return {
    page, pageSize, total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    results: items.slice((page - 1) * pageSize, page * pageSize),
  };
}

// Bounding-box prefilter in SQL (uses the lat/lng index), exact haversine in JS.
// Combine where clauses with AND (each may contain its own Op.or).
const and = (...parts) => ({ [Op.and]: parts.filter(Boolean) });

async function nearbyRanked(center, radius, filter, user) {
  const box = geo.boundingBox(center, radius);
  const rows = await models.Post.findAll({
    attributes: ['id', 'lat', 'lng', 'createdAt', 'startDate', 'endDate', 'timeZone'],
    where: and(
      { lat: { [Op.between]: [box.minLat, box.maxLat] } },
      { [Op.or]: box.lngRanges.map(([a, b]) => ({ lng: { [Op.between]: [a, b] } })) },
      priceWhere(Op, filter),
      visibleWhere(user),
      schedule.notEndedWhere()
    ),
    limit: MAX_CANDIDATES,
    raw: true,
  });
  return (await schedule.filterWhen(models, rows, filter.when))
    .map((p) => ({ id: p.id, createdAt: new Date(p.createdAt), distance: geo.haversineMiles(center, { lat: p.lat, lng: p.lng }) }))
    .filter((r) => r.distance <= radius)
    .sort((a, b) => a.distance - b.distance || b.createdAt - a.createdAt || a.id - b.id);
}

// Load full posts (with photos) for one page of ranked ids, keeping the order.
async function loadPage(ranked) {
  if (!ranked.length) return [];
  const posts = await models.Post.findAll({ where: { id: ranked.map((r) => r.id) }, include: [photoInclude, daysInclude], order: [photoOrder] });
  const byId = new Map(posts.map((p) => [p.id, p]));
  return ranked.filter((r) => byId.has(r.id))
    .map((r) => Object.assign(byId.get(r.id).toJSON(), { distanceMiles: Math.round(r.distance * 10) / 10 }));
}

// No geocoder: match zip exactly (if q is a zip) or the text against address fields.
async function textMatch(q, filter, user) {
  // Postgres: case-insensitive ILIKE (backslash is its default escape). SQLite's LIKE is already case-insensitive.
  const pg = models.sequelize.getDialect() === 'postgres';
  const like = '%' + (pg ? q.replace(/[\\%_]/g, (c) => '\\' + c) : q) + '%';
  const op = pg ? Op.iLike : Op.like;
  const where = ZIP_RE.test(q)
    ? { zipCode: q.slice(0, 5) }
    : { [Op.or]: ['street', 'city', 'state', 'zipCode', 'title'].map((f) => ({ [f]: { [op]: like } })) };
  const found = await models.Post.findAll({ where: and(where, priceWhere(Op, filter), visibleWhere(user), schedule.notEndedWhere()), include: [photoInclude, daysInclude], order: [['createdAt', 'DESC'], photoOrder] });
  const posts = filter.when ? found.filter((p) => schedule.matchesWhen(p, filter.when)) : found;
  return posts.map((p) => Object.assign(p.toJSON(), { distanceMiles: null }));
}

function filterOf(v) {
  const out = { maxPrice: v.maxPrice !== undefined ? v.maxPrice : null, freeOnly: !!v.freeOnly };
  if (v.when) out.when = v.when;
  return out;
}

const NOTICES = {
  no_key: 'Distance search needs a Google Maps key to look up typed addresses. Showing posts whose address or zip matches your text instead. Use "my location" for distance results.',
  rate_limited: 'Too many address lookups right now. Showing text matches instead; try again in a minute.',
  error: 'The address lookup failed. Showing text matches instead.',
};

router.get('/', async (req, res) => {
  const { errors, values } = parseQuery(req.query || {});
  if (Object.keys(errors).length) return badRequest(res, 'Invalid search.', errors);
  try {
    let center = values.center ? Object.assign({ source: 'coords' }, values.center) : null;
    if (!center) {
      const clientId = req.user ? 'u:' + req.user.id : 'ip:' + req.ip;
      let r;
      if (!geo.allowClientGeocode(clientId, Date.now())) r = { status: 'rate_limited' };
      else r = await geo.geocodeAddress(values.q, await geo.resolveGeocodeKey(req.user));
      if (r.status === 'ok') {
        center = { lat: r.lat, lng: r.lng, source: 'geocoded', query: values.q };
      } else if (r.status === 'not_found') {
        return sendError(res, 404, 'location_not_found', 'Could not find that address or zip code.');
      } else {
        const items = await textMatch(values.q, values, req.user);
        return res.json(Object.assign({ mode: 'text', center: null, radius: values.radius, filter: filterOf(values), notice: { code: r.status, message: NOTICES[r.status] || NOTICES.error } },
          paginate(items, values.page, values.pageSize)));
      }
    }
    const ranked = await nearbyRanked(center, values.radius, values, req.user);
    const pageInfo = paginate(ranked, values.page, values.pageSize);
    pageInfo.results = await loadPage(pageInfo.results);
    return res.json(Object.assign({ mode: 'distance', center, radius: values.radius, filter: filterOf(values), notice: null }, pageInfo));
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
module.exports.parseQuery = parseQuery;
