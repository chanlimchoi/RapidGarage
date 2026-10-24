// Account self-service: download everything about me, and delete my account.
//
// Export: one JSON file with what the person created or received: profile,
// sales (with items and schedule), wanted posts, neighborhood sales they run,
// saved sales, alerts, follows, ratings, and their conversations (the other
// person appears as "First L."). Never password hashes, API keys, tokens or
// push endpoints.
//
// Delete: photo files first, then every row that belongs to the account (the
// database cascades the rest). Conversations go with it, for the other person
// too, as messages can't be kept without their author. The last admin can't
// delete themselves.
const { Op } = require('sequelize');
const { publicName } = require('./people');
const i18n = require('./i18n');
const mailer = require('./mailer');

function models() { return require('../models'); }

const plain = (rows) => rows.map((r) => (typeof r.get === 'function' ? r.get({ plain: true }) : r));

async function exportData(userId) {
  const m = models();
  const user = await m.User.findByPk(userId);
  const posts = await m.Post.findAll({
    where: { userId },
    include: [{ model: m.PostPhoto, as: 'photos' }, { model: m.SaleDay, as: 'saleDays' }, { model: m.SaleItem, as: 'items' }],
    order: [['id', 'ASC']],
  });
  const convs = await m.Conversation.findAll({ where: { [Op.or]: [{ buyerId: userId }, { sellerId: userId }] }, order: [['id', 'ASC']] });
  const otherIds = convs.map((c) => (c.buyerId === userId ? c.sellerId : c.buyerId));
  const others = new Map((await m.User.findAll({ where: { id: otherIds }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, u]));
  const messages = convs.length ? await m.Message.findAll({ where: { conversationId: convs.map((c) => c.id) }, order: [['id', 'ASC']] }) : [];
  const byConv = new Map();
  messages.forEach((msg) => { if (!byConv.has(msg.conversationId)) byConv.set(msg.conversationId, []); byConv.get(msg.conversationId).push(msg); });
  const [wanted, events, saved, alerts, follows, ratingsGiven, ratingsReceived, devices, inbox] = await Promise.all([
    m.WantedPost.findAll({ where: { userId } }),
    m.SaleEvent.findAll({ where: { organizerId: userId } }),
    m.SavedPost.findAll({ where: { userId }, attributes: ['postId', 'remind', 'createdAt'] }),
    m.SaleAlert.findAll({ where: { userId } }),
    m.Follow.findAll({ where: { followerId: userId }, include: [{ model: m.User, as: 'seller', attributes: ['id', 'firstName', 'lastName'] }] }),
    m.Rating.findAll({ where: { raterId: userId } }),
    m.Rating.findAll({ where: { rateeId: userId } }),
    m.PushSubscription.findAll({ where: { userId }, attributes: ['label', 'createdAt', 'lastSentAt'] }),
    m.Notification.findAll({ where: { userId }, attributes: ['kind', 'postId', 'createdAt', 'seenAt'], order: [['id', 'ASC']] }),
  ]);
  const profile = user.toJSON();
  return {
    format: 'rapidgarage-export-v1',
    exportedAt: new Date().toISOString(),
    profile,
    sales: posts.map((p) => p.toJSON()),
    wantedPosts: plain(wanted),
    neighborhoodSales: plain(events),
    savedSales: plain(saved),
    saleAlerts: plain(alerts),
    following: follows.map((f) => ({ seller: publicName(f.seller), notify: f.notify, since: f.createdAt })),
    ratingsGiven: plain(ratingsGiven),
    ratingsReceived: plain(ratingsReceived),
    notificationDevices: plain(devices),
    notifications: plain(inbox),
    conversations: convs.map((c) => {
      const other = others.get(c.buyerId === userId ? c.sellerId : c.buyerId);
      return {
        id: c.id,
        about: c.postTitle,
        role: c.buyerId === userId ? 'buyer' : 'seller',
        with: publicName(other),
        messages: (byConv.get(c.id) || []).map((msg) => ({ from: msg.senderId === userId ? 'me' : publicName(other), at: msg.createdAt, kind: msg.kind, body: msg.removedAt ? null : msg.body, removedByModerator: !!msg.removedAt })),
      };
    }),
  };
}

// Resolves to { ok } or { reason: 'last_admin' }.
async function deleteAccount(userId) {
  const m = models();
  const user = await m.User.findByPk(userId);
  if (!user) return { ok: true };
  if (user.role === 'admin' && (await m.User.count({ where: { role: 'admin' } })) <= 1) return { reason: 'last_admin' };
  const { removePhotoFiles } = require('../controllers/photos');
  const posts = await m.Post.findAll({ where: { userId }, include: [{ model: m.PostPhoto, as: 'photos' }] });
  for (const p of posts) {
    await removePhotoFiles(p.photos || []);
    await require('./moderation').closeOpenReports(p.id, { status: 'actioned', action: 'deleted', reviewerId: null, resolutionNote: 'Account deleted.' });
    await m.SaleItem.destroy({ where: { postId: p.id } });
    await m.Notification.destroy({ where: { postId: p.id } });
    await m.PostPhoto.destroy({ where: { postId: p.id } });
    await p.destroy();
  }
  // Rows whose foreign keys may not cascade on every database.
  const convIds = (await m.Conversation.findAll({ where: { [Op.or]: [{ buyerId: userId }, { sellerId: userId }] }, attributes: ['id'], raw: true })).map((c) => c.id);
  if (convIds.length) {
    await m.Message.destroy({ where: { conversationId: convIds } });
    await m.Rating.destroy({ where: { conversationId: convIds } });
    await m.Conversation.destroy({ where: { id: convIds } });
  }
  await Promise.all([
    m.Follow.destroy({ where: { [Op.or]: [{ followerId: userId }, { sellerId: userId }] } }),
    m.SavedPost.destroy({ where: { userId } }),
    m.Notification.destroy({ where: { userId } }),
    m.SaleAlert.destroy({ where: { userId } }),
    m.PushSubscription.destroy({ where: { userId } }),
    m.PasswordReset.destroy({ where: { userId } }),
    m.EmailVerification.destroy({ where: { userId } }),
    m.UserBlock.destroy({ where: { [Op.or]: [{ blockerId: userId }, { blockedId: userId }] } }),
  ]);
  await m.WantedPost.destroy({ where: { userId } });
  await m.SaleEvent.destroy({ where: { organizerId: userId } });
  const email = user.email;
  const lang = i18n.normalize(user.locale) || 'en';
  const name = user.firstName;
  await user.destroy();
  if (mailer.isConfigured() && email) {
    const L = (k, v) => i18n.t(lang, k, v);
    mailer.send({ to: email, subject: L('account.deletedSubject'), text: [name ? L('mail.hi', { name }) : L('mail.hiAnon'), '', L('account.deletedText')].join('\n'), headers: { 'Content-Language': lang } })
      .catch((err) => console.error('Account deletion notice failed:', err && (err.code || err.name)));
  }
  return { ok: true };
}

module.exports = { exportData, deleteAccount };
