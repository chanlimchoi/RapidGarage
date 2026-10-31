// POST /post/:id/report  { reason, note? }  reasons include suspicious and no_show (lib/safety.js)  (logged in; mounted by controllers/post.js
// after loadPost, so req.post is set and already visibility-checked)
const router = require('express').Router({ mergeParams: true });
const models = require('../models');
const { badRequest, forbidden, conflict, sendError, serverError } = require('../lib/http');
const mod = require('../lib/moderation');
const safety = require('../lib/safety');

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
    // One hourly budget for every kind of report (smaller for reporters whose
    // flags keep getting dismissed; lib/safety.js).
    if ((await mod.recentReportCount(req.user.id)) >= (await safety.hourlyBudget(req.user.id))) {
      res.set('Retry-After', '3600');
      return sendError(res, 429, 'rate_limited', 'You have sent a lot of reports. Please try again later.');
    }
    let contact = null;
    if (body.reason === 'no_show') {
      const chk = await safety.noShowCheck(req.user.id, post);
      if (chk.status) {
        if (chk.retryAfter) res.set('Retry-After', String(chk.retryAfter));
        return sendError(res, chk.status, chk.code, chk.message);
      }
      contact = chk.contact;
    }
    const report = await models.Report.create({ postId: post.id, postTitle: post.title, reporterId: req.user.id, sellerId: post.userId, reason: body.reason, note, contact });
    await mod.maybeAutoHide(post);
    await safety.afterReport(report, post);
    // Don't tell reporters whether the post got hidden.
    return res.status(201).json({ id: report.id, postId: post.id, reason: report.reason, status: report.status, createdAt: report.createdAt });
  } catch (err) {
    if (err && err.name === 'SequelizeUniqueConstraintError') return conflict(res, 'You already reported this post. A moderator will review it.');
    return serverError(res, err);
  }
});

module.exports = router;
