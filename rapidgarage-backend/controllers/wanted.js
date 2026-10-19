// Wanted posts (see lib/wanted.js).
//   GET    /wanted                 public board: ?q&category&lat&lng&radius&page (open posts only)
//   GET    /wanted/mine            my wanted posts (any status), new-match counts, limits (login)
//   POST   /wanted                 { title, keywords?, category?, details?, maxPriceCents?, areaLabel,
//                                    lat+lng | address, radiusMiles, days?, emailEnabled? } (login)
//   GET    /wanted/:id             one post (+ its matches for the owner, which marks them seen)
//   PUT    /wanted/:id             edit (owner); expiry is changed with renew
//   POST   /wanted/:id/renew       { days? } expires days from now, reopens a fulfilled post (owner)
//   POST   /wanted/:id/fulfill     mark found (owner)
//   DELETE /wanted/:id             owner or admin
//   POST   /wanted/:id/report      { reason, note? }
//   POST   /wanted/unsubscribe     { w, t } or ?w=&t= : signed email link, turns email off
// Sellers contact the buyer with POST /conversations { wantedId }.
const router = require('express').Router();
const { Op } = require('sequelize');
const models = require('../models');
const { badRequest, forbidden, notFound, conflict, sendError, serverError, requireLogin, parseId } = require('../lib/http');
const { isAdmin } = require('../lib/roles');
const W = require('../lib/wanted');
const geo = require('../lib/geo');
const area = require('../lib/area');
const mod = require('../lib/moderation');
const schedule = require('../lib/schedule');
const { wantedEnabled } = require('../lib/features');

const posterInclude = { model: models.User, as: 'poster', attributes: ['id', 'firstName', 'lastName'] };
const num = (v) => (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : typeof v === 'number' ? v : NaN);
const PAGE_SIZE = 24;
const OFF = 'Wanted posts are turned off on this site right now.';

router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ---- public: one-click unsubscribe (no login) ---------------------------
// Same contract as /alerts/unsubscribe: the token is checked before any
// lookup and every invalid request gets the same 400.
router.post('/unsubscribe', async (req, res) => {
  const body = req.body || {};
  const id = parseId(body.w !== undefined ? body.w : req.query.w);
  const token = body.t !== undefined ? body.t : req.query.t;
  if (!W.verifyToken(id || 0, token) || !id) return sendError(res, 400, 'invalid_token', 'This unsubscribe link is invalid.');
  try {
    const w = await models.WantedPost.findByPk(id);
    if (!w) return res.json({ ok: true, gone: true });
    if (w.emailEnabled) await w.update({ emailEnabled: false });
    await models.WantedMatch.update({ status: 'skipped', lastError: 'unsubscribed' }, { where: { wantedId: w.id, status: 'pending' } });
    return res.json({ ok: true, wanted: { id: w.id, title: w.title, emailEnabled: false } });
  } catch (err) { return serverError(res, err); }
});

