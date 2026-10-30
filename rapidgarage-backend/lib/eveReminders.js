// Night-before reminders ("This weekend" calendar). A sale someone saved with
// "Remind me" on (SavedPost.remind) shows up in their notifications (the bell)
// and, if they turned push on, on their phone the evening before it opens:
// from EVE_REMINDER_HOUR (default 19:00) in the sale's time zone until
// midnight, or until the sale opens if that is earlier. Only the first day of
// a run of consecutive days gets one (the morning-of reminder covers the rest).
//
// Per-person switch: User.remindEve (Settings > Reminders, on by default).
// Runs in the alert worker tick (lib/alerts processQueue). Once per (person,
// sale, day): the bell row's unique dedupeKey, also across several instances.
// Nothing is emailed here; the morning-of email (lib/reminders.js) is unchanged.
const { Op } = require('sequelize');
const schedule = require('./schedule');
const notifications = require('./notifications');

function models() { return require('../models'); }

function intEnv(name, dflt, min, max) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
}
const eveHour = () => intEnv('EVE_REMINDER_HOUR', 19, 12, 23);
const HOUR = 3600000;
const dedupeKey = (postId, date) => 'reminder_eve:' + postId + ':' + date;

// When the night-before reminder for a sale day is due: { sendAt, until } (ms).
function windowFor(day, timeZone) {
  const tz = timeZone || schedule.defaultTimeZone();
  const eve = schedule.addDays(day.date, -1);
  const sendAt = schedule.zonedToUtc(eve, String(eveHour()).padStart(2, '0') + ':00', tz).getTime();
  const midnight = schedule.zonedToUtc(day.date, '00:00', tz).getTime();
  return { sendAt, until: Math.min(midnight, new Date(day.startsAt).getTime()) };
}

async function blockedPairs(userIds, sellerId) {
  if (!userIds.length) return new Set();
  const rows = await models().UserBlock.findAll({
    where: { [Op.or]: [{ blockerId: sellerId, blockedId: userIds }, { blockedId: sellerId, blockerId: userIds }] }, raw: true,
  });
  return new Set(rows.map((b) => (b.blockerId === sellerId ? b.blockedId : b.blockerId)));
}

async function processDue(now) {
  const m = models();
  now = now || schedule.now();
  const t = now.getTime();
  // Sale days opening within the next 30 hours cover "tomorrow" in every zone.
  const days = await m.SaleDay.findAll({
    where: { startsAt: { [Op.gt]: now, [Op.lt]: new Date(t + 30 * HOUR) } },
    include: [{ model: m.Post, attributes: ['id', 'userId', 'hidden', 'timeZone', 'title'], where: { hidden: false } }],
  });
  const summary = { due: 0, created: 0 };
  if (!days.length) return summary;
  const prevDays = await m.SaleDay.findAll({ where: { postId: days.map((d) => d.postId) }, attributes: ['postId', 'date'], raw: true });
  const has = new Set(prevDays.map((d) => d.postId + '|' + d.date));
  for (const d of days) {
    if (has.has(d.postId + '|' + schedule.addDays(d.date, -1))) continue;
    const w = windowFor(d, d.Post.timeZone);
    if (t < w.sendAt || t >= w.until) continue;
    summary.due++;
    const saves = await m.SavedPost.findAll({
      where: { postId: d.postId, remind: true, userId: { [Op.ne]: d.Post.userId } }, attributes: ['userId'],
      include: [{ model: m.User, attributes: ['id', 'remindEve'], where: { remindEve: true } }],
    });
    if (!saves.length) continue;
    const key = dedupeKey(d.postId, d.date);
    const userIds = saves.map((s) => s.userId);
    const blocked = await blockedPairs(userIds, d.Post.userId);
    const have = new Set((await m.Notification.findAll({ where: { userId: userIds, dedupeKey: key }, attributes: ['userId'], raw: true })).map((r) => r.userId));
    const fresh = userIds.filter((u) => !have.has(u) && !blocked.has(u));
    if (!fresh.length) continue;
    const data = { date: d.date, start: d.startTime, end: d.endTime, timeZone: d.Post.timeZone || schedule.defaultTimeZone() };
    await notifications.add(fresh.map((userId) => ({ userId, kind: 'reminder_eve', postId: d.postId, dedupeKey: key, data })));
    fresh.forEach((userId) => require('./push').reminderEve(userId, { title: d.Post.title, postId: d.postId }));
    summary.created += fresh.length;
  }
  return summary;
}

module.exports = { eveHour, windowFor, processDue, dedupeKey };
