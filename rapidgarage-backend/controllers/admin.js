const router = require('express').Router();
const models = require('../models');
const { badRequest, forbidden, notFound, conflict, serverError, requireLogin, parseId } = require('../lib/http');
const { ROLES, isAdmin } = require('../lib/roles');
const { SETTINGS, getAllSettings, setSetting } = require('../lib/features');
const { Op } = require('sequelize');

function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) return forbidden(res, 'Admins only.');
  return next();
}

router.use(requireLogin, requireAdmin);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const USER_FIELDS = ['id', 'email', 'firstName', 'lastName', 'role', 'messagingBanned', 'createdAt'];

router.get('/users', (req, res) => {
  models.User.findAll({ attributes: USER_FIELDS, order: [['id', 'ASC']] })
    .then((users) => res.json(users.map((u) => {
      const out = {};
      USER_FIELDS.forEach((f) => { out[f] = u.get(f); });
      return out;
    })))
    .catch((err) => serverError(res, err));
});

router.put('/users/:id/role', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'User id must be a positive integer.');
  const role = req.body && req.body.role;
  if (ROLES.indexOf(role) === -1) return badRequest(res, 'Role must be one of: ' + ROLES.join(', ') + '.');
  return models.sequelize.transaction((t) =>
    models.User.findByPk(id, { transaction: t }).then((user) => {
      if (!user) return { status: 404 };
      if (user.role === role) return { status: 200, user };
      if (user.role === 'admin' && role !== 'admin') {
        return models.User.count({ where: { role: 'admin' }, transaction: t }).then((admins) => {
          if (admins <= 1) return { status: 409 };
          return user.update({ role }, { transaction: t }).then((u) => ({ status: 200, user: u }));
        });
      }
      return user.update({ role }, { transaction: t }).then((u) => ({ status: 200, user: u }));
    }))
    .then((r) => {
      if (r.status === 404) return notFound(res, 'User not found.');
      if (r.status === 409) return conflict(res, 'Cannot demote the last admin.');
      const out = {};
      USER_FIELDS.forEach((f) => { out[f] = r.user.get(f); });
      return res.json(out);
    })
    .catch((err) => serverError(res, err));
});

router.get('/settings', (req, res) => {
  getAllSettings().then((s) => res.json(s)).catch((err) => serverError(res, err));
});

router.put('/settings', (req, res) => {
  const body = req.body || {};
  const names = Object.keys(body);
  if (!names.length) return badRequest(res, 'No settings given.');
  const errors = {};
  names.forEach((n) => {
    if (!SETTINGS[n]) errors[n] = 'Unknown setting.';
    else if (typeof body[n] !== SETTINGS[n].type) errors[n] = 'Must be a ' + SETTINGS[n].type + '.';
  });
  if (Object.keys(errors).length) return badRequest(res, 'Invalid settings.', errors);
  return Promise.all(names.map((n) => setSetting(n, body[n])))
    .then(() => getAllSettings())
    .then((s) => res.json(s))
    .catch((err) => serverError(res, err));
});

// ---- Moderation ---------------------------------------------------------
const mod = require('../lib/moderation');
const { removePhotoFiles } = require('./photos');

const PERSON = ['id', 'email', 'firstName', 'lastName'];
const person = (u) => (u ? { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName } : null);

function preview(post) {
  if (!post) return null;
  const photos = post.photos || [];
  return {
    id: post.id, title: post.title, city: post.city, state: post.state, zipCode: post.zipCode,
    description: post.description ? String(post.description).slice(0, 280) : '',
    isFree: post.isFree, priceMin: post.priceMin, priceMax: post.priceMax,
    hidden: post.hidden, hiddenAt: post.hiddenAt, hiddenSource: post.hiddenSource, hiddenBy: post.hiddenBy,
    userId: post.userId, createdAt: post.createdAt,
    thumbUrl: photos.length ? photos[0].toJSON().thumbUrl : null,
  };
}