// ---- board ----------------------------------------------------------------
router.get('/', async (req, res) => {
  const q = req.query || {};
  try {
    if (!(await wantedEnabled())) return res.json({ enabled: false, results: [], total: 0, page: 1, pageSize: PAGE_SIZE });
    const errors = {};
    const where = [{ hidden: false }, W.activeWhere()];
    let center = null;
    let radius = null;
    if (q.lat !== undefined || q.lng !== undefined) {
      const lat = num(q.lat);
      const lng = num(q.lng);
      radius = q.radius === undefined ? 10 : num(q.radius);
      if (!geo.isLat(lat)) errors.lat = 'lat must be a number between -90 and 90.';
      if (!geo.isLng(lng)) errors.lng = 'lng must be a number between -180 and 180.';
      if (geo.RADII_MI.indexOf(radius) === -1) errors.radius = 'radius must be one of ' + geo.RADII_MI.join(', ') + ' (miles).';
      center = { lat, lng };
    }
    if (q.category !== undefined && q.category !== '' && W.CATEGORY_KEYS.indexOf(q.category) === -1) errors.category = 'Choose one of the categories.';
    const words = q.q ? W.wordsOf(String(q.q).slice(0, 120)) : [];
    const page = q.page === undefined ? 1 : parseId(q.page);
    if (!page) errors.page = 'page must be a positive integer.';
    if (Object.keys(errors).length) return badRequest(res, 'Invalid search.', errors);
    if (q.category) where.push({ category: q.category });
    if (center) {
      // A wanted area that reaches the search circle (centers within both radii).
      const box = geo.boundingBox(center, radius + W.RADIUS_MAX);
      where.push({ lat: { [Op.between]: [box.minLat, box.maxLat] } }, { [Op.or]: box.lngRanges.map(([a, b]) => ({ lng: { [Op.between]: [a, b] } })) });
    }
    const blocked = await W.blockedWith(req.user ? req.user.id : null);
    if (blocked.size) where.push({ userId: { [Op.notIn]: Array.from(blocked) } });
    let rows = await models.WantedPost.findAll({ where: { [Op.and]: where }, include: [posterInclude], order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 1000 });
    if (words.length) rows = rows.filter((w) => { const text = W.normalize([w.title, w.keywords, w.details].filter(Boolean).join(' ')); return words.every((x) => text.indexOf(x) >= 0); });
    let dist = null;
    if (center) {
      // Distance from the search point to the rounded public center.
      dist = new Map();
      rows = rows.filter((w) => {
        const d = geo.haversineMiles(center, W.publicPoint(w));
        dist.set(w.id, d);
        return d <= radius + w.radiusMiles;
      }).sort((a, b) => dist.get(a.id) - dist.get(b.id));
    }
    const total = rows.length;
    const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    return res.json({
      enabled: true, total, page, pageSize: PAGE_SIZE,
      results: slice.map((w) => W.toJSON(w, req.user, dist ? { distanceMiles: Math.round(dist.get(w.id) * 10) / 10 } : {})),
    });
  } catch (err) { return serverError(res, err); }
});

async function limits(userId) {
  const active = await models.WantedPost.count({ where: Object.assign({ userId }, W.activeWhere()) });
  return { active, maxActive: W.maxActive(), daysDefault: W.DAYS_DEFAULT, daysMax: W.DAYS_MAX, radius: { min: W.RADIUS_MIN, max: W.RADIUS_MAX } };
}

router.get('/mine', requireLogin, async (req, res) => {
  try {
    const rows = await models.WantedPost.findAll({ where: { userId: req.user.id }, include: [posterInclude], order: [['createdAt', 'DESC']] });
    const counts = new Map();
    if (rows.length) {
      const unseen = await models.WantedMatch.findAll({ where: { wantedId: rows.map((w) => w.id), seenAt: null }, attributes: ['wantedId'], raw: true });
      unseen.forEach((r) => counts.set(r.wantedId, (counts.get(r.wantedId) || 0) + 1));
    }
    return res.json({ enabled: await wantedEnabled(), results: rows.map((w) => W.toJSON(w, req.user, { newMatches: counts.get(w.id) || 0 })), limits: await limits(req.user.id) });
  } catch (err) { return serverError(res, err); }
});

router.post('/', requireLogin, require('../lib/emailVerify').requireVerified, async (req, res) => {
  const body = req.body || {};
  const { errors, values } = W.validate(body, true);
  area.readLocation(body, errors, values, true);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid wanted post.', errors);
  const me = req.user.id;
  try {
    if (!(await wantedEnabled())) return sendError(res, 403, 'feature_disabled', OFF);
    const active = await models.WantedPost.count({ where: Object.assign({ userId: me }, W.activeWhere()) });
    if (active >= W.maxActive()) return sendError(res, 409, 'limit_reached', 'You can have up to ' + W.maxActive() + ' active wanted posts. Mark one found or delete one first.');
    const today = await models.WantedPost.count({ where: { userId: me, createdAt: { [Op.gte]: new Date(Date.now() - 86400000) } } });
    if (today >= W.maxPerDay()) {
      res.set('Retry-After', '3600');
      return sendError(res, 429, 'rate_limited', 'You have posted a lot of wanted posts today. Please try again tomorrow.');
    }
    if (!(await area.resolveAddress(req, res, body, values))) return undefined;
    const days = values.days;
    delete values.days;
    const w = await models.WantedPost.create(Object.assign({ keywords: null, category: null, details: null, maxPriceCents: null, emailEnabled: true }, values, { userId: me, status: 'active', expiresAt: W.expiryFrom(days) }));
    await W.backfill(w);
    const full = await models.WantedPost.findByPk(w.id, { include: [posterInclude] });
    return res.status(201).json(W.toJSON(full, req.user, { matches: await W.matchesOf(full, req.user) }));
  } catch (err) { return serverError(res, err); }
});

