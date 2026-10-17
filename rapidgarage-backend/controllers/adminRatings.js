// Admin side of rating reports (mounted inside controllers/admin.js, so every
// route is behind requireLogin + requireAdmin).
//   GET  /admin/ratings/reports            open reports grouped by rating
//   POST /admin/ratings/:id/moderate       { action: dismiss|remove_comment|remove_rating, note? }
const router = require('express').Router();
const models = require('../models');
const { badRequest, notFound, serverError, parseId } = require('../lib/http');
const mod = require('../lib/moderation');
const { publicName } = require('../lib/people');

const PERSON = ['id', 'email', 'firstName', 'lastName'];
const ACTIONS = ['dismiss', 'remove_comment', 'remove_rating'];
const person = (u) => (u ? { id: u.id, name: publicName(u), email: u.email } : null);

router.get('/ratings/reports', async (req, res) => {
  try {
    const open = await models.RatingReport.findAll({
      where: { status: 'open' },
      include: [
        { model: models.User, as: 'reporter', attributes: PERSON },
        { model: models.Rating, include: [{ model: models.User, as: 'rater', attributes: PERSON }, { model: models.User, as: 'ratee', attributes: PERSON }] },
      ],
      order: [['createdAt', 'ASC']],
    });
    const groups = new Map();
    open.forEach((r) => {
      const g = groups.get(r.ratingId) || {
        ratingId: r.ratingId,
        rating: r.Rating ? { id: r.Rating.id, stars: r.Rating.stars, comment: r.Rating.comment, commentRemoved: !!r.Rating.commentRemovedAt, raterRole: r.Rating.raterRole, createdAt: r.Rating.createdAt, updatedAt: r.Rating.updatedAt } : null,
        rater: r.Rating ? person(r.Rating.rater) : null,
        ratee: r.Rating ? person(r.Rating.ratee) : null,
        reports: [],
      };
      g.reports.push({ id: r.id, reason: r.reason, note: r.note, reporter: person(r.reporter), createdAt: r.createdAt });
      groups.set(r.ratingId, g);
    });
    const list = Array.from(groups.values()).sort((a, b) => b.reports.length - a.reports.length || new Date(a.reports[0].createdAt) - new Date(b.reports[0].createdAt));
    return res.json({ groups: list, openCount: open.length, reasons: models.RatingReport.REASONS });
  } catch (err) { return serverError(res, err); }
});

router.post('/ratings/:id/moderate', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Rating id must be a positive integer.');
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
    const rating = await models.Rating.findByPk(id);
    if (!rating) return notFound(res, 'Rating not found.');
    const by = req.user.id;
    const now = new Date();
    let resolved = 0;
    await models.sequelize.transaction(async (transaction) => {
      const status = body.action === 'dismiss' ? 'dismissed' : 'actioned';
      const action = body.action === 'dismiss' ? 'dismissed' : body.action === 'remove_comment' ? 'comment_removed' : 'rating_removed';
      [resolved] = await models.RatingReport.update({ status, action, reviewerId: by, reviewedAt: now, resolutionNote: note }, { where: { ratingId: id, status: 'open' }, transaction });
      if (body.action === 'remove_comment') await rating.update({ comment: null, commentRemovedAt: now, commentRemovedBy: by }, { transaction, silent: true });
      // Removing the whole rating also deletes its reports (FK cascade).
      if (body.action === 'remove_rating') await rating.destroy({ transaction });
    });
    return res.json({ action: body.action, ratingId: id, resolved, rating: body.action === 'remove_rating' ? null : { id, commentRemoved: !!rating.commentRemovedAt } });
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
