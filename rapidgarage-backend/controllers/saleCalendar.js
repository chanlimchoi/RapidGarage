// GET /calendar - "This weekend" calendar: upcoming sale days, date first.
//   view: weekend (default; Fri-Sun of the weekend on or after `date`) | day | week (7 days from `date`)
//   date: YYYY-MM-DD anchor (default: today in `tz`, else the server's default zone)
//   tz: the viewer's IANA time zone, only used for "today"
//   where: lat & lng, or q (address / zip), with radius (5 | 10 | 25 | 50 mi);
//     no location = every upcoming sale on those days (newest areas first is
//     not implied; sorted by start time)
//   filters (same as /search): keyword, maxPrice, free
//   alert: one of the viewer's saved searches (login); its place, radius,
//     words and price limits replace the ones above
// Sale days are grouped by the sale's own local date. Hidden sales, ended
// days and sales by people the viewer blocked (or who blocked them) are left out.
// Sellers show as "First L." only.
const router = require('express').Router();
const { Op } = require('sequelize');
const models = require('../models');
const i18n = require('../lib/i18n');
const geo = require('../lib/geo');
const schedule = require('../lib/schedule');
const itemsLib = require('../lib/items');
const { PRICE_CAP } = require('../lib/price');
const { badRequest, sendError, notFound, serverError } = require('../lib/http');
const eventsLib = require('../lib/events');
const search = require('./search');