// Load :id if the viewer may see it (hidden: owner and admins only).
async function loadWanted(req, res, next) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Wanted post id must be a positive integer.');
  try {
    const w = await models.WantedPost.findByPk(id, { include: [posterInclude] });
    if (!w || !W.canSee(req.user, w)) return notFound(res, 'Wanted post not found.');
    // Turned off: only its owner and admins can still open it.
    if (!W.isOwner(req.user, w) && !isAdmin(req.user) && !(await wantedEnabled())) return notFound(res, 'Wanted post not found.');
    req.wanted = w;
    return next();
  } catch (err) { return serverError(res, err); }
}

function ownerOnly(req, res, next) {
  if (!W.isOwner(req.user, req.wanted)) return forbidden(res, 'Only the person who posted it can change this wanted post.');
  return next();
}

async function answer(req, res, w, status) {
  const full = await models.WantedPost.findByPk(w.id, { include: [posterInclude] });
  return res.status(status || 200).json(W.toJSON(full, req.user, W.isOwner(req.user, full) ? { matches: await W.matchesOf(full, req.user) } : {}));
}

router.get('/:id', loadWanted, async (req, res) => {
  const w = req.wanted;
  try {
    const extra = {};
    if (W.isOwner(req.user, w)) {
      extra.matches = await W.matchesOf(w, req.user);
      await models.WantedMatch.update({ seenAt: new Date() }, { where: { wantedId: w.id, seenAt: null } });
    } else if (req.user) {
      const blocked = await W.blockedWith(req.user.id);
      extra.blocked = blocked.has(w.userId);
      const conv = await models.Conversation.findOne({ where: { wantedId: w.id, buyerId: w.userId, sellerId: req.user.id }, attributes: ['id'] });
      extra.conversationId = conv ? conv.id : null;
      extra.reportedByMe = !!(await models.WantedReport.count({ where: { wantedId: w.id, reporterId: req.user.id, status: 'open' } }));
    }
    extra.canContact = !!req.user && !W.isOwner(req.user, w) && W.isOpen(w) && !extra.blocked;
    return res.json(W.toJSON(w, req.user, extra));
  } catch (err) { return serverError(res, err); }
});

router.put('/:id', requireLogin, loadWanted, ownerOnly, async (req, res) => {
  const body = req.body || {};
  const { errors, values } = W.validate(body, false);
  delete values.days;
  if (body.days !== undefined) errors.days = 'Use renew to change how long it stays up.';
  area.readLocation(body, errors, values, false);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid wanted post.', errors);
  const w = req.wanted;
  // The final state must still have something to match on.
  const next = { title: values.title !== undefined ? values.title : w.title, keywords: values.keywords !== undefined ? values.keywords : w.keywords };
  if (!W.matchWords(next).length) return badRequest(res, 'Invalid wanted post.', { keywords: 'Add a keyword we can match sales on.' });
  try {
    if (!(await area.resolveAddress(req, res, body, values))) return undefined;
    if (!Object.keys(values).length) return badRequest(res, 'Nothing to update.');
    await w.update(values);
    if (values.emailEnabled === false) await models.WantedMatch.update({ status: 'skipped', lastError: 'email_off' }, { where: { wantedId: w.id, status: 'pending' } });
    await W.backfill(w);
    return answer(req, res, w);
  } catch (err) { return serverError(res, err); }
});

