// Neighborhood sales (see lib/events.js).
//   GET    /events                         ?lat&lng&radius (miles, search radii) | none: upcoming
//   GET    /events/mine                    organized by me + events my sales are in (login)
//   GET    /events/for-post/:postId        events my sale could join (owner)
//   POST   /events                         { name, description?, areaLabel, lat?, lng?, radiusMiles, joinMode, schedule }
//   GET    /events/:id                     event + approved sales (+ requests for the organizer)
//   PUT    /events/:id                     { name?, description?, joinMode?, schedule? } (organizer)
//   DELETE /events/:id                     organizer or admin
//   POST   /events/:id/join                { postId } (the sale's owner)
//   POST   /events/:id/participants/:postId/approve        organizer
//   DELETE /events/:id/participants/:postId                organizer (decline/remove) or the seller (leave)
//   POST   /events/:id/report              { reason, note? }
//   GET    /events/:id/print               code, short URL, scans (organizer, admin)
//   GET    /events/:id/qr.png | qr.svg | flyer.pdf        organizer, while visible
const router = require('express').Router();
const { Op } = require('sequelize');
const models = require('../models');
const { badRequest, forbidden, notFound, conflict, sendError, serverError, requireLogin, parseId } = require('../lib/http');
const { isAdmin } = require('../lib/roles');
const ev = require('../lib/events');
const geo = require('../lib/geo');
const schedule = require('../lib/schedule');
const mod = require('../lib/moderation');
const links = require('../lib/shortlinks');
const scans = require('../lib/scans');
const flyer = require('../lib/flyer');
const i18n = require('../lib/i18n');

const organizerInclude = { model: models.User, as: 'organizer', attributes: ['id', 'firstName', 'lastName'] };
const num = (v) => (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : typeof v === 'number' ? v : NaN);

function loadEvent(req, res, next) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Event id must be a positive integer.');
  return models.SaleEvent.findByPk(id, { include: [organizerInclude] })
    .then((e) => {
      if (!e || !ev.canSee(req.user, e)) return notFound(res, 'Neighborhood sale not found.');
      req.event = e;
      return next();
    })
    .catch((err) => serverError(res, err));
}

function organizerOnly(req, res, next) {
  if (!ev.isOrganizer(req.user, req.event)) return forbidden(res, 'Only the organizer can do that.');
  return next();
}

// Cards for lists: the event plus its public sale count.
async function cards(rows, viewer, dist) {
  const counts = await ev.publicSaleCounts(rows.map((e) => e.id));
  return rows.map((e) => ev.toJSON(e, viewer, Object.assign({ saleCount: counts.get(e.id) || 0 }, dist ? { distanceMiles: Math.round(dist.get(e.id) * 10) / 10 } : {})));
}

router.get('/', async (req, res) => {
  const q = req.query || {};
  try {
    if (q.lat !== undefined || q.lng !== undefined) {
      const lat = num(q.lat);
      const lng = num(q.lng);
      const radius = q.radius === undefined ? 10 : num(q.radius);
      const errors = {};
      if (!geo.isLat(lat)) errors.lat = 'lat must be a number between -90 and 90.';
      if (!geo.isLng(lng)) errors.lng = 'lng must be a number between -180 and 180.';
      if (geo.RADII_MI.indexOf(radius) === -1) errors.radius = 'radius must be one of ' + geo.RADII_MI.join(', ') + ' (miles).';
      if (Object.keys(errors).length) return badRequest(res, 'Invalid search.', errors);
      const found = await ev.nearby({ lat, lng }, radius, req.user);
      const list = await cards(found.map((x) => x.e), req.user, new Map(found.map((x) => [x.e.id, x.d])));
      return res.json({ results: list.filter((e) => e.saleCount > 0 || e.mine) });
    }
    // Upcoming, soonest first (the home page strip).
    const rows = await models.SaleEvent.findAll({ where: { [Op.and]: [ev.visibleWhere(req.user), ev.notEndedWhere()].filter(Boolean) }, include: [organizerInclude], order: [['startDate', 'ASC'], ['id', 'ASC']], limit: 40 });
    const list = (await cards(rows, req.user)).filter((e) => e.saleCount > 0 || e.mine).slice(0, 12);
    return res.json({ results: list });
  } catch (err) { return serverError(res, err); }
});

