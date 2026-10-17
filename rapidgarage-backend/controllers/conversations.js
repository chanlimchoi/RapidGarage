// Buyer-seller messaging. Every route needs login; a conversation is only
// visible to its two participants (everyone else, admins included, gets 404).
const router = require('express').Router();
const { Op } = require('sequelize');
const models = require('../models');
const { badRequest, forbidden, notFound, sendError, serverError, requireLogin, parseId } = require('../lib/http');
const mod = require('../lib/moderation');
const msg = require('../lib/messaging');
const { publicUser } = require('../lib/people');
const ratings = require('../lib/ratings');

const PERSON = ['id', 'firstName', 'lastName'];

router.use(requireLogin);

// How the post looks from inside a conversation.
function postSummary(conv, post, me) {
  if (!post) return { id: conv.postId, title: conv.postTitle, status: 'deleted', canView: false, thumbUrl: null };
  const canView = mod.canSee(me, post);
  const photos = post.photos || [];
  return {
    id: post.id,
    title: post.title,
    status: post.hidden ? 'hidden' : 'available',
    canView,
    thumbUrl: canView && photos.length ? photos[0].toJSON().thumbUrl : null,
  };
}

function messageJSON(m, me) {
  // Removed by a moderator: participants get a placeholder, never the text.
  if (m.removedAt) return { id: m.id, body: null, removed: true, senderId: m.senderId, mine: m.senderId === me, createdAt: m.createdAt };
  return { id: m.id, body: m.body, senderId: m.senderId, mine: m.senderId === me, createdAt: m.createdAt };
}

const BANNED_MSG = 'A moderator has turned off messaging for your account. You can still read your conversations.';

async function loadPosts(ids) {
  if (!ids.length) return new Map();
  const posts = await models.Post.findAll({ where: { id: ids }, include: [{ model: models.PostPhoto, as: 'photos' }] });
  posts.forEach((p) => (p.photos || []).sort((a, b) => a.position - b.position));
  return new Map(posts.map((p) => [p.id, p]));
}

async function summarize(conv, user, post, unread, blocks, last) {
  const me = user.id;
  const other = me === conv.buyerId ? conv.seller : conv.buyer;
  return {
    id: conv.id,
    role: me === conv.buyerId ? 'buyer' : 'seller',
    post: postSummary(conv, post, user),
    other: publicUser(other),
    otherRating: other ? (await ratings.summaries([other.id])).get(other.id) : null,
    lastMessage: last ? messageJSON(last, me) : null,
    lastMessageAt: conv.lastMessageAt,
    unreadCount: unread || 0,
    blocked: blocks,
    createdAt: conv.createdAt,
  };
}

// Load :id for a participant (404 otherwise, so ids can't be probed).
async function loadConversation(req, res, next) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Conversation id must be a positive integer.');
  try {
    const conv = await models.Conversation.findByPk(id, {
      include: [{ model: models.User, as: 'buyer', attributes: PERSON }, { model: models.User, as: 'seller', attributes: PERSON }],
    });
    if (!conv || !conv.isParticipant(req.user.id)) return notFound(res, 'Conversation not found.');
    req.conversation = conv;
    return next();
  } catch (err) {
    return serverError(res, err);
  }
}

