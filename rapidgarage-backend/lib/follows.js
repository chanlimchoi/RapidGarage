// Following sellers: follow someone and hear about their new sales.
//
//  * In the app: GET /allPosts?following=1 lists current sales by the people
//    you follow (controllers/home.js); /follows lists the people.
//  * By email: when a followed seller publishes a sale, each follower with
//    notify on gets a row in FollowNotifications. The alert worker sends them
//    in the same digest budget as sale alerts and wanted matches (one email
//    per ALERT_DIGEST_MINUTES, at most ALERT_DAILY_MAX_EMAILS a day).
//  * Blocking either way stops both following and the emails.
const crypto = require('crypto');
const { Op } = require('sequelize');
const i18n = require('./i18n');
const mailer = require('./mailer');
const schedule = require('./schedule');
const { publicName, publicUser } = require('./people');
const { priceIn } = require('./flyerText');

function models() { return require('../models'); }
function alerts() { return require('./alerts'); }

const MAX_FOLLOWS = () => { const n = Number(process.env.FOLLOWS_MAX_PER_USER); return Number.isInteger(n) && n > 0 ? n : 500; };
const PURPOSE = 'follow.unsub.v1.';

async function blockedBetween(a, b) {
  const n = await models().UserBlock.count({ where: { [Op.or]: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } });
  return n > 0;
}

// ---- following -----------------------------------------------------------
// Resolves to { follow } or { reason } (self | not_found | blocked | limit).
async function follow(followerId, sellerId, notify) {
  const m = models();
  if (followerId === sellerId) return { reason: 'self' };
  const seller = await m.User.findByPk(sellerId, { attributes: ['id'] });
  if (!seller) return { reason: 'not_found' };
  if (await blockedBetween(followerId, sellerId)) return { reason: 'blocked' };
  const existing = await m.Follow.findOne({ where: { followerId, sellerId } });
  if (existing) {
    if (typeof notify === 'boolean' && existing.notify !== notify) await existing.update({ notify });
    return { follow: existing };
  }
  if ((await m.Follow.count({ where: { followerId } })) >= MAX_FOLLOWS()) return { reason: 'limit' };
  try {
    return { follow: await m.Follow.create({ followerId, sellerId, notify: typeof notify === 'boolean' ? notify : true }) };
  } catch (err) {
    // Two clicks at once: the unique index keeps one row.
    if (err && err.name === 'SequelizeUniqueConstraintError') return { follow: await m.Follow.findOne({ where: { followerId, sellerId } }) };
    throw err;
  }
}

async function unfollow(followerId, sellerId) {
  return models().Follow.destroy({ where: { followerId, sellerId } });
}

// What a profile or sale page shows: { following, notify, followers }.
async function status(viewerId, sellerId) {
  const m = models();
  const [mine, followers] = await Promise.all([
    viewerId ? m.Follow.findOne({ where: { followerId: viewerId, sellerId } }) : null,
    m.Follow.count({ where: { sellerId } }),
  ]);
  return { following: !!mine, notify: mine ? mine.notify : false, followers };
}