// Open reports grouped by post (most-reported first), plus hidden posts that
// no longer have open reports (so they can be unhidden).
router.get('/reports', async (req, res) => {
  try {
    const open = await models.Report.findAll({
      where: { status: 'open' },
      include: [{ model: models.User, as: 'reporter', attributes: PERSON }],
      order: [['createdAt', 'ASC']],
    });
    const ids = Array.from(new Set(open.map((r) => r.postId)));
    const posts = await models.Post.findAll({
      where: { [Op.or]: [{ id: ids }, { hidden: true }] },
      include: [{ model: models.PostPhoto, as: 'photos' }, { model: models.User, attributes: PERSON }],
    });
    const byId = new Map(posts.map((p) => [p.id, p]));
    const groups = new Map();
    open.forEach((r) => {
      if (!groups.has(r.postId)) {
        const p = byId.get(r.postId);
        groups.set(r.postId, { postId: r.postId, postTitle: r.postTitle, post: preview(p), owner: p ? person(p.User) : null, openCount: 0, reporterCount: 0, reasons: {}, firstReportedAt: r.createdAt, lastReportedAt: r.createdAt, reports: [] });
      }
      const g = groups.get(r.postId);
      g.openCount += 1;
      g.reasons[r.reason] = (g.reasons[r.reason] || 0) + 1;
      g.lastReportedAt = r.createdAt;
      g.reports.push({ id: r.id, reason: r.reason, note: r.note, reporter: person(r.reporter), createdAt: r.createdAt });
    });
    groups.forEach((g) => { g.reporterCount = new Set(g.reports.map((r) => r.reporter && r.reporter.id)).size; });
    const list = Array.from(groups.values()).sort((a, b) => b.openCount - a.openCount || new Date(a.firstReportedAt) - new Date(b.firstReportedAt));
    const hidden = posts.filter((p) => p.hidden && !groups.has(p.id)).map((p) => Object.assign(preview(p), { owner: person(p.User) }));
    const conversationOpenCount = await models.ConversationReport.count({ where: { status: 'open' } });
    return res.json({ groups: list, hidden, reasons: mod.REASON_LABELS, autoHideThreshold: mod.autoHideThreshold(), conversationOpenCount });
  } catch (err) {
    return serverError(res, err);
  }
});

// Resolved reports, newest first.
router.get('/reports/history', async (req, res) => {
  const page = parseId(req.query.page || '1');
  const pageSize = Math.min(100, parseId(req.query.pageSize || '25') || 25);
  if (!page) return badRequest(res, 'page must be a positive integer.');
  try {
    const { count, rows } = await models.Report.findAndCountAll({
      where: { status: { [Op.ne]: 'open' } },
      include: [{ model: models.User, as: 'reporter', attributes: PERSON }, { model: models.User, as: 'reviewer', attributes: PERSON }],
      order: [['reviewedAt', 'DESC'], ['id', 'DESC']],
      limit: pageSize, offset: (page - 1) * pageSize,
    });
    const existing = new Set((await models.Post.findAll({ attributes: ['id'], where: { id: rows.map((r) => r.postId) }, raw: true })).map((p) => p.id));
    return res.json({
      page, pageSize, total: count, totalPages: Math.max(1, Math.ceil(count / pageSize)),
      results: rows.map((r) => ({
        id: r.id, postId: r.postId, postTitle: r.postTitle, postExists: existing.has(r.postId),
        reason: r.reason, note: r.note, status: r.status, action: r.action, resolutionNote: r.resolutionNote,
        reporter: person(r.reporter), reviewer: person(r.reviewer), createdAt: r.createdAt, reviewedAt: r.reviewedAt,
      })),
    });
  } catch (err) {
    return serverError(res, err);
  }
});

const ACTIONS = ['dismiss', 'hide', 'unhide', 'delete'];

// POST /admin/posts/:id/moderate { action: dismiss|hide|unhide|delete, note? }
// Resolves every open report on the post.
router.post('/posts/:id/moderate', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Post id must be a positive integer.');
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
    const post = await models.Post.findByPk(id, { include: [{ model: models.PostPhoto, as: 'photos' }] });
    if (!post) return notFound(res, 'Post not found.');
    const by = req.user.id;
    let closed;
    if (body.action === 'delete') {
      closed = await mod.closeOpenReports(id, { status: 'actioned', action: 'deleted', reviewerId: by, resolutionNote: note });
      await removePhotoFiles(post.photos || []);
      await models.PostPhoto.destroy({ where: { postId: id } });
      await post.destroy();
      return res.json({ action: 'delete', postId: id, resolved: closed[0], post: null });
    }
    await models.sequelize.transaction(async (t) => {
      if (body.action === 'dismiss') {
        closed = await mod.closeOpenReports(id, { status: 'dismissed', action: 'dismissed', reviewerId: by, resolutionNote: note }, t);
      } else if (body.action === 'hide') {
        await mod.hide(post, by, 'moderator', t);
        closed = await mod.closeOpenReports(id, { status: 'actioned', action: 'hidden', reviewerId: by, resolutionNote: note }, t);
      } else {
        await mod.unhide(post, t);
        closed = await mod.closeOpenReports(id, { status: 'dismissed', action: 'unhidden', reviewerId: by, resolutionNote: note }, t);
      }
    });
    await post.reload();
    return res.json({ action: body.action, postId: id, resolved: closed[0], post: preview(post) });
  } catch (err) {
    return serverError(res, err);
  }
});

// Conversation reports (reported conversations only; see the file header).
router.use(require('./adminConversations'));

// Rating reports.
router.use(require('./adminRatings'));

module.exports = router;
module.exports.requireAdmin = requireAdmin;
