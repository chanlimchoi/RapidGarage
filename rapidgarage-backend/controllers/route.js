// POST /route : a time-aware route through sales you picked (any visible
// sales, not only saved ones). Works logged out too.
//   body: { postIds: [id] (1-10), lat?, lng? (start; else the first sale),
//           departAt? (ISO, default now), dwellMinutes? (5-120, default 20) }
// Stops come in visiting order with arrival, wait-for-opening and leave
// times; sales you can't reach while open are listed under skipped with a
// reason. Hidden or unknown sales are "unavailable" (no title, so nothing leaks).
const router = require('express').Router();
const models = require('../models');
const { badRequest, serverError, parseId } = require('../lib/http');
const { canSee } = require('../lib/moderation');
const { isLat, isLng } = require('../lib/geo');
const schedule = require('../lib/schedule');
const route = require('../lib/route');

const DEPART_PAST_MS = 60 * 60000;
const DEPART_FUTURE_MS = 30 * 86400000;

function validate(body, at) {
  const errors = {};
  const v = {};
  const ids = body.postIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > route.MAX_STOPS) errors.postIds = 'Pick 1 to ' + route.MAX_STOPS + ' sales.';
  else {
    v.postIds = Array.from(new Set(ids.map(parseId)));
    if (v.postIds.some((x) => !x)) errors.postIds = 'postIds must be sale ids.';
  }
  const hasLat = body.lat !== undefined && body.lat !== null && body.lat !== '';
  const hasLng = body.lng !== undefined && body.lng !== null && body.lng !== '';
  if (hasLat || hasLng) {
    const lat = Number(body.lat); const lng = Number(body.lng);
    if (!hasLat || !hasLng || !isLat(lat) || !isLng(lng)) errors.location = 'Enter a valid location.';
    else v.start = { lat, lng };
  } else v.start = null;
  if (body.departAt !== undefined && body.departAt !== null && body.departAt !== '') {
    const d = new Date(body.departAt);
    if (typeof body.departAt !== 'string' || Number.isNaN(d.getTime())) errors.departAt = 'Enter a valid start time.';
    else if (d.getTime() < at - DEPART_PAST_MS || d.getTime() > at + DEPART_FUTURE_MS) errors.departAt = 'Pick a start time within the next 30 days.';
    else v.departAt = d.getTime();
  } else v.departAt = at;
  if (body.dwellMinutes !== undefined && body.dwellMinutes !== null && body.dwellMinutes !== '') {
    const m = Number(body.dwellMinutes);
    if (!Number.isInteger(m) || m < route.DWELL.min || m > route.DWELL.max) errors.dwellMinutes = 'Minutes per stop must be a whole number from ' + route.DWELL.min + ' to ' + route.DWELL.max + '.';
    else v.dwellMinutes = m;
  } else v.dwellMinutes = route.DWELL.default;
  return { errors, v };
}

router.post('/', async (req, res) => {
  const at = +schedule.now();
  const { errors, v } = validate(req.body || {}, at);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid route.', errors);
  try {
    const rows = await models.Post.findAll({ where: { id: v.postIds }, include: [{ model: models.SaleDay, as: 'saleDays' }] });
    const byId = new Map(rows.filter((p) => canSee(req.user, p)).map((p) => [p.id, p]));
    const posts = v.postIds.filter((id) => byId.has(id)).map((id) => byId.get(id));
    const r = route.planTimed(posts, v.start, v.departAt, v.dwellMinutes);
    const skipped = v.postIds.filter((id) => !byId.has(id)).map((postId) => ({ postId, reason: 'unavailable' }))
      .concat(r.skipped.map((x) => ({ postId: x.post.id, title: x.post.title, reason: x.reason })));
    return res.json({
      start: v.start, departAt: new Date(v.departAt).toISOString(), dwellMinutes: v.dwellMinutes,
      stops: r.stops.map((x, i) => Object.assign({ order: i + 1 }, x, { status: schedule.statusOf(x.post, new Date(x.arriveAt)), post: x.post.toJSON() })),
      skipped, totalMiles: r.totalMiles, finishAt: r.finishAt,
      googleMapsUrl: route.googleMapsUrl(v.start, r.stops.map((x) => x.post)),
      assumptions: { avgMph: route.AVG_MPH, roadFactor: route.ROAD_FACTOR, minBrowseMinutes: route.MIN_BROWSE_MIN },
      maxStops: route.MAX_STOPS,
    });
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