const VIEWS = ['weekend', 'day', 'week'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SALES = 500;

function parse(query) {
  const errors = {};
  const out = {};
  const num = (v) => (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN);
  out.view = query.view === undefined || query.view === '' ? 'weekend' : query.view;
  if (VIEWS.indexOf(out.view) === -1) errors.view = 'view must be one of: ' + VIEWS.join(', ') + '.';
  const tz = typeof query.tz === 'string' && schedule.isValidTimeZone(query.tz) ? query.tz : schedule.defaultTimeZone();
  if (query.date !== undefined && query.date !== '') {
    if (typeof query.date !== 'string' || !DATE_RE.test(query.date) || isNaN(Date.parse(query.date + 'T00:00:00Z'))) errors.date = 'date must be YYYY-MM-DD.';
    else out.date = query.date;
  }
  if (!out.date) out.date = schedule.localDate(schedule.now(), tz);
  if (query.alert !== undefined && query.alert !== '') {
    const a = num(query.alert);
    if (!Number.isInteger(a) || a < 1) errors.alert = 'alert must be a saved search id.';
    else out.alert = a;
  }
  const hasLat = query.lat !== undefined && query.lat !== '';
  const hasLng = query.lng !== undefined && query.lng !== '';
  if (hasLat || hasLng) {
    const lat = num(query.lat);
    const lng = num(query.lng);
    if (!geo.isLat(lat)) errors.lat = 'lat must be a number between -90 and 90.';
    if (!geo.isLng(lng)) errors.lng = 'lng must be a number between -180 and 180.';
    out.center = { lat, lng };
  } else if (typeof query.q === 'string' && query.q.trim()) {
    out.q = query.q.trim().replace(/\s+/g, ' ');
    if (out.q.length > 200) errors.q = 'Search text is too long (200 characters max).';
  }
  out.radius = query.radius === undefined || query.radius === '' ? 10 : num(query.radius);
  if (geo.RADII_MI.indexOf(out.radius) === -1) errors.radius = 'radius must be one of ' + geo.RADII_MI.join(', ') + ' (miles).';
  if (query.free === 'true' || query.free === '1') out.freeOnly = true;
  if (query.maxPrice !== undefined && query.maxPrice !== '') {
    const mp = num(query.maxPrice);
    if (!Number.isInteger(mp) || mp < 0 || mp > PRICE_CAP) errors.maxPrice = 'maxPrice must be whole dollars from 0 to ' + PRICE_CAP + '.';
    else out.maxPrice = mp;
  }
  const k = itemsLib.parseKeyword(query.keyword);
  if (k.error) errors.keyword = k.error;
  else if (k.words) { out.words = k.words; out.keyword = k.keyword; }
  return { errors, values: out };
}

// The dates a view covers, as local YYYY-MM-DD strings.
function datesFor(view, date) {
  if (view === 'day') return [date];
  if (view === 'week') return Array.from({ length: 7 }, (x, i) => schedule.addDays(date, i));
  // Weekend: Friday to Sunday of the weekend on or after `date` (on a Sunday: that weekend).
  const wd = schedule.weekdayOf(date);
  const friday = wd === 0 ? schedule.addDays(date, -2) : wd === 6 ? schedule.addDays(date, -1) : schedule.addDays(date, (5 - wd + 7) % 7);
  return [friday, schedule.addDays(friday, 1), schedule.addDays(friday, 2)];
}

async function blockedWith(user) {
  if (!user) return new Set();
  const rows = await models.UserBlock.findAll({ where: { [Op.or]: [{ blockerId: user.id }, { blockedId: user.id }] }, raw: true });
  return new Set(rows.map((b) => (b.blockerId === user.id ? b.blockedId : b.blockerId)));
}

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { errors, values } = parse(req.query || {});
  if (Object.keys(errors).length) return badRequest(res, 'Invalid calendar request.', errors);
  try {
    let alert = null;
    if (values.alert) {
      if (!req.user) return sendError(res, 401, 'login_required', 'Login required.');
      alert = await models.SaleAlert.findOne({ where: { id: values.alert, userId: req.user.id } });
      if (!alert) return notFound(res, 'Saved search not found.');
      values.center = { lat: alert.lat, lng: alert.lng };
      values.radius = alert.radiusMiles;
      values.maxPrice = alert.maxPrice === null ? undefined : alert.maxPrice;
      values.freeOnly = !!alert.freeOnly;
      const k = itemsLib.parseKeyword(alert.keyword || undefined);
      values.words = k.words || undefined;
      values.keyword = k.keyword || undefined;
      delete values.q;
    }
    const dates = datesFor(values.view, values.date);
    const filter = { maxPrice: values.maxPrice, freeOnly: values.freeOnly, words: values.words, keyword: values.keyword };
    let mode = 'all';
    let notice = null;
    let distances = null; // postId -> miles
    let ids = null;
    let center = values.center ? Object.assign({ source: alert ? 'alert' : 'coords' }, values.center) : null;
    if (!center && values.q) {
      const clientId = req.user ? 'u:' + req.user.id : 'ip:' + req.ip;
      const r = geo.allowClientGeocode(clientId, Date.now()) ? await geo.geocodeAddress(values.q, await geo.resolveGeocodeKey(req.user)) : { status: 'rate_limited' };
      if (r.status === 'ok') center = { lat: r.lat, lng: r.lng, source: 'geocoded', query: values.q };
      else if (r.status === 'not_found') return sendError(res, 404, 'location_not_found', 'Could not find that address or zip code.');
      else {
        mode = 'text';
        notice = { code: r.status, message: i18n.translate(i18n.requestLang(req), search.NOTICES[r.status] || search.NOTICES.error) };
        ids = (await search.textMatch(values.q, filter, req.user)).map((p) => p.id);
      }
    }
    if (center) {
      mode = 'distance';
      const ranked = await search.nearbyRanked(center, values.radius, filter, req.user);
      distances = new Map(ranked.map((r) => [r.id, Math.round(r.distance * 10) / 10]));
      ids = ranked.map((r) => r.id);
    }
    const now = schedule.now();
    const dayWhere = { date: dates, endsAt: { [Op.gt]: now } };
    if (ids) dayWhere.postId = ids.length ? ids : [-1];
    const blocked = await blockedWith(req.user);
    const postWhere = { hidden: false };
    if (blocked.size) postWhere.userId = { [Op.notIn]: Array.from(blocked) };
    if (!ids && (filter.freeOnly || filter.maxPrice !== undefined)) Object.assign(postWhere, require('../lib/price').priceWhere(Op, filter));
    const rows = await models.SaleDay.findAll({
      where: dayWhere, order: [['startsAt', 'ASC'], ['postId', 'ASC']], limit: MAX_SALES,
      include: [{ model: models.Post, where: postWhere, attributes: ['id', 'title', 'city', 'state', 'userId', 'isFree', 'priceMin', 'priceMax', 'timeZone', 'category'],
        include: [{ model: models.PostPhoto, as: 'photos', attributes: ['id', 'storageKey', 'thumbKey', 'position', 'width', 'height', 'alt'] }] }],
    });
    let kept = rows;
    if (!ids && filter.words) {
      const ok = await itemsLib.keywordPostIds(models, filter.words, Array.from(new Set(rows.map((r) => r.postId))));
      kept = rows.filter((r) => ok.has(r.postId));
    }
    const postIds = Array.from(new Set(kept.map((r) => r.postId)));
    const [savedRows, inEvent] = await Promise.all([
      req.user && postIds.length ? models.SavedPost.findAll({ where: { userId: req.user.id, postId: postIds }, attributes: ['postId', 'remind'], raw: true }) : [],
      eventsLib.eventsForPosts(postIds, req.user),
    ]);
    const saved = new Map(savedRows.map((s) => [s.postId, !!s.remind]));
    const byDate = new Map(dates.map((d) => [d, []]));
    for (const d of kept) {
      const p = d.Post;
      const photo = (p.photos || []).slice().sort((a, b) => a.position - b.position || a.id - b.id)[0];
      byDate.get(d.date).push({
        postId: p.id, title: p.title, city: p.city || null, state: p.state || null, category: p.category || null,
        isFree: !!p.isFree, priceMin: p.priceMin, priceMax: p.priceMax,
        date: d.date, start: d.startTime, end: d.endTime, startsAt: new Date(d.startsAt).toISOString(), endsAt: new Date(d.endsAt).toISOString(),
        timeZone: p.timeZone || schedule.defaultTimeZone(), open: new Date(d.startsAt) <= now,
        distanceMiles: distances ? distances.get(p.id) : null,
        thumbUrl: photo ? photo.toJSON().thumbUrl || null : null,
        own: !!req.user && req.user.id === p.userId,
        saved: saved.has(p.id), remind: saved.get(p.id) === true,
        event: inEvent.has(p.id) ? inEvent.get(p.id) : null,
      });
    }
    return res.json({
      view: values.view, date: values.date, dates, mode, notice, radius: values.radius,
      center: center ? { lat: center.lat, lng: center.lng, source: center.source } : null,
      alert: alert ? { id: alert.id, label: alert.label, keyword: alert.keyword || null } : null,
      total: kept.length, truncated: rows.length >= MAX_SALES,
      days: dates.map((d) => ({ date: d, sales: byDate.get(d) })),
    });
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
module.exports.datesFor = datesFor;