// The people I follow, newest first, each with how many current sales they have.
async function list(followerId) {
  const m = models();
  const rows = await m.Follow.findAll({
    where: { followerId },
    include: [{ model: m.User, as: 'seller', attributes: ['id', 'firstName', 'lastName'] }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
  });
  const sellerIds = rows.map((r) => r.sellerId);
  const posts = sellerIds.length ? await m.Post.findAll({
    where: { userId: sellerIds, hidden: false },
    include: [{ model: m.SaleDay, as: 'saleDays' }],
  }) : [];
  const live = new Map();
  posts.forEach((p) => { if (!schedule.isEnded(p)) live.set(p.userId, (live.get(p.userId) || 0) + 1); });
  return rows.map((r) => ({
    seller: publicUser(r.seller),
    notify: r.notify,
    currentSales: live.get(r.sellerId) || 0,
    since: r.createdAt,
  }));
}

// Blocking someone ends following in both directions.
async function endBetween(a, b) {
  return models().Follow.destroy({ where: { [Op.or]: [{ followerId: a, sellerId: b }, { followerId: b, sellerId: a }] } });
}

const followedSellerIds = async (followerId) => (await models().Follow.findAll({ where: { followerId }, attributes: ['sellerId'], raw: true })).map((r) => r.sellerId);

// ---- new sale -> outbox ------------------------------------------------------
async function enqueueForPost(post) {
  const m = models();
  if (!post || post.hidden || schedule.isEnded(post)) return 0;
  const follows = await m.Follow.findAll({ where: { sellerId: post.userId, notify: true }, raw: true });
  if (!follows.length) return 0;
  const blocks = await m.UserBlock.findAll({ where: { [Op.or]: [{ blockerId: post.userId }, { blockedId: post.userId }] }, raw: true });
  const blocked = new Set(blocks.map((b) => (b.blockerId === post.userId ? b.blockedId : b.blockerId)));
  const rows = follows.filter((f) => !blocked.has(f.followerId))
    .map((f) => ({ userId: f.followerId, postId: post.id, followId: f.id, status: 'pending' }));
  if (!rows.length) return 0;
  await m.FollowNotification.bulkCreate(rows, { ignoreDuplicates: true });
  // Push right away to followers who allow it (the email follows in the digest).
  const seller = await m.User.findByPk(post.userId, { attributes: ['id', 'firstName', 'lastName'] });
  rows.forEach((r) => require('./push').newSale(r.userId, { sellerName: publicName(seller), title: post.title, postId: post.id }));
  return rows.length;
}

// Fire-and-forget from the create handler (alerts.idle() waits in tests).
function schedulePost(post) {
  return alerts().track(() => enqueueForPost(post), 'Follower notifications failed for post ' + (post && post.id));
}

// ---- unsubscribe links (one follow's emails) ---------------------------------
const unsubscribeToken = (followId) => alerts().unsubscribeToken(followId, PURPOSE);
const verifyToken = (followId, token) => alerts().verifyToken(followId, token, PURPOSE);
const unsubscribeUrl = (followId) => alerts().baseUrl() + '/alerts/unsubscribe?f=' + followId + '&t=' + encodeURIComponent(unsubscribeToken(followId));

// Resolves to the follow (now notify=false), or null when it no longer exists.
async function turnOff(followId) {
  const m = models();
  const row = await m.Follow.findByPk(followId, { include: [{ model: m.User, as: 'seller', attributes: ['id', 'firstName', 'lastName'] }] });
  if (!row) return null;
  if (row.notify) await row.update({ notify: false });
  await m.FollowNotification.update({ status: 'skipped', lastError: 'unsubscribed', claimToken: null }, { where: { followId, status: 'pending' } });
  return row;
}

// ---- email -------------------------------------------------------------------
const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// items: [{ post, follow, seller }]. In the recipient's language.
function renderEmail(user, items) {
  const lang = i18n.normalize(user.locale) || 'en';
  const L = (key, vars) => i18n.t(lang, key, vars);
  const base = alerts().baseUrl();
  const sellers = Array.from(new Map(items.map((i) => [i.seller.id, i])).values());
  const subject = items.length === 1
    ? L('follow.subjectOne', { name: publicName(items[0].seller), title: items[0].post.title })
    : L('follow.subjectMany', { count: items.length });
  const hello = user.firstName ? L('mail.hi', { name: user.firstName }) : L('mail.hiAnon');
  const lines = items.map((i) => ({
    title: i.post.title,
    url: base + '/post/' + i.post.id,
    meta: [priceIn(lang, i.post), [i.post.city, i.post.state].filter(Boolean).join(', '), L('mail.by', { name: publicName(i.seller) })].filter(Boolean).join(' · '),
  }));
  const manage = base + '/following';
  const text = [
    hello, '',
    items.length === 1 ? L('follow.introOne') : L('follow.introMany', { count: items.length }), '',
    ...lines.map((l) => '* ' + l.title + '\n  ' + l.meta + '\n  ' + l.url + '\n'),
    L('follow.manageText', { url: manage }),
    ...sellers.map((s) => L('follow.turnOffText', { name: publicName(s.seller), url: unsubscribeUrl(s.follow.id) })),
  ].join('\n');
  const html = `<!doctype html><html lang="${esc(lang)}"><body style="margin:0;padding:24px;background:#f6f5f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Apple SD Gothic Neo','Malgun Gothic','PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif;color:#1c1b19">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dd;border-radius:16px;padding:24px">
<p style="margin:0 0 4px;font-weight:700;color:#c2410c;font-size:14px">RapidGarage</p>
<h1 style="margin:0 0 16px;font-size:20px">${esc(items.length === 1 ? L('follow.headOne') : L('follow.headMany', { count: items.length }))}</h1>
<p style="margin:0 0 16px">${esc(hello)}</p>
${lines.map((l) => `<div style="border:1px solid #e7e4dd;border-radius:12px;padding:12px 14px;margin:0 0 10px">
<a href="${esc(l.url)}" style="color:#c2410c;font-weight:600;font-size:16px;text-decoration:none">${esc(l.title)}</a>
<div style="color:#5f5b53;font-size:13px;margin-top:4px">${esc(l.meta)}</div></div>`).join('\n')}
<p style="margin:16px 0 0;font-size:13px"><a href="${esc(manage)}" style="color:#c2410c">${esc(L('follow.manage'))}</a></p>
<p style="margin:8px 0 0;font-size:12px;color:#8a857b">${sellers.map((s) => `<a href="${esc(unsubscribeUrl(s.follow.id))}" style="color:#8a857b">${esc(L('follow.turnOff', { name: publicName(s.seller) }))}</a>`).join(' · ')}</p>
</div></body></html>`;
  return { subject, text, html, headers: { 'Content-Language': lang } };
}

// ---- outbox worker (called from alerts.processQueue) ---------------------------
async function processQueue(now) {
  const m = models();
  const A = alerts();
  now = now || new Date();
  const summary = { sent: 0, emails: 0, skipped: 0, failed: 0, deferred: 0, reason: null };
  const skipPending = async (where, reason) => {
    const [n] = await m.FollowNotification.update({ status: 'skipped', lastError: reason, claimToken: null }, { where: Object.assign({ status: 'pending' }, where) });
    return n;
  };
  const finish = (rows, values) => (rows.length ? m.FollowNotification.update(values, { where: { id: rows.map((r) => r.id) } }) : null);
  await m.FollowNotification.update({ status: 'pending', claimToken: null }, { where: { status: 'sending', updatedAt: { [Op.lt]: new Date(now.getTime() - 10 * 60000) } } });
  summary.skipped += await skipPending({ createdAt: { [Op.lt]: new Date(now.getTime() - A.EXPIRE_DAYS * 86400000) } }, 'expired');
  if (!mailer.isConfigured()) {
    summary.skipped += await skipPending({}, 'smtp_not_configured');
    summary.reason = 'smtp_not_configured';
    return summary;
  }
  const due = { status: 'pending', [Op.or]: [{ nextAttemptAt: null }, { nextAttemptAt: { [Op.lte]: now } }] };
  const users = (await m.FollowNotification.findAll({ where: due, attributes: ['userId'], group: ['userId'], raw: true })).map((r) => r.userId);
  for (const userId of users) {
    if (!(await A.emailBudget(userId, now))) { summary.deferred++; continue; }
    const claim = crypto.randomBytes(12).toString('hex');
    const ids = (await m.FollowNotification.findAll({ where: Object.assign({ userId }, due), attributes: ['id'], order: [['createdAt', 'ASC']], limit: A.postsPerEmail(), raw: true })).map((r) => r.id);
    await m.FollowNotification.update({ status: 'sending', claimToken: claim }, { where: { id: ids, status: 'pending' } });
    const rows = await m.FollowNotification.findAll({ where: { claimToken: claim, status: 'sending' } });
    if (!rows.length) continue;
    const [user, follows, posts, blocks] = await Promise.all([
      m.User.findByPk(userId),
      m.Follow.findAll({ where: { id: rows.map((r) => r.followId) } }),
      m.Post.findAll({ where: { id: rows.map((r) => r.postId) }, include: [{ model: m.User, attributes: ['id', 'firstName', 'lastName'] }, { model: m.SaleDay, as: 'saleDays' }] }),
      m.UserBlock.findAll({ where: { [Op.or]: [{ blockerId: userId }, { blockedId: userId }] }, raw: true }),
    ]);
    const F = new Map(follows.map((f) => [f.id, f]));
    const P = new Map(posts.map((p) => [p.id, p]));
    const blocked = new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));
    const items = [];
    for (const r of rows) {
      const post = P.get(r.postId);
      const f = F.get(r.followId);
      let why = null;
      if (!post) why = 'post_deleted';
      else if (post.hidden) why = 'post_hidden';
      else if (schedule.isEnded(post, now)) why = 'post_ended';
      else if (!f) why = 'unfollowed';
      else if (!f.notify) why = 'email_off';
      else if (blocked.has(post.userId)) why = 'blocked';
      if (why) { await finish([r], { status: 'skipped', lastError: why, claimToken: null }); summary.skipped++; } else items.push({ row: r, post, follow: f, seller: post.User });
    }
    if (!user || !items.length) { await finish(items.map((i) => i.row), { status: 'skipped', lastError: 'no_user', claimToken: null }); continue; }
    const email = renderEmail(user, items);
    try {
      await mailer.send({ to: user.email, subject: email.subject, text: email.text, html: email.html, headers: email.headers });
      const digest = await m.AlertDigest.create({ userId, postCount: items.length, sentAt: new Date(), kind: 'follow' });
      await finish(items.map((i) => i.row), { status: 'sent', sentAt: new Date(), digestId: digest.id, claimToken: null, lastError: null });
      summary.sent += items.length;
      summary.emails++;
    } catch (err) {
      const reason = String((err && (err.code || err.responseCode || err.name)) || 'send_failed').slice(0, 200);
      console.error('Follow emails: sending to user ' + userId + ' failed (' + reason + ')');
      for (const i of items) {
        const attempts = i.row.attempts + 1;
        if (attempts >= A.MAX_ATTEMPTS) { await finish([i.row], { status: 'failed', attempts, lastError: reason, claimToken: null }); summary.failed++; } else {
          await finish([i.row], { status: 'pending', attempts, lastError: reason, claimToken: null, nextAttemptAt: new Date(now.getTime() + Math.pow(2, attempts) * 60000) });
          summary.deferred++;
        }
      }
    }
  }
  return summary;
}

module.exports = {
  MAX_FOLLOWS, follow, unfollow, endBetween, status, list, followedSellerIds, enqueueForPost, schedulePost,
  unsubscribeToken, verifyToken, unsubscribeUrl, turnOff, renderEmail, processQueue,
};
