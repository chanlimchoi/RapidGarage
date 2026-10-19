// Weekend digest: sale alerts set to "weekly" get one email before the
// weekend with that weekend's sales in their area, instead of an email per new
// sale. Same filters (radius, max price, free only), unsubscribe links and
// email layout as instant alerts (lib/alerts.js renderEmail).
//
// When: from Thursday WEEKEND_DIGEST_HOUR (17:00) until Saturday noon, in the
// site's time zone (DEFAULT_TIME_ZONE). The alert worker checks every few
// minutes; each alert is claimed (weeklySentAt) before sending, so it goes out
// once per weekend even with several instances. No sales, no email.
const { Op } = require('sequelize');
const schedule = require('./schedule');
const geo = require('./geo');
const mailer = require('./mailer');
const { matchesPrice } = require('./price');
const { saleAlertsEnabled } = require('./features');

function models() { return require('../models'); }

const MAX_SALES = 10;
const RESEND_GAP_MS = 4 * 86400000;
function digestHour() {
  const n = Number(process.env.WEEKEND_DIGEST_HOUR);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 17;
}

// Is `at` inside the sending window (Thu from the hour, Fri, Sat morning)?
function inWindow(at) {
  const tz = schedule.defaultTimeZone();
  const wd = schedule.weekdayOf(schedule.localDate(at, tz));
  const hour = Number(schedule.localTime(at, tz).slice(0, 2));
  return (wd === 4 && hour >= digestHour()) || wd === 5 || (wd === 6 && hour < 12);
}

// This weekend's visible sales for one alert, nearest first (at most MAX_SALES).
async function salesFor(alert, at) {
  const m = models();
  const dLat = alert.radiusMiles / 69.0;
  const posts = await m.Post.findAll({
    where: {
      hidden: false, userId: { [Op.ne]: alert.userId },
      lat: { [Op.between]: [alert.lat - dLat, alert.lat + dLat] }, lng: { [Op.ne]: null },
      endDate: { [Op.gt]: at },
    },
    include: [{ model: m.SaleDay, as: 'saleDays' }, { model: m.User, attributes: ['id', 'firstName', 'lastName'] }],
    limit: 500,
  });
  const blocks = await m.UserBlock.findAll({ where: { [Op.or]: [{ blockerId: alert.userId }, { blockedId: alert.userId }] }, raw: true });
  const blocked = new Set(blocks.map((b) => (b.blockerId === alert.userId ? b.blockedId : b.blockerId)));
  return posts
    .filter((p) => !blocked.has(p.userId) && matchesPrice(p, { maxPrice: alert.maxPrice, freeOnly: alert.freeOnly }) && schedule.matchesWhen(p, 'weekend', at))
    .map((p) => ({ post: p, d: geo.haversineMiles({ lat: alert.lat, lng: alert.lng }, { lat: p.lat, lng: p.lng }) }))
    .filter((x) => x.d <= alert.radiusMiles)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_SALES);
}

// Resolves to { emails, empty } (or { reason } when it didn't run).
async function processWeekly(now) {
  const m = models();
  const at = now || schedule.now();
  if (!inWindow(at)) return { reason: 'not_now' };
  if (!(await saleAlertsEnabled())) return { reason: 'alerts_disabled' };
  if (!mailer.isConfigured()) return { reason: 'smtp_not_configured' };
  const alertsLib = require('./alerts');
  const since = new Date(at.getTime() - RESEND_GAP_MS);
  const due = await m.SaleAlert.findAll({
    where: { enabled: true, frequency: 'weekly', [Op.or]: [{ weeklySentAt: null }, { weeklySentAt: { [Op.lt]: since } }] },
    include: [{ model: m.User }],
    limit: 200,
  });
  const out = { emails: 0, empty: 0 };
  for (const alert of due) {
    // Claim it first so two workers never both send it.
    const prev = alert.weeklySentAt;
    const [claimed] = await m.SaleAlert.update({ weeklySentAt: at }, { where: { id: alert.id, weeklySentAt: prev || null } });
    if (!claimed || !alert.User) continue;
    const sales = await salesFor(alert, at);
    if (!sales.length) { out.empty++; continue; }
    const evMap = await require('./events').eventsForPosts(sales.map((s) => s.post.id), null);
    const items = sales.map((s) => ({ post: s.post, alert, seller: s.post.User, distanceMiles: Math.round(s.d * 10) / 10, event: evMap.get(s.post.id) || null }));
    const email = alertsLib.renderEmail(alert.User, items, { weekly: true });
    try {
      await mailer.send({ to: alert.User.email, subject: email.subject, text: email.text, html: email.html, headers: email.headers });
      out.emails++;
    } catch (err) {
      console.error('Weekend digest for alert ' + alert.id + ' failed:', err && (err.code || err.name));
      // Try again on the next pass.
      await m.SaleAlert.update({ weeklySentAt: prev || null }, { where: { id: alert.id, weeklySentAt: at } });
    }
  }
  return out;
}

module.exports = { MAX_SALES, digestHour, inWindow, salesFor, processWeekly };
