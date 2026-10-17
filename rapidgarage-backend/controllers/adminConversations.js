// Admin side of conversation reports. Mounted inside controllers/admin.js, so
// every route here is already behind requireLogin + requireAdmin.
//
// Read rule (enforced here, nowhere else gives admins message access):
//   * never reported            -> 404, exactly like any non-participant
//   * at least one OPEN report  -> every message, before and after the report
//   * only RESOLVED reports     -> messages up to the latest resolution time
//                                  (the history view); anything sent after
//                                  that stays private until someone reports again
// Every read is written to ConversationModerationEvents (type "read").
const router = require('express').Router();
const { Op } = require('sequelize');
const models = require('../models');
const { badRequest, notFound, serverError, parseId } = require('../lib/http');
const mod = require('../lib/moderation');
const { publicName } = require('../lib/people');

const PERSON = ['id', 'email', 'firstName', 'lastName', 'messagingBanned', 'messagingBannedAt'];
const ACTIONS = ['dismiss', 'warn', 'ban', 'unban', 'remove_message'];

const person = (u) => (u ? { id: u.id, name: publicName(u), email: u.email, messagingBanned: !!u.messagingBanned } : null);

async function loadConv(id) {
  return models.Conversation.findByPk(id, {
    include: [{ model: models.User, as: 'buyer', attributes: PERSON }, { model: models.User, as: 'seller', attributes: PERSON }],
  });
}

// What an admin may see of a conversation right now; null = no access.
async function accessWindow(conversationId) {
  const reports = await models.ConversationReport.findAll({ where: { conversationId }, order: [['id', 'ASC']] });
  if (!reports.length) return null;
  const open = reports.filter((r) => r.status === 'open');
  if (open.length) return { mode: 'open', until: null, reportId: open[open.length - 1].id, reports };
  const last = reports.reduce((a, b) => (new Date(b.reviewedAt) > new Date(a.reviewedAt) ? b : a));
  return { mode: 'history', until: last.reviewedAt, reportId: last.id, reports };
}

async function postContext(conv) {
  if (conv.wantedId) {
    const w = await models.WantedPost.findByPk(conv.wantedId, { attributes: ['id', 'title', 'hidden', 'userId'] });
    return { id: conv.wantedId, wanted: true, title: w ? w.title : conv.postTitle, status: !w ? 'deleted' : w.hidden ? 'hidden' : 'available' };
  }
  const post = await models.Post.findByPk(conv.postId, { attributes: ['id', 'title', 'hidden', 'userId'] });
  return { id: conv.postId, title: post ? post.title : conv.postTitle, status: !post ? 'deleted' : post.hidden ? 'hidden' : 'available' };
}

function participants(conv) {
  return [Object.assign({ role: 'buyer' }, person(conv.buyer)), Object.assign({ role: 'seller' }, person(conv.seller))];
}

function reportJSON(r, byId) {
  return {
    id: r.id, reason: r.reason, note: r.note, status: r.status, action: r.action,
    reporter: byId(r.reporterId), reportedUser: byId(r.reportedUserId),
    reviewer: r.reviewer ? person(r.reviewer) : null, reviewedAt: r.reviewedAt, resolutionNote: r.resolutionNote,
    createdAt: r.createdAt,
  };
}

function lookup(conv) {
  const ps = participants(conv);
  return (id) => ps.filter((p) => p.id === id)[0] || { id, name: 'Former user' };
}

// GET /admin/conversation-reports : open reports grouped by conversation.
// No message text here; reading needs the detail view (which is logged).
router.get('/conversation-reports', async (req, res) => {
  try {
    const open = await models.ConversationReport.findAll({ where: { status: 'open' }, order: [['createdAt', 'ASC']] });
    const ids = Array.from(new Set(open.map((r) => r.conversationId)));
    const groups = [];
    for (const id of ids) {
      const conv = await loadConv(id);
      if (!conv) continue;
      const byId = lookup(conv);
      const reports = open.filter((r) => r.conversationId === id);
      const reasons = {};
      reports.forEach((r) => { reasons[r.reason] = (reasons[r.reason] || 0) + 1; });
      groups.push({
        conversationId: id, post: await postContext(conv), participants: participants(conv),
        openCount: reports.length, reasons, lastReportedAt: reports[reports.length - 1].createdAt,
        reports: reports.map((r) => reportJSON(r, byId)),
      });
    }
    groups.sort((a, b) => b.openCount - a.openCount || new Date(b.lastReportedAt) - new Date(a.lastReportedAt));
    return res.json({ groups, openCount: open.length, reasons: models.ConversationReport.REASONS });
  } catch (err) {
    return serverError(res, err);
  }
});