router.get('/mine', requireLogin, async (req, res) => {
  try {
    const me = req.user.id;
    const organized = await models.SaleEvent.findAll({ where: { organizerId: me }, include: [organizerInclude], order: [['startDate', 'DESC']] });
    const myPosts = await models.Post.findAll({ where: { userId: me }, attributes: ['id', 'title'], raw: true });
    const parts = myPosts.length ? await models.EventParticipant.findAll({ where: { postId: myPosts.map((p) => p.id) }, raw: true }) : [];
    const joinedEvents = parts.length ? await models.SaleEvent.findAll({ where: { [Op.and]: [{ id: parts.map((p) => p.eventId) }, ev.visibleWhere(req.user)].filter(Boolean) }, include: [organizerInclude] }) : [];
    const titles = new Map(myPosts.map((p) => [p.id, p.title]));
    const byEvent = new Map(joinedEvents.map((e) => [e.id, e]));
    const joined = (await cards(joinedEvents, req.user)).map((e) => Object.assign(e, {
      myParticipation: parts.filter((p) => p.eventId === e.id).map((p) => ({ postId: p.postId, postTitle: titles.get(p.postId), status: p.status })),
    })).filter((e) => byEvent.has(e.id));
    const pending = new Map();
    if (organized.length) {
      const rows = await models.EventParticipant.findAll({ where: { eventId: organized.map((e) => e.id), status: 'pending' }, attributes: ['eventId'], raw: true });
      rows.forEach((r) => pending.set(r.eventId, (pending.get(r.eventId) || 0) + 1));
    }
    return res.json({ organized: (await cards(organized, req.user)).map((e) => Object.assign(e, { pendingCount: pending.get(e.id) || 0 })), joined });
  } catch (err) { return serverError(res, err); }
});

// Events this sale could join, nearest first, with why not when it can't.
router.get('/for-post/:postId', requireLogin, async (req, res) => {
  const postId = parseId(req.params.postId);
  if (!postId) return badRequest(res, 'Post id must be a positive integer.');
  try {
    const post = await models.Post.findByPk(postId, { include: [{ model: models.SaleDay, as: 'saleDays' }] });
    if (!post || !mod.canSee(req.user, post)) return notFound(res, 'Post not found.');
    if (post.userId !== req.user.id) return forbidden(res, 'Only the seller can add this sale to a neighborhood sale.');
    const current = await models.EventParticipant.findOne({ where: { postId } });
    let currentEvent = null;
    if (current) {
      const e = await models.SaleEvent.findByPk(current.eventId, { include: [organizerInclude] });
      if (e && ev.canSee(req.user, e)) currentEvent = ev.toJSON(e, req.user, { participation: current.status });
    }
    let options = [];
    if (!current && typeof post.lat === 'number' && typeof post.lng === 'number') {
      // Events whose area could contain the sale: centers within the largest radius.
      const found = (await ev.nearby({ lat: post.lat, lng: post.lng }, ev.RADII[ev.RADII.length - 1], req.user)).filter((x) => x.d <= x.e.radiusMiles);
      options = found.map((x) => {
        const why = ev.ineligible(post, x.e);
        return ev.toJSON(x.e, req.user, { distanceMiles: Math.round(x.d * 10) / 10, canJoin: !why, reason: why ? i18n.translate(i18n.requestLang(req), why.message) : null, reasonCode: why ? why.code : null });
      });
    }
    return res.json({ current: currentEvent, options, hasLocation: typeof post.lat === 'number' });
  } catch (err) { return serverError(res, err); }
});

router.post('/', requireLogin, async (req, res) => {
  const body = req.body || {};
  const { errors, values } = ev.validate(body, true);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid neighborhood sale.', errors);
  const me = req.user.id;
  try {
    const active = await models.SaleEvent.count({ where: { organizerId: me, endDate: { [Op.gt]: schedule.now() } } });
    if (active >= ev.maxActive()) return sendError(res, 429, 'too_many_events', 'You already organize ' + ev.maxActive() + ' upcoming neighborhood sales. Wait until one ends.');
    const today = await models.SaleEvent.count({ where: { organizerId: me, createdAt: { [Op.gte]: new Date(Date.now() - 86400000) } } });
    if (today >= ev.maxPerDay()) {
      res.set('Retry-After', '3600');
      return sendError(res, 429, 'rate_limited', 'You have created a lot of neighborhood sales today. Please try again tomorrow.');
    }
    if (values.lat === undefined) {
      // No coordinates from the browser: look the area up.
      const r = await geo.geocodeAddress(values.areaLabel, await geo.resolveGeocodeKey(req.user));
      if (r.status !== 'ok') {
        return badRequest(res, 'Invalid neighborhood sale.', { areaLabel: r.status === 'not_found' ? "Couldn't find that area. Try a street and city, or use your location." : "Couldn't look up that area right now. Use your location instead." });
      }
      values.lat = r.lat;
      values.lng = r.lng;
    }
    const e = await models.SaleEvent.create(Object.assign({ organizerId: me, shortCode: await ev.newCode() }, values));
    const full = await models.SaleEvent.findByPk(e.id, { include: [organizerInclude] });
    return res.status(201).json(ev.toJSON(full, req.user, { saleCount: 0 }));
  } catch (err) { return serverError(res, err); }
});

