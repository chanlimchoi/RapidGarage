// Admin side of wanted posts (mounted inside controllers/admin.js, so every
// route is behind requireLogin + requireAdmin).
//   GET  /admin/wanted/reports        open reports grouped by wanted post + hidden posts
//   POST /admin/wanted/:id/moderate   { action: dismiss|hide|unhide|delete, note? }
// Hiding takes a wanted post off the board, stops matching and blocks new
// conversations about it; existing conversations stay readable.
const router = require('express').Router();
const { Op } = require('sequelize');
const models = require('../models');
const { badRequest, notFound, serverError, parseId } = require('../lib/http');
const mod = require('../lib/moderation');
const W = require('../lib/wanted');
const { publicName } = require('../lib/people');

const PERSON = ['id', 'firstName', 'lastName'];
// Names only ("First L."); the queue never needs an email address.
const person = (u) => (u ? { id: u.id, name: publicName(u) } : null);
const ACTIONS = ['dismiss', 'hide', 'unhide', 'delete'];

function preview(w) {
  if (!w) return null;
  return {
    id: w.id, title: w.title, details: w.details ? String(w.details).slice(0, 280) : '', areaLabel: w.areaLabel, category: w.category || null,
    maxPriceCents: w.maxPriceCents, status: W.statusOf(w), expiresAt: w.expiresAt,
    hidden: w.hidden, hiddenAt: w.hiddenAt, hiddenSource: w.hiddenSource, poster: person(w.poster),
  };
}

router.get('/wanted/reports', async (req, res) => {
  try {
    const open = await models.WantedReport.findAll({ where: { status: 'open' }, include: [{ model: models.User, as: 'reporter', attributes: PERSON }], order: [['createdAt', 'ASC']] });
    const ids = Array.from(new Set(open.map((r) => r.wantedId)));
    const rows = await models.WantedPost.findAll({ where: { [Op.or]: [{ id: ids }, { hidden: true }] }, include: [{ model: models.User, as: 'poster', attributes: PERSON }] });
    const byId = new Map(rows.map((w) => [w.id, w]));
    const groups = new Map();
    open.forEach((r) => {
      if (!groups.has(r.wantedId)) groups.set(r.wantedId, { wantedId: r.wantedId, wantedTitle: r.wantedTitle, wanted: preview(byId.get(r.wantedId)), openCount: 0, reasons: {}, reports: [] });
      const g = groups.get(r.wantedId);
      g.openCount += 1;
      g.reasons[r.reason] = (g.reasons[r.reason] || 0) + 1;
      g.reports.push({ id: r.id, reason: r.reason, note: r.note, reporter: person(r.reporter), createdAt: r.createdAt });
    });
    const hidden = rows.filter((w) => w.hidden && !groups.has(w.id)).map(preview);
    return res.json({ groups: Array.from(groups.values()).sort((a, b) => b.openCount - a.openCount), hidden, reasons: mod.REASON_LABELS });
  } catch (err) { return serverError(res, err); }
});

router.post('/wanted/:id/moderate', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Wanted post id must be a positive integer.');
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
    const w = await models.WantedPost.findByPk(id, { include: [{ model: models.User, as: 'poster', attributes: PERSON }] });
    if (!w) return notFound(res, 'Wanted post not found.');
    const by = req.user.id;
    const close = (fields, transaction) => models.WantedReport.update(Object.assign({ reviewedAt: new Date(), reviewerId: by, resolutionNote: note }, fields), { where: { wantedId: id, status: 'open' }, transaction });
    let closed;
    await models.sequelize.transaction(async (t) => {
      if (body.action === 'dismiss') closed = await close({ status: 'dismissed', action: 'dismissed' }, t);
      else if (body.action === 'hide') {
        await w.update({ hidden: true, hiddenAt: new Date(), hiddenBy: by, hiddenSource: 'moderator' }, { transaction: t });
        await models.WantedMatch.update({ status: 'skipped', lastError: 'wanted_hidden' }, { where: { wantedId: id, status: 'pending' }, transaction: t });
        closed = await close({ status: 'actioned', action: 'hidden' }, t);
      } else if (body.action === 'unhide') {
        await w.update({ hidden: false, hiddenAt: null, hiddenBy: null, hiddenSource: null }, { transaction: t });
        closed = await close({ status: 'dismissed', action: 'unhidden' }, t);
      } else {
        closed = await close({ status: 'actioned', action: 'deleted' }, t);
        await models.WantedMatch.destroy({ where: { wantedId: id }, transaction: t });
        await models.WantedReport.destroy({ where: { wantedId: id }, transaction: t });
        await w.destroy({ transaction: t });
      }
    });
    if (body.action === 'delete') return res.json({ action: 'delete', wantedId: id, resolved: closed[0], wanted: null });
    return res.json({ action: body.action, wantedId: id, resolved: closed[0], wanted: preview(w) });
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