// GET /conversations : my conversations, most recent activity first.
// The seller only sees a conversation once the buyer has sent something.
router.get('/', async (req, res) => {
  const me = req.user.id;
  try {
    const convs = await models.Conversation.findAll({
      where: { [Op.or]: [{ buyerId: me }, { sellerId: me, lastMessageAt: { [Op.ne]: null } }] },
      include: [{ model: models.User, as: 'buyer', attributes: PERSON }, { model: models.User, as: 'seller', attributes: PERSON }],
      order: [['lastMessageAt', 'DESC'], ['createdAt', 'DESC']],
      limit: 200,
    });
    const ids = convs.map((c) => c.id);
    const [posts, unread, blocks, lasts] = await Promise.all([
      loadPosts(Array.from(new Set(convs.map((c) => c.postId)))),
      msg.unreadCounts(me, ids),
      models.UserBlock.findAll({ where: { [Op.or]: [{ blockerId: me }, { blockedId: me }] }, raw: true }),
      ids.length ? models.Message.findAll({
        where: { id: { [Op.in]: models.sequelize.literal('(SELECT MAX(id) FROM "Messages" WHERE "conversationId" IN (' + ids.join(',') + ') GROUP BY "conversationId")') } },
      }) : [],
    ]);
    const lastBy = new Map(lasts.map((m) => [m.conversationId, m]));
    const results = await Promise.all(convs.map((c) => {
      const other = c.otherId(me);
      const b = { byMe: blocks.some((x) => x.blockerId === me && x.blockedId === other), byThem: blocks.some((x) => x.blockerId === other && x.blockedId === me) };
      return summarize(c, req.user, posts.get(c.postId), unread.get(c.id), b, lastBy.get(c.id));
    }));
    // Nulls (no messages yet) sort last regardless of DB null ordering.
    results.sort((a, b) => new Date(b.lastMessageAt || b.createdAt) - new Date(a.lastMessageAt || a.createdAt));
    return res.json({ results, unreadTotal: results.reduce((n, r) => n + r.unreadCount, 0) });
  } catch (err) {
    return serverError(res, err);
  }
});

// GET /conversations/unread : { count, conversations } for the nav badge.
router.get('/unread', async (req, res) => {
  try {
    const counts = await msg.unreadCounts(req.user.id, null);
    let count = 0;
    counts.forEach((n) => { count += n; });
    return res.json({ count, conversations: counts.size });
  } catch (err) {
    return serverError(res, err);
  }
});

// POST /conversations { postId } : start (201) or reuse (200) my conversation
// with the seller of postId.
router.post('/', async (req, res) => {
  const me = req.user.id;
  const postId = parseId((req.body || {}).postId);
  if (!postId) return badRequest(res, 'postId must be a positive integer.', { postId: 'Choose a post.' });
  try {
    const post = await models.Post.findByPk(postId);
    if (!post) return notFound(res, 'Post not found.');
    if (post.userId === me) return forbidden(res, "You can't message yourself.");
    if (req.user.messagingBanned) return sendError(res, 403, 'messaging_banned', BANNED_MSG);
    // An existing conversation stays reachable even if the post was hidden since.
    const existing = await models.Conversation.findOne({ where: { postId, buyerId: me, sellerId: post.userId } });
    if (existing) return res.status(200).json({ id: existing.id, created: false });
    if (!mod.canSee(req.user, post)) return notFound(res, 'Post not found.');
    if (post.hidden) return sendError(res, 403, 'post_unavailable', 'This post is unavailable, so you can\'t start a new conversation about it.');
    const blocks = await msg.blockState(me, post.userId);
    if (blocks.byMe || blocks.byThem) return sendError(res, 403, 'blocked', "You can't message this person.");
    const since = new Date(Date.now() - 3600 * 1000);
    const recent = await models.Conversation.count({ where: { buyerId: me, createdAt: { [Op.gte]: since } } });
    if (recent >= msg.conversationsPerHour()) {
      res.set('Retry-After', '3600');
      return sendError(res, 429, 'rate_limited', 'You have started a lot of conversations. Please try again later.');
    }
    const [conv, created] = await models.Conversation.findOrCreate({
      where: { postId, buyerId: me, sellerId: post.userId },
      defaults: { postTitle: post.title },
    });
    return res.status(created ? 201 : 200).json({ id: conv.id, created });
  } catch (err) {
    if (err && err.name === 'SequelizeUniqueConstraintError') {
      const conv = await models.Conversation.findOne({ where: { postId, buyerId: me } });
      if (conv) return res.status(200).json({ id: conv.id, created: false });
    }
    return serverError(res, err);
  }
});

