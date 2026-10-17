// POST /post/:id/report  { reason, note? }  (logged in; mounted by controllers/post.js
// after loadPost, so req.post is set and already visibility-checked)
const router = require('express').Router({ mergeParams: true });
const { Op } = require('sequelize');
const models = require('../models');
const { badRequest, forbidden, conflict, sendError, serverError } = require('../lib/http');
const mod = require('../lib/moderation');

router.post('/', async (req, res) => {
  const body = req.body || {};
  const errors = {};
  if (models.Report.REASONS.indexOf(body.reason) === -1) errors.reason = 'Choose a reason: ' + models.Report.REASONS.join(', ') + '.';
  let note = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') errors.note = 'Note must be text.';
    else if (body.note.trim().length > mod.NOTE_MAX) errors.note = 'Keep the note under ' + mod.NOTE_MAX + ' characters.';
    else note = body.note.trim() || null;
  }
  if (Object.keys(errors).length) return badRequest(res, 'Invalid report.', errors);
  const post = req.post;
  if (post.userId === req.user.id) return forbidden(res, "You can't report your own post.");
  try {
    const existing = await models.Report.findOne({ where: { postId: post.id, reporterId: req.user.id, status: 'open' } });
    if (existing) return conflict(res, 'You already reported this post. A moderator will review it.');
    const since = new Date(Date.now() - 3600 * 1000);
    const recent = await models.Report.count({ where: { reporterId: req.user.id, createdAt: { [Op.gte]: since } } });
    if (recent >= mod.reportsPerHour()) {
      res.set('Retry-After', '3600');
      return sendError(res, 429, 'rate_limited', 'You have sent a lot of reports. Please try again later.');
    }
    const report = await models.Report.create({ postId: post.id, postTitle: post.title, reporterId: req.user.id, reason: body.reason, note });
    await mod.maybeAutoHide(post);
    // Don't tell reporters whether the post got hidden.
    return res.status(201).json({ id: report.id, postId: post.id, reason: report.reason, status: report.status, createdAt: report.createdAt });
  } catch (err) {
    if (err && err.name === 'SequelizeUniqueConstraintError') return conflict(res, 'You already reported this post. A moderator will review it.');
    return serverError(res, err);
  }
});

module.exports = router;
