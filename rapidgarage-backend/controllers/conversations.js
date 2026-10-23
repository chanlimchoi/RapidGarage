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
const holds = require('../lib/holds');
const bundles = require('../lib/bundles');
const meetups = require('../lib/meetups');
const follows = require('../lib/follows');
const schedule = require('../lib/schedule');
const wanted = require('../lib/wanted');
const { wantedEnabled } = require('../lib/features');

const PERSON = ['id', 'firstName', 'lastName'];

router.use(requireLogin);

// How the post looks from inside a conversation. Conversations about a
// wanted post (conv.wantedId) describe it the same way, with wanted: true.
function wantedSummary(conv, w, me) {
  if (!w) return { id: conv.wantedId, wanted: true, title: conv.postTitle, status: 'deleted', canView: false, thumbUrl: null };
  const st = wanted.statusOf(w);
  return { id: w.id, wanted: true, title: w.title, status: w.hidden ? 'hidden' : st === 'active' ? 'available' : 'closed', canView: wanted.canSee(me, w), thumbUrl: null };
}

function postSummary(conv, post, me) {
  if (conv.wantedId) return wantedSummary(conv, post, me);
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

// holdMap: Map(holdId -> ItemHold with item) for hold events (see withHolds);
// holdMap.meetups: Map(meetupId -> MeetupProposal) for meetup events.
function messageJSON(m, me, holdMap) {
  // Removed by a moderator: participants get a placeholder, never the text.
  if (m.removedAt) return { id: m.id, body: null, removed: true, senderId: m.senderId, mine: m.senderId === me, createdAt: m.createdAt };
  const out = { id: m.id, body: m.body, senderId: m.senderId, mine: m.senderId === me, createdAt: m.createdAt };
  if (m.kind === 'hold') {
    const h = holdMap && m.holdId ? holdMap.get(m.holdId) : null;
    out.kind = 'hold';
    out.hold = { id: m.holdId, event: m.holdEvent, itemName: h && h.item ? h.item.name : null, pickupAt: h ? h.pickupAt : null, expiresAt: h ? h.expiresAt : null, status: h ? h.status : null, endedReason: h ? h.endedReason : null, cents: m.holdCents || null };
    // A bundle event names every item in the bundle.
    if (h && h.bundleKey && holdMap.bundles && String(m.holdEvent || '').indexOf('bundle_') === 0) {
      const names = holdMap.bundles.get(h.bundleKey) || [];
      out.hold.bundle = { count: names.length, items: names };
    }
  }
  if (m.kind === 'meetup') {
    const p = holdMap && holdMap.meetups && m.meetupId ? holdMap.meetups.get(m.meetupId) : null;
    out.kind = 'meetup';
    out.meetup = Object.assign({ event: m.meetupEvent }, p ? meetups.proposalJSON(p, me) : { id: m.meetupId, status: null });
  }
  return out;
}

// Holds referenced by hold-event messages, with their items.
async function withHolds(messages) {
  const ids = Array.from(new Set(messages.filter((m) => m && m.kind === 'hold' && m.holdId).map((m) => m.holdId)));
  const mids = Array.from(new Set(messages.filter((m) => m && m.kind === 'meetup' && m.meetupId).map((m) => m.meetupId)));
  const rows = ids.length ? await models.ItemHold.findAll({ where: { id: ids }, include: [{ model: models.SaleItem, as: 'item', attributes: ['id', 'name'] }] }) : [];
  const map = new Map(rows.map((h) => [h.id, h]));
  const keys = Array.from(new Set(rows.map((h) => h.bundleKey).filter(Boolean)));
  map.bundles = new Map();
  if (keys.length) {
    const sib = await models.ItemHold.findAll({ where: { bundleKey: keys }, include: [{ model: models.SaleItem, as: 'item', attributes: ['id', 'name'] }], order: [['id', 'ASC']] });
    sib.forEach((x) => { if (!map.bundles.has(x.bundleKey)) map.bundles.set(x.bundleKey, []); map.bundles.get(x.bundleKey).push(x.item ? x.item.name : null); });
  }
  map.meetups = new Map(mids.length ? (await models.MeetupProposal.findAll({ where: { id: mids } })).map((p) => [p.id, p]) : []);
  return map;
}

const BANNED_MSG = 'A moderator has turned off messaging for your account. You can still read your conversations.';

async function loadPosts(ids) {
  ids = ids.filter(Boolean);
  if (!ids.length) return new Map();
  const posts = await models.Post.findAll({ where: { id: ids }, include: [{ model: models.PostPhoto, as: 'photos' }] });
  posts.forEach((p) => (p.photos || []).sort((a, b) => a.position - b.position));
  return new Map(posts.map((p) => [p.id, p]));
}

async function loadWanteds(ids) {
  ids = ids.filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await models.WantedPost.findAll({ where: { id: ids } });
  return new Map(rows.map((w) => [w.id, w]));
}

// The sale or wanted post a conversation is about.
const subjectOf = (conv, posts, wanteds) => (conv.wantedId ? wanteds.get(conv.wantedId) : posts.get(conv.postId));

async function summarize(conv, user, post, unread, blocks, last) {
  const me = user.id;
  const other = me === conv.buyerId ? conv.seller : conv.buyer;
  return {
    id: conv.id,
    role: me === conv.buyerId ? 'buyer' : 'seller',
    post: postSummary(conv, post, user),
    other: publicUser(other),
    otherRating: other ? (await ratings.summaries([other.id])).get(other.id) : null,
    lastMessage: last ? messageJSON(last, me, await withHolds([last])) : null,
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
// The person who didn't start it only sees it once something was sent: the
// seller for sale conversations, the buyer (the wanted post's author) for
// conversations about a wanted post.
router.get('/', async (req, res) => {
  const me = req.user.id;
  try {
    const sent = { lastMessageAt: { [Op.ne]: null } };
    const convs = await models.Conversation.findAll({
      where: { [Op.or]: [
        { wantedId: null, buyerId: me }, Object.assign({ wantedId: null, sellerId: me }, sent),
        { wantedId: { [Op.ne]: null }, sellerId: me }, Object.assign({ wantedId: { [Op.ne]: null }, buyerId: me }, sent),
      ] },
      include: [{ model: models.User, as: 'buyer', attributes: PERSON }, { model: models.User, as: 'seller', attributes: PERSON }],
      order: [['lastMessageAt', 'DESC'], ['createdAt', 'DESC']],
      limit: 200,
    });
    const ids = convs.map((c) => c.id);
    const [posts, wanteds, unread, blocks, lasts] = await Promise.all([
      loadPosts(Array.from(new Set(convs.map((c) => c.postId)))),
      loadWanteds(Array.from(new Set(convs.map((c) => c.wantedId)))),
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
      return summarize(c, req.user, subjectOf(c, posts, wanteds), unread.get(c.id), b, lastBy.get(c.id));
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
    // The badge is polled, so overdue holds and meetup suggestions end (and notify) here too.
    await holds.sweep();
    await meetups.sweep();
    const counts = await msg.unreadCounts(req.user.id, null);
    let count = 0;
    counts.forEach((n) => { count += n; });
    // New wanted-post matches ride along for the "Wanted" nav badge.
    // Today's morning-of reminders ride along too (the in-app notice).
    const reminders = (await require('../lib/reminders').notices(req.user)).length;
    // Unseen in-app notifications (saved-search matches) feed the bell.
    const notifications = await require('../lib/notifications').unreadCount(req.user);
    return res.json({ count, conversations: counts.size, wantedMatches: await wanted.newMatchCount(req.user.id), reminders, notifications });
  } catch (err) {
    return serverError(res, err);
  }
});

// Conversations started in the last hour by `me` (as the buyer of a sale or
// the seller answering a wanted post): one budget for both.
const startedSince = (me, since) => models.Conversation.count({ where: { createdAt: { [Op.gte]: since }, [Op.or]: [{ wantedId: null, buyerId: me }, { wantedId: { [Op.ne]: null }, sellerId: me }] } });

async function rateLimited(res, me) {
  if ((await startedSince(me, new Date(Date.now() - 3600 * 1000))) < msg.conversationsPerHour()) return false;
  res.set('Retry-After', '3600');
  sendError(res, 429, 'rate_limited', 'You have started a lot of conversations. Please try again later.');
  return true;
}

// POST /conversations { wantedId } : a seller answers a wanted post; the
// wanted post's author is the buyer. Only open (active, unexpired, visible)
// wanted posts take new conversations; an existing one stays reachable.
async function startAboutWanted(req, res, wantedId) {
  const me = req.user.id;
  try {
    const w = await models.WantedPost.findByPk(wantedId);
    if (!w || !wanted.canSee(req.user, w)) return notFound(res, 'Wanted post not found.');
    if (w.userId === me) return forbidden(res, "You can't message yourself.");
    if (req.user.messagingBanned) return sendError(res, 403, 'messaging_banned', BANNED_MSG);
    const where = { wantedId, buyerId: w.userId, sellerId: me };
    const existing = await models.Conversation.findOne({ where });
    if (existing) return res.status(200).json({ id: existing.id, created: false });
    if (!(await wantedEnabled())) return sendError(res, 403, 'feature_disabled', 'Wanted posts are turned off on this site right now.');
    if (w.hidden) return sendError(res, 403, 'wanted_unavailable', "This wanted post is unavailable, so you can't start a new conversation about it.");
    if (wanted.statusOf(w) !== 'active') return sendError(res, 409, 'wanted_closed', "This wanted post has expired or was marked found, so you can't start a new conversation about it.");
    const blocks = await msg.blockState(me, w.userId);
    if (blocks.byMe || blocks.byThem) return sendError(res, 403, 'blocked', "You can't message this person.");
    if (await rateLimited(res, me)) return undefined;
    const [conv, created] = await models.Conversation.findOrCreate({ where, defaults: { postId: null, postTitle: w.title } });
    return res.status(created ? 201 : 200).json({ id: conv.id, created });
  } catch (err) {
    if (err && err.name === 'SequelizeUniqueConstraintError') {
      const conv = await models.Conversation.findOne({ where: { wantedId, sellerId: me } });
      if (conv) return res.status(200).json({ id: conv.id, created: false });
    }
    return serverError(res, err);
  }
}

// POST /conversations { postId } : start (201) or reuse (200) my conversation
// with the seller of postId. { wantedId } instead: see startAboutWanted.
router.post('/', require('../lib/emailVerify').requireVerified, async (req, res) => {
  const me = req.user.id;
  const body = req.body || {};
  if (body.wantedId !== undefined && body.postId === undefined) {
    const wantedId = parseId(body.wantedId);
    if (!wantedId) return badRequest(res, 'wantedId must be a positive integer.', { wantedId: 'Choose a wanted post.' });
    return startAboutWanted(req, res, wantedId);
  }
  const postId = parseId(body.postId);
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
    if (await rateLimited(res, me)) return undefined;
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
    await holds.sweep();
    await meetups.sweep();
    const rows = await models.Message.findAll({ where: { conversationId: conv.id }, order: [['id', 'DESC']], limit: msg.PAGE_SIZE + 1 });
    const hasMore = rows.length > msg.PAGE_SIZE;
    const messages = rows.slice(0, msg.PAGE_SIZE).reverse();
    await markRead(conv, me, messages);
    const [posts, wanteds] = await Promise.all([loadPosts([conv.postId]), loadWanteds([conv.wantedId])]);
    const blocks = await msg.blockState(me, conv.otherId(me));
    const summary = await summarize(conv, req.user, subjectOf(conv, posts, wanteds), 0, blocks, messages[messages.length - 1]);
    summary.messagingBanned = !!req.user.messagingBanned;
    summary.canSend = !blocks.byMe && !blocks.byThem && !summary.messagingBanned;
    // Only *your own* open report is ever mentioned to a participant.
    summary.reportedByMe = !!(await models.ConversationReport.count({ where: { conversationId: conv.id, reporterId: me, status: 'open' } }));
    const hm = await withHolds(messages);
    return res.json({ conversation: summary, messages: messages.map((m) => messageJSON(m, me, hm)), hasMore });
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
    const hm = await withHolds(messages);
    return res.json({ messages: messages.map((m) => messageJSON(m, me, hm)), hasMore });
  } catch (err) {
    return serverError(res, err);
  }
});

// POST /conversations/:id/messages { body } : send. 403 when either side has
// blocked the other; 429 over MESSAGE_MAX_PER_MINUTE.
router.post('/:id/messages', require('../lib/emailVerify').requireVerified, loadConversation, async (req, res) => {
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
    if ((await mod.recentReportCount(me)) >= mod.reportsPerHour()) {
      res.set('Retry-After', '3600');
      return sendError(res, 429, 'rate_limited', 'You have sent a lot of reports. Please try again later.');
    }
    const report = await models.ConversationReport.create({ conversationId: conv.id, reporterId: me, reportedUserId: other, reason: body.reason, note });
    if (body.block) { await models.UserBlock.findOrCreate({ where: { blockerId: me, blockedId: other } }); await holds.endBetween(me, other); await meetups.endBetween(me, other); await follows.endBetween(me, other); }
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
    await holds.endBetween(me, other);
    await meetups.endBetween(me, other);
    await follows.endBetween(me, other);
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

// ---- item holds ----------------------------------------------------------
// GET /conversations/:id/holds : holds in this conversation (newest first) and
// the items the buyer could ask to hold.
router.get('/:id/holds', loadConversation, async (req, res) => {
  const me = req.user.id;
  const conv = req.conversation;
  try {
    await holds.sweep();
    const rows = await models.ItemHold.findAll({ where: { conversationId: conv.id }, include: [{ model: models.SaleItem, as: 'item' }], order: [['id', 'DESC']], limit: 50 });
    const post = await models.Post.findByPk(conv.postId, { include: [{ model: models.SaleDay, as: 'saleDays' }] });
    let holdable = [];
    let canRequest = false;
    if (me === conv.buyerId && post && mod.canSee(req.user, post) && !post.hidden && !schedule.isEnded(post)) {
      const t = holds.now();
      const mineOpen = new Set(rows.filter((h) => models.ItemHold.ACTIVE.includes(h.status)).map((h) => h.itemId));
      const items = await models.SaleItem.findAll({ where: { postId: post.id, sold: false }, order: [['position', 'ASC'], ['id', 'ASC']] });
      holdable = items.filter((i) => !(i.reservedUntil && new Date(i.reservedUntil) > t) && !mineOpen.has(i.id))
        .map((i) => Object.assign(i.toJSON(), { nowCents: bundles.currentCents(post, i, t) }));
      // The sale still has unsold items; holdable may be empty when they are all
      // reserved or already requested (the UI says so).
      canRequest = items.length > 0;
    }
    const end = post ? holds.saleEnd(post) : null;
    return res.json({
      results: rows.map((h) => holds.holdJSON(h, me)),
      holdable, canRequest,
      bundle: post && bundles.state(post) ? Object.assign({ maxItems: bundles.MAX_ITEMS }, bundles.state(post)) : null,
      saleEndsAt: end === null ? null : new Date(end),
      limits: { requestHours: holds.requestHours(), holdHours: holds.holdHours(), maxHours: holds.ACCEPT_HOURS_MAX, pickupMaxDays: holds.PICKUP_MAX_DAYS },
    });
  } catch (err) { return serverError(res, err); }
});

// POST /conversations/:id/holds { itemId, pickupAt?, offerCents? } : the buyer asks to hold
// (optionally offering a price below the asking price; the seller can accept or counter)
// one unsold, unreserved item of this sale. See lib/holds.js for the limits.
router.post('/:id/holds', loadConversation, async (req, res) => {
  const me = req.user.id;
  const conv = req.conversation;
  const body = req.body || {};
  if (me !== conv.buyerId) return sendError(res, 403, 'forbidden', 'Only the buyer can ask to hold an item.');
  if (req.user.messagingBanned) return sendError(res, 403, 'messaging_banned', BANNED_MSG);
  const itemId = parseId(body.itemId);
  if (!itemId) return badRequest(res, 'Invalid hold.', { itemId: 'Choose an item.' });
  try {
    await holds.sweep();
    const blocks = await msg.blockState(me, conv.sellerId);
    if (blocks.byMe || blocks.byThem) return sendError(res, 403, 'blocked', "You can't message this person.");
    const post = await models.Post.findByPk(conv.postId, { include: [{ model: models.SaleDay, as: 'saleDays' }] });
    if (!post || !mod.canSee(req.user, post)) return notFound(res, 'Post not found.');
    if (post.hidden) return sendError(res, 403, 'post_unavailable', "This sale is unavailable, so you can't hold items from it.");
    if (schedule.isEnded(post)) return sendError(res, 409, 'sale_ended', 'This sale has ended.');
    const t = holds.now();
    const pickup = holds.parsePickup(body.pickupAt, post, t);
    if (pickup.error) return badRequest(res, 'Invalid hold.', { pickupAt: pickup.error });
    const item = await models.SaleItem.findOne({ where: { id: itemId, postId: post.id } });
    if (!item) return notFound(res, 'Item not found.');
    if (item.sold) return sendError(res, 409, 'item_unavailable', 'This item is no longer available.');
    if (item.reservedUntil && new Date(item.reservedUntil) > t) return sendError(res, 409, 'item_reserved', 'This item is already reserved.');
    const offer = holds.parseOffer(body.offerCents, item);
    if (offer.error) return badRequest(res, 'Invalid hold.', { offerCents: offer.error });
    const H = models.ItemHold;
    if (await H.count({ where: { itemId, buyerId: me, status: H.ACTIVE } })) return sendError(res, 409, 'already_requested', 'You already asked to hold this item.');
    const declined = await H.findOne({ where: { itemId, buyerId: me, status: 'declined', endedReason: null, decidedAt: { [Op.gt]: new Date(t - holds.DECLINE_COOLDOWN_MS) } } });
    if (declined) return sendError(res, 429, 'declined_recently', 'The seller declined this hold. You can ask again tomorrow.');
    if (await H.count({ where: { buyerId: me, postId: post.id, status: H.ACTIVE } }) >= holds.MAX_PER_SALE) {
      return sendError(res, 429, 'too_many', 'You can hold up to ' + holds.MAX_PER_SALE + ' items per sale.');
    }
    if (await H.count({ where: { buyerId: me, status: H.ACTIVE } }) >= holds.maxActive()) {
      return sendError(res, 429, 'too_many', 'You can have up to ' + holds.maxActive() + ' open holds. Cancel one first.');
    }
    if (await H.count({ where: { buyerId: me, createdAt: { [Op.gt]: new Date(t - 24 * 3600000) } } }) >= holds.maxPerDay()) {
      res.set('Retry-After', '3600');
      return sendError(res, 429, 'rate_limited', 'You have asked for a lot of holds today. Please try again tomorrow.');
    }
    if (await H.count({ where: { itemId, status: 'pending' } }) >= holds.MAX_PENDING_PER_ITEM) {
      return sendError(res, 409, 'too_many_requests', 'Several people have already asked to hold this item. Message the seller instead.');
    }
    const hold = await H.create({ itemId, postId: post.id, conversationId: conv.id, buyerId: me, sellerId: conv.sellerId, status: 'pending', pickupAt: pickup.value, offerCents: offer.value, expiresAt: holds.requestExpiry(post, t) });
    hold.item = item;
    await holds.postEvent(hold, 'requested', me, item.name, offer.value);
    return res.status(201).json(holds.holdJSON(hold, me));
  } catch (err) { return serverError(res, err); }
});

// POST /conversations/:id/bundles { itemIds, pickupAt? } : the buyer asks for a
// bundle deal (lib/bundles.js): at least the seller's minimum number of unsold,
// unreserved, priced items, each held at its bundle price. One hold per item,
// sharing a bundleKey; one event message in the conversation. The seller
// accepts or declines the whole bundle.
router.post('/:id/bundles', loadConversation, async (req, res) => {
  const me = req.user.id;
  const conv = req.conversation;
  const body = req.body || {};
  if (me !== conv.buyerId) return sendError(res, 403, 'forbidden', 'Only the buyer can ask for a bundle.');
  if (req.user.messagingBanned) return sendError(res, 403, 'messaging_banned', BANNED_MSG);
  const raw = Array.isArray(body.itemIds) ? body.itemIds : null;
  const ids = raw ? Array.from(new Set(raw.map(parseId))) : [];
  if (!raw || !ids.length || ids.some((x) => !x)) return badRequest(res, 'Invalid bundle.', { itemIds: 'Choose the items for your bundle.' });
  if (ids.length > bundles.MAX_ITEMS) return badRequest(res, 'Invalid bundle.', { itemIds: 'A bundle can have up to ' + bundles.MAX_ITEMS + ' items.' });
  try {
    await holds.sweep();
    const blocks = await msg.blockState(me, conv.sellerId);
    if (blocks.byMe || blocks.byThem) return sendError(res, 403, 'blocked', "You can't message this person.");
    const post = await models.Post.findByPk(conv.postId, { include: [{ model: models.SaleDay, as: 'saleDays' }] });
    if (!post || !mod.canSee(req.user, post)) return notFound(res, 'Post not found.');
    if (post.hidden) return sendError(res, 403, 'post_unavailable', "This sale is unavailable, so you can't hold items from it.");
    if (schedule.isEnded(post)) return sendError(res, 409, 'sale_ended', 'This sale has ended.');
    const deal = bundles.state(post);
    if (!deal) return sendError(res, 409, 'no_bundle', "This sale doesn't offer a bundle deal.");
    if (ids.length < deal.minItems) return badRequest(res, 'Invalid bundle.', { itemIds: 'Choose at least ' + deal.minItems + ' items for the bundle.' });
    const t = holds.now();
    const pickup = holds.parsePickup(body.pickupAt, post, t);
    if (pickup.error) return badRequest(res, 'Invalid bundle.', { pickupAt: pickup.error });
    const found = await models.SaleItem.findAll({ where: { id: ids, postId: post.id } });
    if (found.length !== ids.length) return notFound(res, 'Item not found.');
    const items = ids.map((id) => found.find((i) => i.id === id));
    if (items.some((i) => i.sold)) return sendError(res, 409, 'item_unavailable', 'This item is no longer available.');
    if (items.some((i) => i.reservedUntil && new Date(i.reservedUntil) > t)) return sendError(res, 409, 'item_reserved', 'This item is already reserved.');
    if (items.some((i) => i.priceCents === null || i.priceCents === undefined)) return badRequest(res, 'Invalid bundle.', { itemIds: 'Every item in a bundle needs a price.' });
    const H = models.ItemHold;
    if (await H.count({ where: { itemId: ids, buyerId: me, status: H.ACTIVE } })) return sendError(res, 409, 'already_requested', 'You already asked to hold this item.');
    if (await H.count({ where: { buyerId: me, status: H.ACTIVE } }) + ids.length > holds.maxActive()) {
      return sendError(res, 429, 'too_many', 'You can have up to ' + holds.maxActive() + ' open holds. Cancel one first.');
    }
    if (await H.count({ where: { buyerId: me, createdAt: { [Op.gt]: new Date(t - 24 * 3600000) } } }) + ids.length > holds.maxPerDay()) {
      res.set('Retry-After', '3600');
      return sendError(res, 429, 'rate_limited', 'You have asked for a lot of holds today. Please try again tomorrow.');
    }
    const q = bundles.quote(post, items, t);
    const key = bundles.newKey();
    const expiresAt = holds.requestExpiry(post, t);
    const created = [];
    for (const l of q.lines) {
      // A free item rides along at no cost (no offer); priced items offer their bundle price.
      const h = await H.create({ itemId: l.item.id, postId: post.id, conversationId: conv.id, buyerId: me, sellerId: conv.sellerId, status: 'pending', pickupAt: pickup.value, offerCents: l.bundleCents > 0 ? l.bundleCents : null, expiresAt, bundleKey: key });
      h.item = l.item;
      created.push(h);
    }
    await holds.postEvent(created[0], 'bundle_requested', me, items.map((i) => i.name).join(', '), q.bundleTotalCents);
    return res.status(201).json({
      bundleKey: key, percent: deal.percent, totalCents: q.totalCents, bundleTotalCents: q.bundleTotalCents,
      results: created.map((h) => holds.holdJSON(h, me)),
    });
  } catch (err) { return serverError(res, err); }
});

// ---- meetup suggestions (see lib/meetups.js) ---------------------------------
// Can `req.user` act in this conversation? Sends the error and returns false otherwise.
async function canAct(req, res, conv) {
  if (req.user.messagingBanned) { sendError(res, 403, 'messaging_banned', BANNED_MSG); return false; }
  const b = await msg.blockState(req.user.id, conv.otherId(req.user.id));
  if (b.byMe || b.byThem) { sendError(res, 403, 'blocked', "You can't message this person."); return false; }
  return true;
}

// GET /conversations/:id/meetups : suggestions in this conversation, newest first.
router.get('/:id/meetups', loadConversation, async (req, res) => {
  const me = req.user.id;
  const conv = req.conversation;
  try {
    await meetups.sweep();
    const rows = await models.MeetupProposal.findAll({ where: { conversationId: conv.id }, order: [['id', 'DESC']], limit: 30 });
    const b = await msg.blockState(me, conv.otherId(me));
    const canSend = !b.byMe && !b.byThem && !req.user.messagingBanned;
    const pending = rows.filter((p) => p.status === 'pending')[0];
    return res.json({
      results: rows.map((p) => meetups.proposalJSON(p, me)),
      canPropose: canSend && !pending,
      pendingId: pending ? pending.id : null,
      limits: { maxDays: meetups.MAX_DAYS, noteMax: meetups.NOTE_MAX, nameMax: meetups.NAME_MAX },
    });
  } catch (err) { return serverError(res, err); }
});

// GET /conversations/:id/meetup-spots : curated public spots nearest the sale's
// area (never the viewer's location), plus whether nearby search is available.
router.get('/:id/meetup-spots', loadConversation, async (req, res) => {
  try {
    const origin = await meetups.originFor(req.conversation, req.user);
    const results = await meetups.nearestSpots(origin);
    return res.json({
      origin: origin ? { label: origin.label, located: origin.lat !== undefined && origin.lat !== null } : null,
      results,
      placesSearch: !!meetups.placesKey() && !!origin && origin.lat !== undefined && origin.lat !== null,
      maxMiles: meetups.NEAR_MILES,
    });
  } catch (err) { return serverError(res, err); }
});

// GET /conversations/:id/meetup-places?q= : public places near the sale's area
// via Google Places (only with a server GOOGLE_PLACES_API_KEY).
router.get('/:id/meetup-places', loadConversation, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.replace(/\s+/g, ' ').trim() : '';
  if (q.length < 2 || q.length > 80) return badRequest(res, 'Search for 2 to 80 characters.', { q: 'Type what kind of place to look for.' });
  try {
    if (!meetups.placesKey()) return sendError(res, 404, 'places_unavailable', 'Nearby place search is not set up on this site. Pick a listed spot or type a place.');
    const origin = await meetups.originFor(req.conversation, req.user);
    if (!origin || origin.lat === undefined || origin.lat === null) return sendError(res, 409, 'no_area', "This conversation has no sale area to search near. Type a place instead.");
    if (!meetups.allowPlacesSearch(req.user.id)) { res.set('Retry-After', '3600'); return sendError(res, 429, 'rate_limited', 'Too many searches. Please try again later.'); }
    const r = await meetups.searchPlaces(q, origin);
    if (r.status !== 'ok') return sendError(res, 502, 'places_failed', "Couldn't search nearby places right now. Pick a listed spot or type a place.");
    return res.json({ results: r.results });
  } catch (err) { return serverError(res, err); }
});

// POST /conversations/:id/meetups { spotId | place: { name, address? }, meetAt, note? }
router.post('/:id/meetups', loadConversation, async (req, res) => {
  const me = req.user.id;
  const conv = req.conversation;
  try {
    await meetups.sweep();
    const t = meetups.now();
    const { errors, values } = await meetups.parseProposal(req.body, t);
    if (Object.keys(errors).length) return badRequest(res, 'Invalid meetup suggestion.', errors);
    if (!(await canAct(req, res, conv))) return undefined;
    const blocker = await meetups.proposalBlocker(conv, me, t);
    if (blocker === 'pending') return sendError(res, 409, 'meetup_pending', 'There is already a meetup suggestion waiting for an answer. Answer or withdraw it first.');
    if (blocker === 'too_many') { res.set('Retry-After', '3600'); return sendError(res, 429, 'rate_limited', 'You have made a lot of meetup suggestions today. Please try again tomorrow.'); }
    const origin = await meetups.originFor(conv, req.user);
    const p = await models.MeetupProposal.create(Object.assign(values, {
      conversationId: conv.id, proposerId: me, recipientId: conv.otherId(me), status: 'pending',
      timeZone: (origin && origin.timeZone) || require('../lib/schedule').defaultTimeZone(),
    }));
    await meetups.postEvent(p, 'proposed', me);
    return res.status(201).json(meetups.proposalJSON(p, me));
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
module.exports.canAct = canAct;
