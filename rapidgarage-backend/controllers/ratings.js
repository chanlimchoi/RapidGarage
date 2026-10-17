// Ratings after a chat.
//   GET    /ratings/conversations/:id   my rating, theirs, and whether I may rate (participants)
//   PUT    /ratings/conversations/:id   { stars 1-5, comment? } create or edit mine
//   DELETE /ratings/conversations/:id   remove mine
//   GET    /ratings/users/:id           public: summary + ratings of a person
//   POST   /ratings/:id/report          { reason, note? }
const router = require('express').Router();
const { Op } = require('sequelize');
const models = require('../models');
const { badRequest, forbidden, notFound, sendError, serverError, requireLogin, parseId } = require('../lib/http');
const mod = require('../lib/moderation');
const ratings = require('../lib/ratings');
const { publicUser } = require('../lib/people');

const PERSON = ['id', 'firstName', 'lastName'];
const PAGE_SIZE = 20;

const WHY = {
  needs_messages: 'You can rate each other once you have both sent a message.',
  blocked: "You can't rate someone you've blocked or who blocked you.",
  former_user: 'This person has left RapidGarage.',
};

async function loadConversation(req, res, next) {
  const id = parseId(req.params.id);
  if (!id) return notFound(res, 'Conversation not found.');
  try {
    const conv = await models.Conversation.findByPk(id, {
      include: [{ model: models.User, as: 'buyer', attributes: PERSON }, { model: models.User, as: 'seller', attributes: PERSON }],
    });
    // Same rule as messaging: non-participants (admins included) get 404.
    if (!conv || !conv.isParticipant(req.user.id)) return notFound(res, 'Conversation not found.');
    req.conversation = conv;
    return next();
  } catch (err) { return serverError(res, err); }
}

async function state(conv, me) {
  const other = conv.otherId(me);
  const [mine, theirs, el] = await Promise.all([
    models.Rating.findOne({ where: { conversationId: conv.id, raterId: me } }),
    models.Rating.findOne({ where: { conversationId: conv.id, raterId: other } }),
    ratings.eligibility(conv, me),
  ]);
  const otherUser = me === conv.buyerId ? conv.seller : conv.buyer;
  return {
    conversationId: conv.id,
    other: publicUser(otherUser),
    otherSummary: await ratings.summaryOf(other),
    canRate: el.canRate,
    reason: el.reason,
    reasonText: el.reason ? WHY[el.reason] : null,
    mine: mine ? Object.assign(ratings.ratingJSON(mine, me), { commentLocked: !!mine.commentRemovedAt }) : null,
    theirs: theirs ? ratings.ratingJSON(theirs, me) : null,
    commentMax: ratings.COMMENT_MAX,
  };
}

router.get('/conversations/:id', requireLogin, loadConversation, async (req, res) => {
  try { return res.json(await state(req.conversation, req.user.id)); } catch (err) { return serverError(res, err); }
});

router.put('/conversations/:id', requireLogin, loadConversation, async (req, res) => {
  const me = req.user.id;
  const conv = req.conversation;
  const { errors, value } = ratings.validate(req.body);
  if (Object.keys(errors).length) return badRequest(res, 'Invalid rating.', errors);
  try {
    const el = await ratings.eligibility(conv, me);
    if (!el.canRate) return sendError(res, 403, el.reason, WHY[el.reason]);
    const existing = await models.Rating.findOne({ where: { conversationId: conv.id, raterId: me } });
    if (existing) {
      // A comment a moderator removed can't be put back (stars stay editable).
      if (existing.commentRemovedAt && value.comment) return sendError(res, 400, 'comment_locked', 'A moderator removed your comment, so this rating can no longer have one.', { comment: 'Comments are turned off for this rating.' });
      const patch = { stars: value.stars };
      if (!existing.commentRemovedAt) patch.comment = value.comment;
      await existing.update(patch);
      return res.json(await state(conv, me));
    }
    await models.Rating.create({ conversationId: conv.id, raterId: me, rateeId: conv.otherId(me), raterRole: me === conv.buyerId ? 'buyer' : 'seller', stars: value.stars, comment: value.comment });
    return res.status(201).json(await state(conv, me));
  } catch (err) {
    if (err && err.name === 'SequelizeUniqueConstraintError') return sendError(res, 409, 'conflict', 'You already rated this conversation. Edit your rating instead.');
    return serverError(res, err);
  }
});

