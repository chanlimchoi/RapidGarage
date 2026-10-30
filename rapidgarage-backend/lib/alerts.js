// Sale alerts: matching new posts against saved alerts, the email outbox
// worker (digest + daily cap + retries) and signed unsubscribe tokens.
const crypto = require('crypto');
const { Op } = require('sequelize');
const geo = require('./geo');
const { matchesPrice } = require('./price');
const i18n = require('./i18n');
const { priceIn } = require('./flyerText');
const { publicName } = require('./people');
const { saleAlertsEnabled } = require('./features');
const mailer = require('./mailer');
const schedule = require('./schedule');
const itemsLib = require('./items');

function models() { return require('../models'); }

function intEnv(name, dflt, min) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= (min === undefined ? 1 : min) ? n : dflt;
}

const RADIUS_MIN = 1;
const RADIUS_MAX = 50;
const FREQUENCIES = ['instant', 'weekly'];
const maxPerUser = () => intEnv('ALERTS_MAX_PER_USER', 5);
const digestMinutes = () => intEnv('ALERT_DIGEST_MINUTES', 15, 0);
const dailyCap = () => intEnv('ALERT_DAILY_MAX_EMAILS', 6);
const postsPerEmail = () => intEnv('ALERT_MAX_POSTS_PER_EMAIL', 20);
const workerSeconds = () => intEnv('ALERT_WORKER_SECONDS', 60);
const MAX_ATTEMPTS = 5;
const EXPIRE_DAYS = 7;