async function markRead(conv, me, messages) {
  const newest = messages.filter((m) => m.senderId !== me).reduce((t, m) => (!t || m.createdAt > t ? m.createdAt : t), null);
  const field = conv.lastReadField(me);
  if (newest && (!conv[field] || newest > conv[field])) await conv.update({ [field]: newest }, { silent: true });
}

// GET /conversations/:id : conversation + the newest page of messages
// (oldest first). Marks them read.
router.get('/:id', loadConversation, async (req, res) => {
  const me = req.user.id;
  const conv = req.conversation;
  try {
    const rows = await models.Message.findAll({ where: { conversationId: conv.id }, order: [['id', 'DESC']], limit: msg.PAGE_SIZE + 1 });
    const hasMore = rows.length > msg.PAGE_SIZE;
    const messages = rows.slice(0, msg.PAGE_SIZE).reverse();
    await markRead(conv, me, messages);
    const posts = await loadPosts([conv.postId]);
    const blocks = await msg.blockState(me, conv.otherId(me));
    const summary = await summarize(conv, req.user, posts.get(conv.postId), 0, blocks, messages[messages.length - 1]);
    summary.messagingBanned = !!req.user.messagingBanned;
    summary.canSend = !blocks.byMe && !blocks.byThem && !summary.messagingBanned;
    // Only *your own* open report is ever mentioned to a participant.
    summary.reportedByMe = !!(await models.ConversationReport.count({ where: { conversationId: conv.id, reporterId: me, status: 'open' } }));
    return res.json({ conversation: summary, messages: messages.map((m) => messageJSON(m, me)), hasMore });
  } catch (err) {
    return serverError(res, err);
  }
});

// GET /conversations/:id/messages?before=<id> (older page) or ?after=<id>
// (new since last poll; marks read). Oldest first.
router.get('/:id/messages', loadConversation, async (req, res) => {
  const me = req.user.id;
  const conv = req.conversation;
  const before = req.query.before !== undefined ? parseId(req.query.before) : undefined;
  const after = req.query.after !== undefined ? (req.query.after === '0' ? 0 : parseId(req.query.after)) : undefined;
  if (before === null || after === null) return badRequest(res, 'before/after must be message ids.');
  const limit = Math.min(100, parseId(req.query.limit || '') || msg.PAGE_SIZE);
  try {
    const where = { conversationId: conv.id };
    if (before) where.id = { [Op.lt]: before };
    if (after !== undefined) where.id = { [Op.gt]: after };
    const rows = await models.Message.findAll({ where, order: [['id', after !== undefined ? 'ASC' : 'DESC']], limit: limit + 1 });
    const hasMore = rows.length > limit;
    let messages = rows.slice(0, limit);
    if (after === undefined) messages = messages.reverse();
    else await markRead(conv, me, messages);
    if (before === undefined && after === undefined) await markRead(conv, me, messages);
    return res.json({ messages: messages.map((m) => messageJSON(m, me)), hasMore });
  } catch (err) {
    return serverError(res, err);
  }
});

// POST /conversations/:id/messages { body } : send. 403 when either side has
// blocked the other; 429 over MESSAGE_MAX_PER_MINUTE.
router.post('/:id/messages', loadConversation, async (req, res) => {
  const me = req.user.id;
  const conv = req.conversation;
  const { text, error } = msg.validateBody((req.body || {}).body);
  if (error) return badRequest(res, 'Invalid message.', { body: error });
  if (req.user.messagingBanned) return sendError(res, 403, 'messaging_banned', BANNED_MSG);
  try {
    const blocks = await msg.blockState(me, conv.otherId(me));
    if (blocks.byMe) return sendError(res, 403, 'blocked', 'You blocked this person. Unblock them to send messages.');
    if (blocks.byThem) return sendError(res, 403, 'blocked', "You can't message this person.");
    const since = new Date(Date.now() - 60 * 1000);
    const recent = await models.Message.count({ where: { senderId: me, createdAt: { [Op.gte]: since } } });
    if (recent >= msg.messagesPerMinute()) {
      res.set('Retry-After', '60');
      return sendError(res, 429, 'rate_limited', "You're sending messages too quickly. Wait a minute and try again.");
    }
    const m = await models.Message.create({ conversationId: conv.id, senderId: me, body: text });
    // Sending implies you've read everything up to now.
    await conv.update({ lastMessageAt: m.createdAt, [conv.lastReadField(me)]: m.createdAt });
    return res.status(201).json(messageJSON(m, me));
  } catch (err) {
    return serverError(res, err);
  }
});