router.get('/:id', loadEvent, async (req, res) => {
  const e = req.event;
  try {
    const sales = await ev.salesOf(e, req.user);
    const extra = { sales, saleCount: sales.length, ended: ev.isEnded(e) };
    if (ev.isOrganizer(req.user, e) || isAdmin(req.user)) {
      const pending = await ev.salesOf(e, req.user, { status: 'pending' });
      extra.requests = pending;
    }
    if (req.user) {
      const mine = await models.Post.findAll({ where: { userId: req.user.id }, attributes: ['id'], raw: true });
      const parts = mine.length ? await models.EventParticipant.findAll({ where: { eventId: e.id, postId: mine.map((p) => p.id) }, raw: true }) : [];
      extra.myParticipation = parts.map((p) => ({ postId: p.postId, status: p.status }));
    }
    res.set('Cache-Control', 'no-store');
    return res.json(ev.toJSON(e, req.user, extra));
  } catch (err) { return serverError(res, err); }
});

router.put('/:id', requireLogin, loadEvent, organizerOnly, async (req, res) => {
  const { errors, values } = ev.validate(req.body || {}, false);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid neighborhood sale.', errors);
  if (!Object.keys(values).length) return badRequest(res, 'Nothing to update.');
  try {
    await req.event.update(values);
    return res.json(ev.toJSON(req.event, req.user));
  } catch (err) { return serverError(res, err); }
});

router.delete('/:id', requireLogin, loadEvent, async (req, res) => {
  if (!ev.isOrganizer(req.user, req.event) && !isAdmin(req.user)) return forbidden(res, 'Only the organizer can do that.');
  try {
    const id = req.event.id;
    await models.sequelize.transaction(async (transaction) => {
      await models.EventReport.update({ status: 'actioned', action: 'deleted', reviewedAt: new Date(), reviewerId: isAdmin(req.user) && !ev.isOrganizer(req.user, req.event) ? req.user.id : null },
        { where: { eventId: id, status: 'open' }, transaction });
      await models.EventParticipant.destroy({ where: { eventId: id }, transaction });
      await models.EventScanDay.destroy({ where: { eventId: id }, transaction });
      await models.EventReport.destroy({ where: { eventId: id }, transaction });
      await req.event.destroy({ transaction });
    });
    return res.status(204).end();
  } catch (err) { return serverError(res, err); }
});

router.post('/:id/join', requireLogin, loadEvent, async (req, res) => {
  const e = req.event;
  const postId = parseId((req.body || {}).postId);
  if (!postId) return badRequest(res, 'Invalid request.', { postId: 'Choose one of your sales.' });
  try {
    if (e.hidden) return sendError(res, 409, 'event_hidden', 'A moderator has hidden this neighborhood sale.');
    if (ev.isEnded(e)) return sendError(res, 409, 'event_ended', 'This neighborhood sale has ended.');
    const post = await models.Post.findByPk(postId, { include: [{ model: models.SaleDay, as: 'saleDays' }] });
    if (!post || !mod.canSee(req.user, post)) return notFound(res, 'Post not found.');
    if (post.userId !== req.user.id) return forbidden(res, 'Only the seller can add this sale to a neighborhood sale.');
    if (await ev.blockedBetween(req.user.id, e.organizerId)) return sendError(res, 403, 'blocked', "You can't join this neighborhood sale.");
    const existing = await models.EventParticipant.findOne({ where: { postId } });
    if (existing) {
      return conflict(res, existing.eventId === e.id ? 'This sale is already part of this neighborhood sale.' : 'This sale is already part of another neighborhood sale. Leave it first.');
    }
    const why = ev.ineligible(post, e);
    if (why) return sendError(res, 409, why.code, why.message);
    const count = await models.EventParticipant.count({ where: { eventId: e.id } });
    if (count >= ev.maxSales()) return sendError(res, 409, 'event_full', 'This neighborhood sale is full.');
    const auto = e.joinMode === 'open' || ev.isOrganizer(req.user, e);
    const p = await models.EventParticipant.create({ eventId: e.id, postId, status: auto ? 'approved' : 'pending', decidedAt: auto ? new Date() : null });
    return res.status(201).json({ eventId: e.id, postId, status: p.status });
  } catch (err) {
    if (err && err.name === 'SequelizeUniqueConstraintError') return conflict(res, 'This sale is already part of another neighborhood sale. Leave it first.');
    return serverError(res, err);
  }
});