// GET /admin/conversation-reports/history?page= : resolved reports.
router.get('/conversation-reports/history', async (req, res) => {
  const page = parseId(req.query.page || '1');
  if (!page) return badRequest(res, 'page must be a positive integer.');
  const pageSize = 25;
  try {
    const { count, rows } = await models.ConversationReport.findAndCountAll({
      where: { status: { [Op.ne]: 'open' } },
      include: [
        { model: models.User, as: 'reporter', attributes: PERSON }, { model: models.User, as: 'reportedUser', attributes: PERSON },
        { model: models.User, as: 'reviewer', attributes: PERSON }, { model: models.Conversation, attributes: ['id', 'postId', 'postTitle'] },
      ],
      order: [['reviewedAt', 'DESC'], ['id', 'DESC']], limit: pageSize, offset: (page - 1) * pageSize,
    });
    return res.json({
      page, pageSize, total: count, totalPages: Math.max(1, Math.ceil(count / pageSize)),
      results: rows.map((r) => ({
        id: r.id, conversationId: r.conversationId, postTitle: r.Conversation ? r.Conversation.postTitle : null,
        reason: r.reason, note: r.note, status: r.status, action: r.action, resolutionNote: r.resolutionNote,
        reporter: person(r.reporter), reportedUser: person(r.reportedUser), reviewer: person(r.reviewer),
        createdAt: r.createdAt, reviewedAt: r.reviewedAt,
      })),
    });
  } catch (err) {
    return serverError(res, err);
  }
});

// GET /admin/conversations/:id : read-only view of a reported conversation.
router.get('/conversations/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Conversation id must be a positive integer.');
  try {
    const conv = await loadConv(id);
    const access = conv ? await accessWindow(id) : null;
    if (!conv || !access) return notFound(res, 'Conversation not found.');
    await models.ConversationModerationEvent.create({ conversationId: id, reportId: access.reportId, adminId: req.user.id, type: 'read' });
    const where = { conversationId: id };
    if (access.until) where.createdAt = { [Op.lte]: access.until };
    const [messages, events, reports, laterCount] = await Promise.all([
      models.Message.findAll({ where, order: [['id', 'ASC']] }),
      models.ConversationModerationEvent.findAll({ where: { conversationId: id }, include: [{ model: models.User, as: 'admin', attributes: PERSON }], order: [['id', 'DESC']], limit: 200 }),
      models.ConversationReport.findAll({ where: { conversationId: id }, include: [{ model: models.User, as: 'reviewer', attributes: PERSON }], order: [['id', 'ASC']] }),
      access.until ? models.Message.count({ where: { conversationId: id, createdAt: { [Op.gt]: access.until } } }) : 0,
    ]);
    const byId = lookup(conv);
    return res.json({
      conversation: { id, post: await postContext(conv), participants: participants(conv), createdAt: conv.createdAt },
      access: { mode: access.mode, until: access.until, hiddenLaterMessages: laterCount },
      reports: reports.map((r) => reportJSON(r, byId)),
      messages: messages.map((m) => ({
        id: m.id, body: m.body, sender: byId(m.senderId), createdAt: m.createdAt,
        removed: !!m.removedAt, removedAt: m.removedAt,
      })),
      events: events.map((e) => ({
        id: e.id, type: e.type, reportId: e.reportId, admin: person(e.admin), note: e.note,
        targetUser: e.targetUserId ? byId(e.targetUserId) : null, messageId: e.messageId, createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    return serverError(res, err);
  }
});

function closeOpen(conversationId, fields) {
  return models.ConversationReport.update(Object.assign({ reviewedAt: new Date() }, fields), { where: { conversationId, status: 'open' } });
}

// POST /admin/conversations/:id/moderate
//   { action: dismiss|warn|ban|unban|remove_message, userId?, messageId?, note? }
// dismiss / warn / ban resolve every open report; unban and remove_message don't.
router.post('/conversations/:id/moderate', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Conversation id must be a positive integer.');
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
    const conv = await loadConv(id);
    const access = conv ? await accessWindow(id) : null;
    if (!conv || !access) return notFound(res, 'Conversation not found.');
    const admin = req.user.id;
    const reportId = access.mode === 'open' ? access.reportId : null;
    const userId = body.userId === undefined || body.userId === null ? null : parseId(body.userId);
    const needsUser = body.action === 'ban' || body.action === 'unban';
    if ((needsUser && !userId) || (userId && !conv.isParticipant(userId))) {
      return badRequest(res, 'Choose one of the two participants.', { userId: 'Must be a participant in this conversation.' });
    }
    const event = { conversationId: id, reportId, adminId: admin, type: body.action, targetUserId: userId, note };
    let resolved = 0;
    if (body.action === 'remove_message') {
      const messageId = parseId(body.messageId);
      const where = { id: messageId || 0, conversationId: id };
      if (access.until) where.createdAt = { [Op.lte]: access.until };
      const m = messageId ? await models.Message.findOne({ where }) : null;
      if (!m) return notFound(res, 'Message not found in this conversation.');
      if (!m.removedAt) await m.update({ removedAt: new Date(), removedBy: admin });
      event.messageId = m.id;
      event.targetUserId = m.senderId;
    } else if (body.action === 'ban' || body.action === 'unban') {
      const ban = body.action === 'ban';
      await models.User.update({ messagingBanned: ban, messagingBannedAt: ban ? new Date() : null }, { where: { id: userId } });
      if (ban) resolved = (await closeOpen(id, { status: 'actioned', action: 'banned', reviewerId: admin, resolutionNote: note }))[0];
    } else if (body.action === 'warn') {
      resolved = (await closeOpen(id, { status: 'actioned', action: 'warned', reviewerId: admin, resolutionNote: note }))[0];
    } else {
      resolved = (await closeOpen(id, { status: 'dismissed', action: 'dismissed', reviewerId: admin, resolutionNote: note }))[0];
    }
    await models.ConversationModerationEvent.create(event);
    const fresh = await loadConv(id);
    return res.json({ action: body.action, conversationId: id, resolved, participants: participants(fresh) });
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