router.post('/:id/renew', requireLogin, loadWanted, ownerOnly, async (req, res) => {
  const d = W.parseDays((req.body || {}).days);
  if (d.error) return badRequest(res, 'Invalid wanted post.', { days: d.error });
  const w = req.wanted;
  try {
    if (!(await wantedEnabled())) return sendError(res, 403, 'feature_disabled', OFF);
    // Reopening counts against the active cap; renewing an open one doesn't add to it.
    if (W.statusOf(w) !== 'active') {
      const active = await models.WantedPost.count({ where: Object.assign({ userId: req.user.id }, W.activeWhere()) });
      if (active >= W.maxActive()) return sendError(res, 409, 'limit_reached', 'You can have up to ' + W.maxActive() + ' active wanted posts. Mark one found or delete one first.');
    }
    await w.update({ status: 'active', fulfilledAt: null, expiresAt: W.expiryFrom(d.value) });
    await W.backfill(w);
    return answer(req, res, w);
  } catch (err) { return serverError(res, err); }
});

router.post('/:id/fulfill', requireLogin, loadWanted, ownerOnly, async (req, res) => {
  const w = req.wanted;
  try {
    if (w.status !== 'fulfilled') await w.update({ status: 'fulfilled', fulfilledAt: schedule.now() });
    await models.WantedMatch.update({ status: 'skipped', lastError: 'fulfilled' }, { where: { wantedId: w.id, status: 'pending' } });
    return answer(req, res, w);
  } catch (err) { return serverError(res, err); }
});

router.delete('/:id', requireLogin, loadWanted, async (req, res) => {
  const w = req.wanted;
  const byAdmin = isAdmin(req.user) && !W.isOwner(req.user, w);
  if (!byAdmin && !W.isOwner(req.user, w)) return forbidden(res, 'Only the person who posted it can change this wanted post.');
  try {
    await models.sequelize.transaction(async (transaction) => {
      await models.WantedMatch.destroy({ where: { wantedId: w.id }, transaction });
      await models.WantedReport.destroy({ where: { wantedId: w.id }, transaction });
      await w.destroy({ transaction });
    });
    return res.status(204).end();
  } catch (err) { return serverError(res, err); }
});

router.post('/:id/report', requireLogin, loadWanted, async (req, res) => {
  const body = req.body || {};
  const errors = {};
  if (models.WantedReport.REASONS.indexOf(body.reason) === -1) errors.reason = 'Choose a reason: ' + models.WantedReport.REASONS.join(', ') + '.';
  let note = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') errors.note = 'Note must be text.';
    else if (body.note.trim().length > mod.NOTE_MAX) errors.note = 'Keep the note under ' + mod.NOTE_MAX + ' characters.';
    else note = body.note.trim() || null;
  }
  if (Object.keys(errors).length) return badRequest(res, 'Invalid report.', errors);
  const w = req.wanted;
  if (W.isOwner(req.user, w)) return forbidden(res, "You can't report your own wanted post.");
  const dupe = 'You already reported this wanted post. A moderator will review it.';
  try {
    if (await models.WantedReport.count({ where: { wantedId: w.id, reporterId: req.user.id, status: 'open' } })) return conflict(res, dupe);
    if ((await mod.recentReportCount(req.user.id)) >= mod.reportsPerHour()) {
      res.set('Retry-After', '3600');
      return sendError(res, 429, 'rate_limited', 'You have sent a lot of reports. Please try again later.');
    }
    const r = await models.WantedReport.create({ wantedId: w.id, wantedTitle: w.title, reporterId: req.user.id, reason: body.reason, note });
    // Same optional auto-hide threshold as posts.
    const n = mod.autoHideThreshold();
    if (n && !w.hidden) {
      const reporters = await models.WantedReport.count({ where: { wantedId: w.id, status: 'open' }, distinct: true, col: 'reporterId' });
      if (reporters >= n) await w.update({ hidden: true, hiddenAt: new Date(), hiddenBy: null, hiddenSource: 'auto' });
    }
    return res.status(201).json({ id: r.id, wantedId: w.id, reason: r.reason, status: r.status, createdAt: r.createdAt });
  } catch (err) {
    if (err && err.name === 'SequelizeUniqueConstraintError') return conflict(res, dupe);
    return serverError(res, err);
  }
});

module.exports = router;