// POST /conversations/:id/report { reason, note?, block? } : either participant
// may report the conversation (one open report each; shares the hourly report
// limit with post reports). With block: true the other person is blocked too.
router.post('/:id/report', loadConversation, async (req, res) => {
  const me = req.user.id;
  const conv = req.conversation;
  const body = req.body || {};
  const errors = {};
  const REASONS = models.ConversationReport.REASONS;
  if (REASONS.indexOf(body.reason) === -1) errors.reason = 'Choose a reason: ' + REASONS.join(', ') + '.';
  let note = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') errors.note = 'Note must be text.';
    else if (body.note.trim().length > mod.NOTE_MAX) errors.note = 'Keep the note under ' + mod.NOTE_MAX + ' characters.';
    else note = body.note.trim() || null;
  }
  if (body.block !== undefined && typeof body.block !== 'boolean') errors.block = 'block must be true or false.';
  if (Object.keys(errors).length) return badRequest(res, 'Invalid report.', errors);
  const other = conv.otherId(me);
  try {
    const existing = await models.ConversationReport.findOne({ where: { conversationId: conv.id, reporterId: me, status: 'open' } });
    if (existing) return sendError(res, 409, 'conflict', 'You already reported this conversation. A moderator will review it.');
    const since = new Date(Date.now() - 3600 * 1000);
    const [p, c] = await Promise.all([
      models.Report.count({ where: { reporterId: me, createdAt: { [Op.gte]: since } } }),
      models.ConversationReport.count({ where: { reporterId: me, createdAt: { [Op.gte]: since } } }),
    ]);
    if (p + c >= mod.reportsPerHour()) {
      res.set('Retry-After', '3600');
      return sendError(res, 429, 'rate_limited', 'You have sent a lot of reports. Please try again later.');
    }
    const report = await models.ConversationReport.create({ conversationId: conv.id, reporterId: me, reportedUserId: other, reason: body.reason, note });
    if (body.block) await models.UserBlock.findOrCreate({ where: { blockerId: me, blockedId: other } });
    return res.status(201).json({
      id: report.id, conversationId: conv.id, reason: report.reason, status: report.status, createdAt: report.createdAt,
      blocked: await msg.blockState(me, other),
    });
  } catch (err) {
    if (err && err.name === 'SequelizeUniqueConstraintError') return sendError(res, 409, 'conflict', 'You already reported this conversation. A moderator will review it.');
    return serverError(res, err);
  }
});

// POST /conversations/:id/block and DELETE /conversations/:id/block:
// block or unblock the other participant (applies to all conversations with them).
router.post('/:id/block', loadConversation, async (req, res) => {
  const me = req.user.id;
  const other = req.conversation.otherId(me);
  try {
    await models.UserBlock.findOrCreate({ where: { blockerId: me, blockedId: other } });
    return res.json({ blocked: await msg.blockState(me, other) });
  } catch (err) {
    if (err && err.name === 'SequelizeUniqueConstraintError') return res.json({ blocked: await msg.blockState(me, other) });
    return serverError(res, err);
  }
});

router.delete('/:id/block', loadConversation, async (req, res) => {
  const me = req.user.id;
  const other = req.conversation.otherId(me);
  try {
    await models.UserBlock.destroy({ where: { blockerId: me, blockedId: other } });
    return res.json({ blocked: await msg.blockState(me, other) });
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