function baseUrl() {
  return String(process.env.APP_BASE_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:3000').trim().replace(/\/+$/, '');
}

// ---- unsubscribe tokens -------------------------------------------------
// HMAC-SHA256 over the alert id with a key derived from ALERT_TOKEN_SECRET (or
// SESSION_SECRET). The token depends only on the id, so it is verified before
// any database lookup: an invalid token gets the same answer whether or not
// the alert exists. Alert ids are never reused and an alert never changes
// owner. No expiry: the link only ever turns one alert off.
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // base64url of a 32-byte digest, unpadded

function tokenKey() {
  const secret = process.env.ALERT_TOKEN_SECRET || process.env.SESSION_SECRET || '';
  if (!secret) throw new Error('ALERT_TOKEN_SECRET or SESSION_SECRET must be set');
  return crypto.createHash('sha256').update('rapidgarage-sale-alerts:' + secret).digest();
}

// purpose separates token spaces (sale alerts: 'unsub.v2.', wanted posts:
// 'wanted.unsub.v1.'), so a token for one id never works for another kind.
function tokenDigest(alertId, purpose) {
  return crypto.createHmac('sha256', tokenKey()).update((purpose || 'unsub.v2.') + alertId).digest();
}

// alertOrId: a SaleAlert (or { id }) or a positive integer id.
function unsubscribeToken(alertOrId, purpose) {
  const id = typeof alertOrId === 'object' && alertOrId ? alertOrId.id : alertOrId;
  return tokenDigest(id, purpose).toString('base64url');
}

// Constant-time check of `token` for alert `alertId`; no database access.
function verifyToken(alertId, token, purpose) {
  const want = tokenDigest(alertId, purpose);
  const wellFormed = typeof token === 'string' && TOKEN_RE.test(token);
  const got = wellFormed ? Buffer.from(token, 'base64url') : Buffer.alloc(want.length);
  const same = got.length === want.length && crypto.timingSafeEqual(got, want);
  return wellFormed && same;
}

function unsubscribeUrl(alert) {
  return baseUrl() + '/alerts/unsubscribe?a=' + alert.id + '&t=' + encodeURIComponent(unsubscribeToken(alert));
}

function oneClickUrl(alert) {
  return baseUrl() + '/api/alerts/unsubscribe?a=' + alert.id + '&t=' + encodeURIComponent(unsubscribeToken(alert));
}

// ---- matching -----------------------------------------------------------
// Queue a notification for every user with an enabled alert that matches the
// post. One row per (user, post); the nearest matching alert wins.
// opts.keywordOnly: only saved searches with a keyword (an edit or a new item
// can make a sale match words it didn't before; area matches were done at
// create/move time). Every matching enabled alert (instant or weekly) gets an
// in-app notification; instant alerts also queue the email as before.
async function enqueueForPost(post, opts) {
  const m = models();
  const keywordOnly = !!(opts && opts.keywordOnly);
  if (!post || post.hidden || typeof post.lat !== 'number' || typeof post.lng !== 'number') return 0;
  // Only sales that haven't ended (upcoming or open now).
  if (schedule.isEnded(post)) return 0;
  if (!(await saleAlertsEnabled())) return 0;
  const dLat = RADIUS_MAX / 69.0;
  const where = { enabled: true, userId: { [Op.ne]: post.userId }, lat: { [Op.between]: [post.lat - dLat, post.lat + dLat] } };
  if (keywordOnly) where.keyword = { [Op.ne]: null };
  const candidates = await m.SaleAlert.findAll({ where });
  let itemNames = null;
  if (candidates.some((a) => a.keyword)) {
    itemNames = (await m.SaleItem.findAll({ where: { postId: post.id, sold: false }, attributes: ['name'], raw: true })).map((i) => i.name);
  }
  const inApp = new Map();
  const email = new Map();
  const better = (map, a, d) => { const prev = map.get(a.userId); if (!prev || d < prev.d) map.set(a.userId, { alert: a, d }); };
  candidates.forEach((a) => {
    const d = geo.haversineMiles({ lat: a.lat, lng: a.lng }, { lat: post.lat, lng: post.lng });
    if (d > a.radiusMiles) return;
    if (!matchesPrice(post, { maxPrice: a.maxPrice, freeOnly: a.freeOnly })) return;
    if (a.keyword && !itemsLib.matchesKeyword(post, itemNames, itemsLib.parseKeyword(a.keyword).words)) return;
    better(inApp, a, d);
    // Weekly alerts get the weekend digest instead (lib/weekendDigest.js).
    if (a.frequency === 'instant') better(email, a, d);
  });
  if (!inApp.size) return 0;
  const userIds = Array.from(inApp.keys());
  const blocks = await m.UserBlock.findAll({
    where: { [Op.or]: [{ blockerId: post.userId, blockedId: userIds }, { blockedId: post.userId, blockerId: userIds }] },
    raw: true,
  });
  blocks.forEach((b) => { const other = b.blockerId === post.userId ? b.blockedId : b.blockerId; inApp.delete(other); email.delete(other); });
  const miles = (d) => Math.round(d * 10) / 10;
  const rows = Array.from(email.entries()).map(([userId, v]) => ({
    userId, alertId: v.alert.id, postId: post.id, distanceMiles: miles(v.d), status: 'pending',
  }));
  if (rows.length) await m.AlertNotification.bulkCreate(rows, { ignoreDuplicates: true });
  // Push only for matches that are new in the bell (a sale edit doesn't buzz anyone twice).
  const inAppIds = Array.from(inApp.keys());
  const already = inAppIds.length ? new Set((await m.Notification.findAll({ where: { userId: inAppIds, dedupeKey: 'search:' + post.id }, attributes: ['userId'], raw: true })).map((r) => r.userId)) : new Set();
  await require('./notifications').add(Array.from(inApp.entries()).map(([userId, v]) => ({
    userId, kind: 'search_match', postId: post.id, alertId: v.alert.id, dedupeKey: 'search:' + post.id, data: { distanceMiles: miles(v.d) },
  })));
  inApp.forEach((v, userId) => { if (!already.has(userId)) require('./push').searchMatch(userId, { title: post.title, postId: post.id, label: v.alert.label || v.alert.keyword || null }); });
  return inApp.size;
}

// Fire-and-forget from request handlers; tests can await idle().
const inflight = new Set();
function track(fn, what) {
  const p = Promise.resolve()
    .then(fn)
    .catch((err) => console.error(what, err && err.message))
    .finally(() => inflight.delete(p));
  inflight.add(p);
  return p;
}
function schedulePostMatch(post, opts) {
  return track(() => enqueueForPost(post, opts), 'Sale alert matching failed for post ' + (post && post.id));
}
const idle = () => Promise.all(Array.from(inflight));

// ---- email --------------------------------------------------------------
const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function alertName(alert, lang) {
  if (alert.label) return alert.label;
  return i18n.t(lang || 'en', 'mail.within', { distance: i18n.formatNumber(lang || 'en', alert.radiusMiles) });
}

// items: [{ post, seller, alert, distanceMiles }]. Returns { subject, text, html, headers }.
// Written in the recipient's saved language (User.locale), English if none.
// opts.weekly: the weekend digest's wording (lib/weekendDigest.js).
function renderEmail(user, items, opts) {
  const weekly = !!(opts && opts.weekly);
  const lang = i18n.normalize(user.locale) || 'en';
  const L = (key, vars) => i18n.t(lang, key, vars);
  const name = (a) => alertName(a, lang);
  const base = baseUrl();
  const manage = base + '/settings#alerts';
  const alerts = Array.from(new Map(items.map((i) => [i.alert.id, i.alert])).values());
  const first = items[0];
  const subject = weekly ? L('weekly.subject', { count: items.length })
    : items.length === 1
      ? L('mail.subjectOne', { title: first.post.title })
      : L('mail.subjectMany', { count: items.length });
  // Sales of the same neighborhood sale (i.event) collapse into one entry that
  // links to the event page; a lone sale just says which event it is part of.
  const away = (d) => (d !== null && d !== undefined ? L('mail.away', { distance: i18n.formatNumber(lang, d) }) : null);
  const perEvent = new Map();
  items.forEach((i) => { if (i.event) perEvent.set(i.event.id, (perEvent.get(i.event.id) || []).concat([i])); });
  const done = new Set();
  const lines = [];
  items.forEach((i) => {
    const group = i.event ? perEvent.get(i.event.id) : null;
    if (group && group.length > 1) {
      if (done.has(i.event.id)) return;
      done.add(i.event.id);
      lines.push({
        title: L('mail.eventTitle', { name: i.event.name }),
        url: base + '/events/' + i.event.id,
        meta: [L('mail.eventSales', { count: group.length }), away(i.distanceMiles)].filter(Boolean).join(' · '),
        alert: name(i.alert),
      });
      return;
    }
    const price = priceIn(lang, i.post);
    const where = [i.post.city, i.post.state].filter(Boolean).join(', ');
    lines.push({
      title: i.post.title,
      url: base + '/post/' + i.post.id,
      meta: [price, away(i.distanceMiles), where, L('mail.by', { name: publicName(i.seller) }), i.event ? L('mail.partOf', { name: i.event.name }) : null].filter(Boolean).join(' · '),
      alert: name(i.alert),
    });
  });
  const hello = user.firstName ? L('mail.hi', { name: user.firstName }) : L('mail.hiAnon');
  const text = [
    hello, '',
    weekly ? L('weekly.intro', { count: items.length }) : items.length === 1 ? L('mail.introOne') : L('mail.introMany', { count: items.length }), '',
    ...lines.map((l) => '* ' + l.title + '\n  ' + l.meta + '\n  ' + l.url + '\n'),
    L('mail.manageText', { url: manage }),
    ...alerts.map((a) => L('mail.turnOffText', { name: name(a), url: unsubscribeUrl(a) })),
  ].join('\n');
  const html = `<!doctype html><html lang="${esc(lang)}"><body style="margin:0;padding:24px;background:#f6f5f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Apple SD Gothic Neo','Malgun Gothic','PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif;color:#1c1b19">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dd;border-radius:16px;padding:24px">
<p style="margin:0 0 4px;font-weight:700;color:#c2410c;font-size:14px">RapidGarage</p>
<h1 style="margin:0 0 16px;font-size:20px">${esc(weekly ? L('weekly.head') : items.length === 1 ? L('mail.headOne') : L('mail.headMany', { count: items.length }))}</h1>
<p style="margin:0 0 16px">${esc(hello)}</p>
${lines.map((l) => `<div style="border:1px solid #e7e4dd;border-radius:12px;padding:12px 14px;margin:0 0 10px">
<a href="${esc(l.url)}" style="color:#c2410c;font-weight:600;font-size:16px;text-decoration:none">${esc(l.title)}</a>
<div style="color:#5f5b53;font-size:13px;margin-top:4px">${esc(l.meta)}</div>
<div style="color:#8a857b;font-size:12px;margin-top:2px">${esc(L('mail.alert', { name: l.alert }))}</div></div>`).join('\n')}
<p style="margin:16px 0 0;font-size:13px"><a href="${esc(manage)}" style="color:#c2410c">${esc(L('mail.manage'))}</a></p>
<p style="margin:8px 0 0;font-size:12px;color:#8a857b">${alerts.map((a) => `<a href="${esc(unsubscribeUrl(a))}" style="color:#8a857b">${esc(L('mail.turnOff', { name: name(a) }))}</a>`).join(' · ')}</p>
</div></body></html>`;
  // RFC 8058 one-click unsubscribe (mail clients POST to this URL).
  const headers = {
    'List-Unsubscribe': '<' + oneClickUrl(alerts[0]) + '>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'Content-Language': lang,
  };
  return { subject, text, html, headers };
}

// ---- outbox worker -----------------------------------------------------
async function skipPending(where, reason) {
  const [n] = await models().AlertNotification.update({ status: 'skipped', lastError: reason, claimToken: null }, { where: Object.assign({ status: 'pending' }, where) });
  return n;
}

async function finish(rows, values) {
  if (!rows.length) return;
  await models().AlertNotification.update(values, { where: { id: rows.map((r) => r.id) } });
}

// One pass over the outboxes: sale alerts, then wanted-post matches (they
// share the per-user digest interval and daily cap), then morning-of sale
// reminders (lib/reminders.js; their own once-per-sale-day dedupe, no digest
// cap since the buyer asked for each one). Returns the sale-alert summary with
// the others under .wanted and .reminders (for logs and tests).
async function processQueue(now) {
  now = now || new Date();
  const summary = await processAlertQueue(now);
  summary.wanted = await require('./wanted').processQueue(now);
  try { summary.follows = await require('./follows').processQueue(now); } catch (err) {
    console.error('Follow email pass failed:', err && err.message);
    summary.follows = { error: true };
  }
  try { summary.reminders = await require('./reminders').processDue(now); } catch (err) {
    console.error('Sale reminder pass failed:', err && err.message);
    summary.reminders = { error: true };
  }
  try { summary.eveReminders = await require('./eveReminders').processDue(now); } catch (err) {
    console.error('Night-before reminder pass failed:', err && err.message);
    summary.eveReminders = { error: true };
  }
  try { summary.rainChecks = await require('./rainChecks').processDue(now); } catch (err) {
    console.error('Rain check pass failed:', err && err.message);
    summary.rainChecks = { error: true };
  }
  try { summary.weekly = await require('./weekendDigest').processWeekly(now); } catch (err) {
    console.error('Weekend digest pass failed:', err && err.message);
    summary.weekly = { error: true };
  }
  try { summary.saleSummaries = await require('./sellerTools').processSummaries(now); } catch (err) {
    console.error('Sale summary pass failed:', err && err.message);
    summary.saleSummaries = { error: true };
  }
  try { summary.markdownDrops = await require('./favorites').markdownsStarted(now); } catch (err) {
    console.error('Favorites markdown pass failed:', err && err.message);
    summary.markdownDrops = { error: true };
  }
  // In-app notifications older than KEEP_DAYS go away.
  try { await require('./notifications').prune(); } catch (err) { console.error('Notification prune failed:', err && err.message); }
  try { await require('./weather').prune(); } catch (err) { console.error('Weather cache prune failed:', err && err.message); }
  return summary;
}

// Rate limits shared by every alert-style email (sale alerts and wanted
// matches): true when `userId` may get an email now (digest interval passed
// and under the daily cap).
async function emailBudget(userId, now) {
  const m = models();
  const last = await m.AlertDigest.max('sentAt', { where: { userId } });
  if (last && now - new Date(last) < digestMinutes() * 60000) return false;
  const today = await m.AlertDigest.count({ where: { userId, sentAt: { [Op.gt]: new Date(now.getTime() - 86400000) } } });
  return today < dailyCap();
}

async function processAlertQueue(now) {
  const m = models();
  now = now || new Date();
  const summary = { sent: 0, emails: 0, skipped: 0, failed: 0, deferred: 0, reason: null };
  // Recover rows a crashed run left in "sending".
  await m.AlertNotification.update({ status: 'pending', claimToken: null },
    { where: { status: 'sending', updatedAt: { [Op.lt]: new Date(now.getTime() - 10 * 60000) } } });
  summary.skipped += await skipPending({ createdAt: { [Op.lt]: new Date(now.getTime() - EXPIRE_DAYS * 86400000) } }, 'expired');
  if (!(await saleAlertsEnabled())) {
    summary.skipped += await skipPending({}, 'alerts_disabled');
    summary.reason = 'alerts_disabled';
    return summary;
  }
  if (!mailer.isConfigured()) {
    const n = await skipPending({}, 'smtp_not_configured');
    if (n) console.log('Sale alerts: SMTP is not configured (SMTP_HOST); skipped ' + n + ' notification(s).');
    summary.skipped += n;
    summary.reason = 'smtp_not_configured';
    return summary;
  }
  const due = { status: 'pending', [Op.or]: [{ nextAttemptAt: null }, { nextAttemptAt: { [Op.lte]: now } }] };
  const users = (await m.AlertNotification.findAll({ where: due, attributes: ['userId'], group: ['userId'], raw: true })).map((r) => r.userId);
  for (const userId of users) {
    if (!(await emailBudget(userId, now))) { summary.deferred++; continue; }
    // Claim this user's due rows so a second worker can't send them too.
    const claim = crypto.randomBytes(12).toString('hex');
    const ids = (await m.AlertNotification.findAll({ where: Object.assign({ userId }, due), attributes: ['id'], order: [['createdAt', 'ASC']], limit: postsPerEmail(), raw: true })).map((r) => r.id);
    await m.AlertNotification.update({ status: 'sending', claimToken: claim }, { where: { id: ids, status: 'pending' } });
    const rows = await m.AlertNotification.findAll({ where: { claimToken: claim, status: 'sending' } });
    if (!rows.length) continue;
    const [user, alerts, posts] = await Promise.all([
      m.User.findByPk(userId),
      m.SaleAlert.findAll({ where: { id: rows.map((r) => r.alertId) } }),
      m.Post.findAll({ where: { id: rows.map((r) => r.postId) }, include: [{ model: m.User, attributes: ['id', 'firstName', 'lastName'] }] }),
    ]);
    const alertById = new Map(alerts.map((a) => [a.id, a]));
    const postById = new Map(posts.map((p) => [p.id, p]));
    const blocks = await m.UserBlock.findAll({ where: { [Op.or]: [{ blockerId: userId }, { blockedId: userId }] }, raw: true });
    const blockedWith = new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));
    const items = [];
    const drop = [];
    rows.forEach((r) => {
      const post = postById.get(r.postId);
      const alert = alertById.get(r.alertId);
      let why = null;
      if (!post) why = 'post_deleted';
      else if (post.hidden) why = 'post_hidden';
      else if (schedule.isEnded(post)) why = 'post_ended';
      else if (!alert || !alert.enabled) why = 'alert_disabled';
      else if (blockedWith.has(post.userId)) why = 'blocked';
      if (why) drop.push({ r, why });
      else items.push({ row: r, post, alert, seller: post.User, distanceMiles: r.distanceMiles });
    });
    for (const d of drop) await finish([d.r], { status: 'skipped', lastError: d.why, claimToken: null });
    summary.skipped += drop.length;
    if (!user || !items.length) { await finish(items.map((i) => i.row), { status: 'skipped', lastError: 'no_user', claimToken: null }); continue; }
    items.sort((a, b) => (a.distanceMiles || 0) - (b.distanceMiles || 0));
    // Neighborhood sales these sales are part of (visible, not ended).
    const evMap = await require('./events').eventsForPosts(items.map((i) => i.post.id), null);
    items.forEach((i) => { i.event = evMap.get(i.post.id) || null; });
    const email = renderEmail(user, items);
    try {
      await mailer.send({ to: user.email, subject: email.subject, text: email.text, html: email.html, headers: email.headers });
      const digest = await m.AlertDigest.create({ userId, postCount: items.length, sentAt: new Date() });
      await finish(items.map((i) => i.row), { status: 'sent', sentAt: new Date(), digestId: digest.id, claimToken: null, lastError: null });
      summary.sent += items.length;
      summary.emails++;
    } catch (err) {
      const reason = String((err && (err.code || err.responseCode || err.name)) || 'send_failed').slice(0, 200);
      console.error('Sale alerts: sending to user ' + userId + ' failed (' + reason + ')');
      for (const i of items) {
        const attempts = i.row.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await finish([i.row], { status: 'failed', attempts, lastError: reason, claimToken: null });
          summary.failed++;
        } else {
          await finish([i.row], { status: 'pending', attempts, lastError: reason, claimToken: null, nextAttemptAt: new Date(now.getTime() + Math.pow(2, attempts) * 60000) });
          summary.deferred++;
        }
      }
    }
  }
  return summary;
}

let timer = null;
let running = false;
function startWorker() {
  if (timer) return;
  const tick = () => {
    if (running) return;
    running = true;
    // One instance at a time (lib/workerLock.js); the outbox rows are claimed
    // atomically below, so a duplicate pass would still not send twice.
    require('./workerLock').withLock(() => processQueue())
      .catch((err) => console.error('Sale alert worker error:', err && err.message))
      .finally(() => { running = false; });
  };
  timer = setInterval(tick, workerSeconds() * 1000);
  if (timer.unref) timer.unref();
  console.log('Sale alert worker every ' + workerSeconds() + 's (SMTP ' + (mailer.isConfigured() ? 'configured' : 'not configured: alerts are logged and skipped') + ')');
}
function stopWorker() { if (timer) clearInterval(timer); timer = null; }

module.exports = {
  RADIUS_MIN, RADIUS_MAX, FREQUENCIES, maxPerUser, digestMinutes, dailyCap, baseUrl,
  unsubscribeToken, verifyToken, unsubscribeUrl, enqueueForPost, schedulePostMatch, idle, track,
  renderEmail, processQueue, emailBudget, postsPerEmail, MAX_ATTEMPTS, EXPIRE_DAYS, startWorker, stopWorker,
};
