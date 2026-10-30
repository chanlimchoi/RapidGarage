// Web Push notifications (VAPID) for phones and desktops, even with the app
// closed: new messages, new sales from people you follow, morning reminders.
//
// * On only when VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set (generate a
//   pair with `npx web-push generate-vapid-keys`).
// * Notifications are end-to-end encrypted to the browser (the Web Push
//   standard), and still say as little as possible because they show on lock
//   screens: who and which sale, never message text.
// * The server POSTs to the endpoint each browser gives us, so only endpoints
//   on known push services are accepted (no requests to arbitrary hosts).
// * Gone subscriptions (404/410) and ones that keep failing are deleted.
const { Op } = require('sequelize');
const i18n = require('./i18n');

function models() { return require('../models'); }

const KINDS = { message: 'pushMessages', follow: 'pushFollows', reminder: 'pushReminders' };
const MAX_PER_USER = 10;
const MAX_FAILURES = 5;

// Push services of the major browsers (Chrome/Edge/Android, Firefox, Safari, Windows).
const DEFAULT_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com'];
function allowedHosts() {
  const extra = String(process.env.PUSH_EXTRA_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return DEFAULT_HOSTS.concat(extra);
}
function allowedEndpoint(raw) {
  if (typeof raw !== 'string' || raw.length > 1024) return false;
  let u;
  try { u = new URL(raw); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase();
  return allowedHosts().some((h) => host === h || host.endsWith('.' + h));
}
const B64URL = /^[A-Za-z0-9_-]+$/;
const validKeys = (k) => !!k && typeof k.p256dh === 'string' && typeof k.auth === 'string'
  && B64URL.test(k.p256dh) && B64URL.test(k.auth) && k.p256dh.length >= 80 && k.p256dh.length <= 120 && k.auth.length >= 16 && k.auth.length <= 40;

const publicKey = () => String(process.env.VAPID_PUBLIC_KEY || '').trim() || null;
const isConfigured = () => !!override || (!!publicKey() && !!String(process.env.VAPID_PRIVATE_KEY || '').trim());

// ---- sender (tests replace it) -------------------------------------------
let override = null; // async (subscription, payloadString, options) -> { statusCode }
function setSender(fn) { override = fn || null; }
function sender() {
  if (override) return override;
  const webpush = require('web-push');
  const subject = String(process.env.VAPID_SUBJECT || '').trim() || 'mailto:admin@' + (() => { try { return new URL(require('./alerts').baseUrl()).hostname; } catch (e) { return 'localhost'; } })();
  webpush.setVapidDetails(subject, publicKey(), String(process.env.VAPID_PRIVATE_KEY).trim());
  return (sub, payload, options) => webpush.sendNotification(sub, payload, options);
}

// ---- subscriptions ----------------------------------------------------------
// Resolves to { ok } or { reason: 'endpoint' | 'keys' }.
async function subscribe(userId, body, label) {
  const m = models();
  const endpoint = body && body.endpoint;
  if (!allowedEndpoint(endpoint)) return { reason: 'endpoint' };
  if (!validKeys(body.keys)) return { reason: 'keys' };
  const values = { userId, endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, label: label ? String(label).slice(0, 120) : null, failures: 0 };
  // A device that switches accounts moves its subscription with it.
  const existing = await m.PushSubscription.findOne({ where: { endpoint } });
  if (existing) await existing.update(values);
  else await m.PushSubscription.create(values);
  const mine = await m.PushSubscription.findAll({ where: { userId }, order: [['updatedAt', 'DESC'], ['id', 'DESC']], attributes: ['id'] });
  if (mine.length > MAX_PER_USER) await m.PushSubscription.destroy({ where: { id: mine.slice(MAX_PER_USER).map((s) => s.id) } });
  return { ok: true };
}

const unsubscribe = (userId, endpoint) => models().PushSubscription.destroy({ where: { userId, endpoint: String(endpoint || '') } });
const deviceCount = (userId) => models().PushSubscription.count({ where: { userId } });

// ---- sending ------------------------------------------------------------------
const inflight = new Set();
function track(fn) {
  const p = Promise.resolve().then(fn).catch((err) => console.error('Push failed:', err && (err.statusCode || err.code || err.name))).finally(() => inflight.delete(p));
  inflight.add(p);
  return p;
}
// Waits for everything queued, including sends queued by other sends.
const idle = async () => { while (inflight.size) await Promise.all(Array.from(inflight)); };

// payload: { title, body, url, tag }. `kind` checks the person's choice; null
// means always (the "send a test" button). Resolves to how many devices got it.
async function sendTo(userId, kind, payload) {
  if (!isConfigured()) return 0;
  const m = models();
  if (kind) {
    const pref = KINDS[kind];
    const user = await m.User.findByPk(userId, { attributes: ['id', pref] });
    if (!user || !user.get(pref)) return 0;
  }
  const subs = await m.PushSubscription.findAll({ where: { userId } });
  if (!subs.length) return 0;
  const send = sender();
  const data = JSON.stringify({ title: String(payload.title).slice(0, 120), body: String(payload.body || '').slice(0, 200), url: payload.url || '/', tag: payload.tag || null });
  let delivered = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, data, { TTL: 6 * 3600, urgency: kind === 'message' ? 'high' : 'normal' });
      delivered++;
      await s.update({ failures: 0, lastSentAt: new Date() });
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 404 || code === 410 || s.failures + 1 >= MAX_FAILURES) await s.destroy();
      else await s.update({ failures: s.failures + 1 });
    }
  }));
  return delivered;
}

// Fire-and-forget wrappers, in the recipient's language.
async function langOf(userId) {
  const u = await models().User.findByPk(userId, { attributes: ['id', 'locale'] });
  return (u && i18n.normalize(u.locale)) || 'en';
}

function message(recipientId, { senderName, postTitle, conversationId }) {
  return track(async () => {
    // A tab that is open already shows it live; don't buzz the phone too.
    if (require('./live').isConnected(recipientId)) return 0;
    const lang = await langOf(recipientId);
    return sendTo(recipientId, 'message', {
      title: i18n.t(lang, 'push.messageTitle', { name: senderName }),
      body: postTitle ? i18n.t(lang, 'push.messageAbout', { title: postTitle }) : i18n.t(lang, 'push.messageOpen'),
      url: '/messages/' + conversationId,
      tag: 'conversation-' + conversationId,
    });
  });
}

function newSale(followerId, { sellerName, title, postId }) {
  return track(async () => {
    const lang = await langOf(followerId);
    return sendTo(followerId, 'follow', { title: i18n.t(lang, 'push.followTitle', { name: sellerName }), body: title, url: '/post/' + postId, tag: 'post-' + postId });
  });
}

function reminder(userId, { title, postId }) {
  return track(async () => {
    const lang = await langOf(userId);
    return sendTo(userId, 'reminder', { title: i18n.t(lang, 'push.reminderTitle'), body: title, url: '/post/' + postId, tag: 'reminder-' + postId });
  });
}

// The evening before a saved sale (lib/eveReminders.js); same switch as reminders.
function reminderEve(userId, { title, postId }) {
  return track(async () => {
    const lang = await langOf(userId);
    return sendTo(userId, 'reminder', { title: i18n.t(lang, 'push.reminderEveTitle'), body: title, url: '/post/' + postId, tag: 'reminder-eve-' + postId });
  });
}

module.exports = {
  reminderEve,
  KINDS, MAX_PER_USER, allowedEndpoint, validKeys, publicKey, isConfigured, setSender,
  subscribe, unsubscribe, deviceCount, sendTo, message, newSale, reminder, idle, track,
};
