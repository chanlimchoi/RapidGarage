// Admin side of neighborhood sales (mounted inside controllers/admin.js, so
// every route is behind requireLogin + requireAdmin).
//   GET  /admin/events/reports          open reports grouped by event + hidden events
//   POST /admin/events/:id/moderate     { action: dismiss|hide|unhide|delete, note? }
// Hiding an event takes it out of search, lists and its short link; the
// participating sales themselves stay visible (they are separate posts).
const router = require('express').Router();
const models = require('../models');
const { badRequest, notFound, serverError, parseId } = require('../lib/http');
const mod = require('../lib/moderation');
const events = require('../lib/events');
const { publicName } = require('../lib/people');

const PERSON = ['id', 'email', 'firstName', 'lastName'];
const person = (u) => (u ? { id: u.id, name: publicName(u), email: u.email } : null);
const ACTIONS = ['dismiss', 'hide', 'unhide', 'delete'];

function preview(e, counts) {
  if (!e) return null;
  return {
    id: e.id, name: e.name, areaLabel: e.areaLabel, description: e.description ? String(e.description).slice(0, 280) : '',
    status: events.statusOf(e), startDate: e.startDate, endDate: e.endDate, joinMode: e.joinMode,
    hidden: e.hidden, hiddenAt: e.hiddenAt, hiddenSource: e.hiddenSource, organizer: person(e.organizer),
    saleCount: counts ? counts.get(e.id) || 0 : undefined,
  };
}

router.get('/events/reports', async (req, res) => {
  try {
    const open = await models.EventReport.findAll({ where: { status: 'open' }, include: [{ model: models.User, as: 'reporter', attributes: PERSON }], order: [['createdAt', 'ASC']] });
    const ids = Array.from(new Set(open.map((r) => r.eventId)));
    const { Op } = require('sequelize');
    const rows = await models.SaleEvent.findAll({ where: { [Op.or]: [{ id: ids }, { hidden: true }] }, include: [{ model: models.User, as: 'organizer', attributes: PERSON }] });
    const counts = await events.publicSaleCounts(rows.map((e) => e.id));
    const byId = new Map(rows.map((e) => [e.id, e]));
    const groups = new Map();
    open.forEach((r) => {
      if (!groups.has(r.eventId)) groups.set(r.eventId, { eventId: r.eventId, eventName: r.eventName, event: preview(byId.get(r.eventId), counts), openCount: 0, reasons: {}, reports: [] });
      const g = groups.get(r.eventId);
      g.openCount += 1;
      g.reasons[r.reason] = (g.reasons[r.reason] || 0) + 1;
      g.reports.push({ id: r.id, reason: r.reason, note: r.note, reporter: person(r.reporter), createdAt: r.createdAt });
    });
    const hidden = rows.filter((e) => e.hidden && !groups.has(e.id)).map((e) => preview(e, counts));
    return res.json({ groups: Array.from(groups.values()).sort((a, b) => b.openCount - a.openCount), hidden, reasons: mod.REASON_LABELS });
  } catch (err) { return serverError(res, err); }
});

router.post('/events/:id/moderate', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Event id must be a positive integer.');
  const body = req.body || {};
  const errors = {};
  if (ACTIONS.indexOf(body.action) === -1) errors.action = 'action must be one of: ' + ACTIONS.join(', ') + '.';
  let note = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') errors.note = 'Note must be text.';
    else if (body.note.trim().length > mod.NOTE_MAX) errors.note = 'Keep the note under ' + mod.NOTE_MAX + ' characters.';
    else note = body.note.trim() || null;
  }
  if (Object.keys(errors).length) return badRequest(res, 'Invalid moderation request.', errors);
  try {
    const e = await models.SaleEvent.findByPk(id, { include: [{ model: models.User, as: 'organizer', attributes: PERSON }] });
    if (!e) return notFound(res, 'Neighborhood sale not found.');
    const by = req.user.id;
    const close = (fields, transaction) => models.EventReport.update(Object.assign({ reviewedAt: new Date(), reviewerId: by, resolutionNote: note }, fields), { where: { eventId: id, status: 'open' }, transaction });
    let closed;
    await models.sequelize.transaction(async (t) => {
      if (body.action === 'dismiss') closed = await close({ status: 'dismissed', action: 'dismissed' }, t);
      else if (body.action === 'hide') {
        await e.update({ hidden: true, hiddenAt: new Date(), hiddenBy: by, hiddenSource: 'moderator' }, { transaction: t });
        closed = await close({ status: 'actioned', action: 'hidden' }, t);
      } else if (body.action === 'unhide') {
        await e.update({ hidden: false, hiddenAt: null, hiddenBy: null, hiddenSource: null }, { transaction: t });
        closed = await close({ status: 'dismissed', action: 'unhidden' }, t);
      } else {
        closed = await close({ status: 'actioned', action: 'deleted' }, t);
        await models.EventParticipant.destroy({ where: { eventId: id }, transaction: t });
        await models.EventScanDay.destroy({ where: { eventId: id }, transaction: t });
        await models.EventReport.destroy({ where: { eventId: id }, transaction: t });
        await e.destroy({ transaction: t });
      }
    });
    if (body.action === 'delete') return res.json({ action: 'delete', eventId: id, resolved: closed[0], event: null });
    return res.json({ action: body.action, eventId: id, resolved: closed[0], event: preview(e) });
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