router.delete('/conversations/:id', requireLogin, loadConversation, async (req, res) => {
  try {
    await models.Rating.destroy({ where: { conversationId: req.conversation.id, raterId: req.user.id }, individualHooks: true });
    return res.json(await state(req.conversation, req.user.id));
  } catch (err) { return serverError(res, err); }
});

// Public profile ratings. No emails, names as "First L.".
router.get('/users/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return notFound(res, 'Person not found.');
  const page = parseId(req.query.page || '1');
  if (!page) return badRequest(res, 'page must be a positive integer.');
  try {
    const user = await models.User.findByPk(id, { attributes: PERSON });
    if (!user) return notFound(res, 'Person not found.');
    const [summary, dist, { count, rows }] = await Promise.all([
      ratings.summaryOf(id),
      models.Rating.findAll({ attributes: ['stars', [models.sequelize.fn('COUNT', models.sequelize.col('id')), 'n']], where: { rateeId: id }, group: ['stars'], raw: true }),
      models.Rating.findAndCountAll({ where: { rateeId: id }, include: [{ model: models.User, as: 'rater', attributes: PERSON }], order: [['updatedAt', 'DESC'], ['id', 'DESC']], limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    ]);
    const me = req.user ? req.user.id : null;
    const reported = me ? new Set((await models.RatingReport.findAll({ where: { reporterId: me, status: 'open', ratingId: rows.map((r) => r.id) }, attributes: ['ratingId'], raw: true })).map((r) => r.ratingId)) : new Set();
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    dist.forEach((d) => { distribution[d.stars] = Number(d.n); });
    return res.json({
      user: publicUser(user), summary, distribution,
      page, pageSize: PAGE_SIZE, total: count, totalPages: Math.max(1, Math.ceil(count / PAGE_SIZE)),
      ratings: rows.map((r) => Object.assign(ratings.ratingJSON(r, me), { reportedByMe: reported.has(r.id) })),
    });
  } catch (err) { return serverError(res, err); }
});

router.post('/:id/report', requireLogin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return notFound(res, 'Rating not found.');
  const body = req.body || {};
  const errors = {};
  const REASONS = models.RatingReport.REASONS;
  if (REASONS.indexOf(body.reason) === -1) errors.reason = 'Choose a reason: ' + REASONS.join(', ') + '.';
  let note = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') errors.note = 'Note must be text.';
    else if (body.note.trim().length > mod.NOTE_MAX) errors.note = 'Keep the note under ' + mod.NOTE_MAX + ' characters.';
    else note = body.note.trim() || null;
  }
  if (Object.keys(errors).length) return badRequest(res, 'Invalid report.', errors);
  const me = req.user.id;
  try {
    const rating = await models.Rating.findByPk(id);
    if (!rating) return notFound(res, 'Rating not found.');
    if (rating.raterId === me) return forbidden(res, "You can't report your own rating. Edit or delete it instead.");
    const existing = await models.RatingReport.findOne({ where: { ratingId: id, reporterId: me, status: 'open' } });
    if (existing) return sendError(res, 409, 'conflict', 'You already reported this rating. A moderator will review it.');
    // Shares the hourly report limit with post and conversation reports.
    const since = new Date(Date.now() - 3600 * 1000);
    const counts = await Promise.all([models.Report, models.ConversationReport, models.RatingReport].map((M) => M.count({ where: { reporterId: me, createdAt: { [Op.gte]: since } } })));
    if (counts.reduce((a, b) => a + b, 0) >= mod.reportsPerHour()) {
      res.set('Retry-After', '3600');
      return sendError(res, 429, 'rate_limited', 'You have sent a lot of reports. Please try again later.');
    }
    const r = await models.RatingReport.create({ ratingId: id, reporterId: me, reason: body.reason, note });
    return res.status(201).json({ id: r.id, ratingId: id, reason: r.reason, status: r.status, createdAt: r.createdAt });
  } catch (err) {
    if (err && err.name === 'SequelizeUniqueConstraintError') return sendError(res, 409, 'conflict', 'You already reported this rating. A moderator will review it.');
    return serverError(res, err);
  }
});

module.exports = router;
