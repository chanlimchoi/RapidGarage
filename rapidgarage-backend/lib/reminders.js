// Morning-of reminders for saved sales.
//
// Opt-in per saved sale (SavedPost.remind) with a default for new saves
// (User.remindSaved). On each sale day the reminder is due at REMINDER_HOUR
// (default 7:00) in the sale's own time zone, or an hour before the sale opens
// if that is earlier, and stays due for REMINDER_LATE_HOURS (default 3) and
// never past the day's end: someone saving at noon isn't emailed "this morning".
//
// It runs inside the existing alert worker tick (lib/alerts processQueue), so
// it follows ALERT_WORKER / ALERT_WORKER_SECONDS. Safe with several instances:
//   1. enqueue: every due (user, sale, day) is inserted with ignoreDuplicates
//      against the unique (userId, postId, date) index: one row ever, whoever
//      inserts it first;
//   2. send: rows are claimed with UPDATE ... SET status='sending', claimToken
//      WHERE status='pending' (row-level atomic), then re-read by the token;
//      only the instance that won a row sends it. Stale claims recover after 10 min.
// The in-app notice (GET /reminders/today) comes from the same row (noticeAt)
// and doesn't need SMTP; without SMTP the email part is logged and skipped.
const crypto = require('crypto');
const { Op } = require('sequelize');
const i18n = require('./i18n');
const mailer = require('./mailer');
const schedule = require('./schedule');
const { postAddress } = require('./geo');
const { canSee } = require('./moderation');

function models() { return require('../models'); }
const alerts = () => require('./alerts');

function intEnv(name, dflt, min, max) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
}
const reminderHour = () => intEnv('REMINDER_HOUR', 7, 0, 12);
const lateHours = () => intEnv('REMINDER_LATE_HOURS', 3, 1, 12);
const MAX_ATTEMPTS = 5;
const HOUR = 3600000;
const PURPOSE = 'reminder.unsub.v1.';
// Skip reasons that also hide the in-app notice.
const INVALID = ['post_deleted', 'post_hidden', 'day_cancelled', 'ended', 'blocked', 'turned_off', 'unsubscribed', 'no_user'];

// When the reminder for a sale day becomes due: { sendAt, until } (ms).
function windowFor(day, timeZone) {
  const tz = timeZone || schedule.defaultTimeZone();
  const start = new Date(day.startsAt).getTime();
  const end = new Date(day.endsAt).getTime();
  const morning = schedule.zonedToUtc(day.date, String(reminderHour()).padStart(2, '0') + ':00', tz).getTime();
  const sendAt = Math.min(morning, start - HOUR);
  return { sendAt, until: Math.min(sendAt + lateHours() * HOUR, end) };
}

// ---- tokens (same HMAC machinery as sale alerts, own purpose) ----------
const unsubscribeToken = (userId) => alerts().unsubscribeToken(userId, PURPOSE);
const verifyToken = (userId, token) => alerts().verifyToken(userId, token, PURPOSE);
const unsubscribeUrl = (userId) => alerts().baseUrl() + '/alerts/unsubscribe?r=' + userId + '&t=' + encodeURIComponent(unsubscribeToken(userId));
const oneClickUrl = (userId) => alerts().baseUrl() + '/api/reminders/unsubscribe?r=' + userId + '&t=' + encodeURIComponent(unsubscribeToken(userId));

// Turn every reminder off for a user (email link / settings).
async function turnOffAll(userId) {
  const m = models();
  await m.User.update({ remindSaved: false }, { where: { id: userId } });
  await m.SavedPost.update({ remind: false }, { where: { userId, remind: true } });
  await m.SaleReminder.update({ status: 'skipped', lastError: 'unsubscribed', claimToken: null }, { where: { userId, status: 'pending' } });
}