async function participant(req, res) {
  const postId = parseId(req.params.postId);
  if (!postId) { badRequest(res, 'Post id must be a positive integer.'); return null; }
  const p = await models.EventParticipant.findOne({ where: { eventId: req.event.id, postId } });
  if (!p) { notFound(res, 'That sale is not part of this neighborhood sale.'); return null; }
  return p;
}

router.post('/:id/participants/:postId/approve', requireLogin, loadEvent, organizerOnly, async (req, res) => {
  try {
    const p = await participant(req, res);
    if (!p) return null;
    if (p.status === 'approved') return res.json({ eventId: req.event.id, postId: p.postId, status: p.status });
    const post = await models.Post.findByPk(p.postId, { include: [{ model: models.SaleDay, as: 'saleDays' }] });
    if (!post) return notFound(res, 'Post not found.');
    if (await ev.blockedBetween(req.user.id, post.userId)) return sendError(res, 403, 'blocked', "You can't approve this sale.");
    const why = ev.ineligible(post, req.event);
    if (why) return sendError(res, 409, why.code, why.message);
    await p.update({ status: 'approved', decidedAt: new Date() });
    return res.json({ eventId: req.event.id, postId: p.postId, status: p.status });
  } catch (err) { return serverError(res, err); }
});

router.delete('/:id/participants/:postId', requireLogin, loadEvent, async (req, res) => {
  try {
    const p = await participant(req, res);
    if (!p) return null;
    const post = await models.Post.findByPk(p.postId, { attributes: ['id', 'userId'] });
    const seller = post && post.userId === req.user.id;
    if (!seller && !ev.isOrganizer(req.user, req.event)) return forbidden(res, 'Only the organizer or the seller can do that.');
    await p.destroy();
    return res.status(204).end();
  } catch (err) { return serverError(res, err); }
});

router.post('/:id/report', requireLogin, loadEvent, async (req, res) => {
  const body = req.body || {};
  const errors = {};
  if (models.EventReport.REASONS.indexOf(body.reason) === -1) errors.reason = 'Choose a reason: ' + models.EventReport.REASONS.join(', ') + '.';
  let note = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') errors.note = 'Note must be text.';
    else if (body.note.trim().length > mod.NOTE_MAX) errors.note = 'Keep the note under ' + mod.NOTE_MAX + ' characters.';
    else note = body.note.trim() || null;
  }
  if (Object.keys(errors).length) return badRequest(res, 'Invalid report.', errors);
  const e = req.event;
  if (ev.isOrganizer(req.user, e)) return forbidden(res, "You can't report your own neighborhood sale.");
  try {
    const dupe = 'You already reported this neighborhood sale. A moderator will review it.';
    if (await models.EventReport.count({ where: { eventId: e.id, reporterId: req.user.id, status: 'open' } })) return conflict(res, dupe);
    const since = new Date(Date.now() - 3600 * 1000);
    const w = { where: { reporterId: req.user.id, createdAt: { [Op.gte]: since } } };
    // One hourly budget for every kind of report.
    const recent = (await models.Report.count(w)) + (await models.ConversationReport.count(w)) + (await models.EventReport.count(w));
    if (recent >= mod.reportsPerHour()) {
      res.set('Retry-After', '3600');
      return sendError(res, 429, 'rate_limited', 'You have sent a lot of reports. Please try again later.');
    }
    const r = await models.EventReport.create({ eventId: e.id, eventName: e.name, reporterId: req.user.id, reason: body.reason, note });
    // Same optional auto-hide threshold as posts.
    const n = mod.autoHideThreshold();
    if (n && !e.hidden) {
      const reporters = await models.EventReport.count({ where: { eventId: e.id, status: 'open' }, distinct: true, col: 'reporterId' });
      if (reporters >= n) await e.update({ hidden: true, hiddenAt: new Date(), hiddenBy: null, hiddenSource: 'auto' });
    }
    return res.status(201).json({ id: r.id, eventId: e.id, reason: r.reason, status: r.status, createdAt: r.createdAt });
  } catch (err) {
    if (err && err.name === 'SequelizeUniqueConstraintError') return conflict(res, 'You already reported this neighborhood sale. A moderator will review it.');
    return serverError(res, err);
  }
});

// ---- print -----------------------------------------------------------------
function printOnly(req, res, next) {
  if (!ev.isOrganizer(req.user, req.event)) return forbidden(res, 'Only the organizer can print flyers for this neighborhood sale.');
  if (req.event.hidden) return sendError(res, 409, 'hidden', 'A moderator has hidden this neighborhood sale, so its QR code shows "not available". Printing is turned off until it is visible again.');
  return next();
}
const slug = (e) => String(e.name || 'neighborhood-sale').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'neighborhood-sale';
function sendFile(req, res, type, name, body) {
  res.set({ 'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.set('Content-Disposition', (req.query.download === '1' ? 'attachment' : 'inline') + '; filename="' + name + '"');
  return res.send(body);
}

router.get('/:id/print', requireLogin, loadEvent, async (req, res) => {
  const e = req.event;
  if (!ev.isOrganizer(req.user, e) && !isAdmin(req.user)) return forbidden(res, 'Only the organizer and admins can see scan counts.');
  try {
    const stats = await scans.stats(e, 30, 'event');
    return res.json({ eventId: e.id, code: e.shortCode, shortUrl: links.shortUrl(e.shortCode), hidden: !!e.hidden, canPrint: ev.isOrganizer(req.user, e) && !e.hidden, scans: stats });
  } catch (err) { return serverError(res, err); }
});

router.get('/:id/qr.png', requireLogin, loadEvent, printOnly, async (req, res) => {
  const size = req.query.size === undefined ? 1024 : Number(req.query.size);
  if (!Number.isInteger(size) || size < 256 || size > 2048) return badRequest(res, 'size must be a whole number from 256 to 2048.');
  try { return sendFile(req, res, 'image/png', 'rapidgarage-' + slug(req.event) + '-qr.png', await flyer.qrPng(links.shortUrl(req.event.shortCode), size)); } catch (err) { return serverError(res, err); }
});

router.get('/:id/qr.svg', requireLogin, loadEvent, printOnly, async (req, res) => {
  try { return sendFile(req, res, 'image/svg+xml', 'rapidgarage-' + slug(req.event) + '-qr.svg', await flyer.qrSvg(links.shortUrl(req.event.shortCode))); } catch (err) { return serverError(res, err); }
});

router.get('/:id/flyer.pdf', requireLogin, loadEvent, printOnly, async (req, res) => {
  const q = req.query;
  const layout = q.layout === undefined ? 'letter' : q.layout;
  const arrow = q.arrow === undefined ? 'none' : q.arrow;
  const lang = q.lang === undefined ? i18n.requestLang(req) : i18n.normalize(q.lang);
  const errors = {};
  if (flyer.LAYOUTS.indexOf(layout) === -1) errors.layout = 'layout must be one of: ' + flyer.LAYOUTS.join(', ') + '.';
  if (flyer.ARROWS.indexOf(arrow) === -1) errors.arrow = 'arrow must be one of: ' + flyer.ARROWS.join(', ') + '.';
  if (!lang) errors.lang = 'lang must be one of: ' + i18n.CODES.join(', ') + '.';
  if (q.sales !== undefined && q.sales !== '0' && q.sales !== '1') errors.sales = 'sales must be 0 or 1.';
  if (Object.keys(errors).length) return badRequest(res, 'Invalid print options.', errors);
  try {
    // Only sales everyone can see go on paper.
    const sales = q.sales === '0' ? [] : await ev.salesOf(req.event, null);
    const pdf = await flyer.buildPdf(flyer.eventAsPost(req.event, sales), { layout, arrow, lang, kind: 'event', url: links.shortUrl(req.event.shortCode) });
    const kind = layout === 'sign' ? 'sign' : layout === 'half' ? 'half-page-flyer' : 'flyer';
    return sendFile(req, res, 'application/pdf', 'rapidgarage-' + slug(req.event) + '-' + kind + '.pdf', pdf);
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