// ---- enqueue -------------------------------------------------------------
async function enqueueDue(now) {
  const m = models();
  const t = now.getTime();
  const days = await m.SaleDay.findAll({
    where: { startsAt: { [Op.lt]: new Date(t + 24 * HOUR), [Op.gt]: new Date(t - 24 * HOUR) }, endsAt: { [Op.gt]: now } },
    include: [{ model: m.Post, attributes: ['id', 'userId', 'hidden', 'timeZone', 'title'], where: { hidden: false } }],
  });
  let created = 0;
  for (const d of days) {
    const w = windowFor(d, d.Post.timeZone);
    if (t < w.sendAt || t >= w.until) continue;
    const saves = await m.SavedPost.findAll({ where: { postId: d.postId, remind: true, userId: { [Op.ne]: d.Post.userId } }, attributes: ['userId'], raw: true });
    if (!saves.length) continue;
    // Skip the ones already queued for this sale-day. The unique (user, post,
    // date) index + ignoreDuplicates still settles a race between instances.
    const have = new Set((await m.SaleReminder.findAll({ where: { postId: d.postId, date: d.date }, attributes: ['userId'], raw: true })).map((r) => r.userId));
    const rows = saves.filter((s) => !have.has(s.userId))
      .map((s) => ({ userId: s.userId, postId: d.postId, date: d.date, startsAt: d.startsAt, endsAt: d.endsAt, status: 'pending', noticeAt: now }));
    if (!rows.length) continue;
    await m.SaleReminder.bulkCreate(rows, { ignoreDuplicates: true });
    rows.forEach((r) => require('./push').reminder(r.userId, { title: d.Post.title, postId: d.postId }));
    created += rows.length;
  }
  return created;
}

// Why a reminder must not go out (or show) now, or null.
async function invalidReason(row, post, user, blockedWith, now) {
  const m = models();
  if (!user) return 'no_user';
  if (!post) return 'post_deleted';
  if (post.hidden || !canSee(user, post)) return 'post_hidden';
  const day = (post.saleDays || []).find((d) => d.date === row.date);
  if (!day) return 'day_cancelled';
  if (new Date(day.endsAt).getTime() <= now.getTime()) return 'ended';
  if (blockedWith.has(post.userId)) return 'blocked';
  const saved = await m.SavedPost.findOne({ where: { userId: row.userId, postId: row.postId }, attributes: ['remind'], raw: true });
  if (!saved || !saved.remind) return 'turned_off';
  return null;
}

async function blockedSet(userId) {
  const blocks = await models().UserBlock.findAll({ where: { [Op.or]: [{ blockerId: userId }, { blockedId: userId }] }, raw: true });
  return new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));
}

// ---- email ---------------------------------------------------------------
const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// "8:00 AM – 2:00 PM" in the sale's time zone and the reader's language.
function timeWindow(lang, startsAt, endsAt, tz) {
  try {
    const f = new Intl.DateTimeFormat(i18n.intlLocale(lang), { timeZone: tz || schedule.defaultTimeZone(), hour: 'numeric', minute: '2-digit' });
    const sp = (s) => s.replace(/[\u00a0\u2009\u202f]/g, ' ');
    return sp(f.format(new Date(startsAt))) + ' – ' + sp(f.format(new Date(endsAt)));
  } catch (e) { return new Date(startsAt).toISOString() + ' – ' + new Date(endsAt).toISOString(); }
}
function dayLabel(lang, startsAt, tz) {
  try { return new Intl.DateTimeFormat(i18n.intlLocale(lang), { timeZone: tz || schedule.defaultTimeZone(), weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(startsAt)); } catch (e) { return ''; }
}

// items: [{ row, post }]. Returns { subject, text, html, headers }.
function renderEmail(user, items) {
  const lang = i18n.normalize(user.locale) || 'en';
  const L = (key, vars) => i18n.t(lang, key, vars);
  const base = alerts().baseUrl();
  const routeUrl = base + '/saved?when=today#route';
  const manage = base + '/settings#reminders';
  const first = items[0];
  const time = (i) => timeWindow(lang, i.row.startsAt, i.row.endsAt, i.post.timeZone);
  const subject = items.length === 1
    ? L('rmail.subjectOne', { title: first.post.title, time: time(first) })
    : L('rmail.subjectMany', { count: items.length });
  const lines = items.map((i) => ({
    title: i.post.title,
    url: base + '/post/' + i.post.id,
    when: L('rmail.when', { day: dayLabel(lang, i.row.startsAt, i.post.timeZone), time: time(i) }),
    where: i.post.street ? postAddress(i.post) : [i.post.city, i.post.state].filter(Boolean).join(', '),
  }));
  const hello = user.firstName ? L('mail.hi', { name: user.firstName }) : L('mail.hiAnon');
  const intro = items.length === 1 ? L('rmail.introOne') : L('rmail.introMany', { count: items.length });
  const text = [
    hello, '', intro, '',
    ...lines.map((l) => '* ' + l.title + '\n  ' + l.when + '\n  ' + (l.where ? l.where + '\n  ' : '') + l.url + '\n'),
    L('rmail.routeText', { url: routeUrl }), '',
    L('rmail.manageText', { url: manage }),
    L('rmail.turnOffText', { url: unsubscribeUrl(user.id) }),
  ].join('\n');
  const html = `<!doctype html><html lang="${esc(lang)}"><body style="margin:0;padding:24px;background:#f6f5f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Apple SD Gothic Neo','Malgun Gothic','PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif;color:#1c1b19">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dd;border-radius:16px;padding:24px">
<p style="margin:0 0 4px;font-weight:700;color:#c2410c;font-size:14px">RapidGarage</p>
<h1 style="margin:0 0 16px;font-size:20px">${esc(items.length === 1 ? L('rmail.headOne') : L('rmail.headMany', { count: items.length }))}</h1>
<p style="margin:0 0 8px">${esc(hello)}</p>
<p style="margin:0 0 16px">${esc(intro)}</p>
${lines.map((l) => `<div style="border:1px solid #e7e4dd;border-radius:12px;padding:12px 14px;margin:0 0 10px">
<a href="${esc(l.url)}" style="color:#c2410c;font-weight:600;font-size:16px;text-decoration:none">${esc(l.title)}</a>
<div style="color:#1c1b19;font-size:14px;margin-top:4px;font-weight:600">${esc(l.when)}</div>
${l.where ? `<div style="color:#5f5b53;font-size:13px;margin-top:2px">${esc(l.where)}</div>` : ''}</div>`).join('\n')}
<p style="margin:16px 0 0"><a href="${esc(routeUrl)}" style="display:inline-block;background:#c2410c;color:#ffffff;border-radius:999px;padding:10px 18px;font-weight:600;text-decoration:none">${esc(L('rmail.route'))}</a></p>
<p style="margin:16px 0 0;font-size:13px"><a href="${esc(manage)}" style="color:#c2410c">${esc(L('rmail.manage'))}</a></p>
<p style="margin:8px 0 0;font-size:12px;color:#8a857b"><a href="${esc(unsubscribeUrl(user.id))}" style="color:#8a857b">${esc(L('rmail.turnOff'))}</a></p>
</div></body></html>`;
  const headers = {
    'List-Unsubscribe': '<' + oneClickUrl(user.id) + '>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'Content-Language': lang,
  };
  return { subject, text, html, headers };
}

// ---- worker pass ----------------------------------------------------------
async function finish(ids, values) {
  if (ids.length) await models().SaleReminder.update(values, { where: { id: ids } });
}

const postInclude = () => [{ model: models().SaleDay, as: 'saleDays' }];

async function processDue(now) {
  const m = models();
  now = now || schedule.now();
  const summary = { queued: 0, sent: 0, emails: 0, skipped: 0, failed: 0, deferred: 0, reason: null };
  summary.queued = await enqueueDue(now);
  await m.SaleReminder.update({ status: 'pending', claimToken: null },
    { where: { status: 'sending', updatedAt: { [Op.lt]: new Date(Date.now() - 10 * 60000) } } });
  const [ended] = await m.SaleReminder.update({ status: 'skipped', lastError: 'ended', claimToken: null }, { where: { status: 'pending', endsAt: { [Op.lte]: now } } });
  summary.skipped += ended;
  if (!mailer.isConfigured()) {
    const [n] = await m.SaleReminder.update({ status: 'skipped', lastError: 'smtp_not_configured', claimToken: null }, { where: { status: 'pending' } });
    if (n) console.log('Sale reminders: SMTP is not configured (SMTP_HOST); skipped ' + n + ' email(s). In-app notices still show.');
    summary.skipped += n;
    summary.reason = 'smtp_not_configured';
    return summary;
  }
  const due = { status: 'pending', [Op.or]: [{ nextAttemptAt: null }, { nextAttemptAt: { [Op.lte]: now } }] };
  const users = (await m.SaleReminder.findAll({ where: due, attributes: ['userId'], group: ['userId'], raw: true })).map((r) => r.userId);
  for (const userId of users) {
    const claim = crypto.randomBytes(12).toString('hex');
    const ids = (await m.SaleReminder.findAll({ where: Object.assign({ userId }, due), attributes: ['id'], order: [['startsAt', 'ASC']], limit: 20, raw: true })).map((r) => r.id);
    await m.SaleReminder.update({ status: 'sending', claimToken: claim }, { where: { id: ids, status: 'pending' } });
    const rows = await m.SaleReminder.findAll({ where: { claimToken: claim, status: 'sending' }, order: [['startsAt', 'ASC']] });
    if (!rows.length) continue;
    const [user, posts, blockedWith] = await Promise.all([
      m.User.findByPk(userId),
      m.Post.findAll({ where: { id: rows.map((r) => r.postId) }, include: postInclude() }),
      blockedSet(userId),
    ]);
    const byId = new Map(posts.map((p) => [p.id, p]));
    const items = [];
    for (const r of rows) {
      const post = byId.get(r.postId);
      const why = await invalidReason(r, post, user, blockedWith, now);
      if (why) { await finish([r.id], { status: 'skipped', lastError: why, claimToken: null }); summary.skipped++; } else items.push({ row: r, post });
    }
    if (!items.length) continue;
    const email = renderEmail(user, items);
    try {
      await mailer.send({ to: user.email, subject: email.subject, text: email.text, html: email.html, headers: email.headers });
      await finish(items.map((i) => i.row.id), { status: 'sent', sentAt: new Date(), claimToken: null, lastError: null });
      summary.sent += items.length;
      summary.emails++;
    } catch (err) {
      const reason = String((err && (err.code || err.responseCode || err.name)) || 'send_failed').slice(0, 200);
      console.error('Sale reminders: sending to user ' + userId + ' failed (' + reason + ')');
      for (const i of items) {
        const attempts = i.row.attempts + 1;
        const next = new Date(now.getTime() + Math.pow(2, attempts) * 60000);
        if (attempts >= MAX_ATTEMPTS || next >= new Date(i.row.endsAt)) {
          await finish([i.row.id], { status: 'failed', attempts, lastError: reason, claimToken: null });
          summary.failed++;
        } else {
          await finish([i.row.id], { status: 'pending', attempts, lastError: reason, claimToken: null, nextAttemptAt: next });
          summary.deferred++;
        }
      }
    }
  }
  return summary;
}

// ---- in-app notices --------------------------------------------------------
// Today's reminders for `user` that are still valid and not dismissed.
async function notices(user, now) {
  const m = models();
  now = now || schedule.now();
  if (!user) return [];
  const rows = await m.SaleReminder.findAll({
    where: { userId: user.id, noticeAt: { [Op.ne]: null }, seenAt: null, endsAt: { [Op.gt]: now }, [Op.or]: [{ lastError: null }, { lastError: { [Op.notIn]: INVALID } }] },
    order: [['startsAt', 'ASC']], limit: 10,
  });
  if (!rows.length) return [];
  const [posts, blockedWith] = await Promise.all([
    m.Post.findAll({ where: { id: rows.map((r) => r.postId) }, include: postInclude() }),
    blockedSet(user.id),
  ]);
  const byId = new Map(posts.map((p) => [p.id, p]));
  const out = [];
  for (const r of rows) {
    const post = byId.get(r.postId);
    if (await invalidReason(r, post, user, blockedWith, now)) continue;
    const day = post.saleDays.find((d) => d.date === r.date);
    out.push({
      id: r.id, postId: post.id, title: post.title, date: r.date, timeZone: post.timeZone || schedule.defaultTimeZone(),
      startsAt: day.startsAt, endsAt: day.endsAt, open: new Date(day.startsAt) <= now, city: post.city || null, state: post.state || null,
    });
  }
  return out;
}

module.exports = {
  reminderHour, lateHours, windowFor, enqueueDue, processDue, renderEmail, notices, turnOffAll,
  unsubscribeToken, verifyToken, unsubscribeUrl, oneClickUrl, timeWindow, INVALID, MAX_ATTEMPTS,
};
