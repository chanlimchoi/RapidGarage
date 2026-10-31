'use strict';
// Buyer safety tools, on top of post reports (controllers/report.js) and the
// moderation queue (controllers/admin.js):
//
// - Reasons `suspicious` and `no_show` join scam / prohibited as "safety"
//   reasons. A no-show flag needs a real dealing with the seller on that sale
//   (a hold, or a conversation the reporter started); only the kind of contact
//   is stored, never the conversation, so admins still read a conversation
//   only when a participant reports it (adminConversations.js).
// - Repeat offenders: when SAFETY_SELLER_REPORTERS different trusted people
//   (default 3) filed safety reports about one seller's listings within
//   SAFETY_WINDOW_DAYS (default 30), the seller goes on a safety hold: every
//   visible listing is hidden (hiddenSource 'repeat') and new posts start
//   hidden until an admin releases or confirms. A seller with SAFETY_STRIKES
//   upheld reports (default 2, last 90 days) has a listing hidden on the
//   first trusted safety report. 0 turns either rule off.
// - Flag abuse: a reporter with REPORT_DISMISSED_LIMIT (default 5) dismissed
//   reports in 30 days, and more dismissed than upheld, is "untrusted": their
//   reports still reach the queue (they aren't told) but never count toward
//   any auto-hide, and their hourly budget drops to 2. Accounts younger than
//   REPORT_TRUST_MIN_HOURS (default 24) don't count toward seller holds.
//   No-show flags: NO_SHOW_PER_DAY per reporter (default 3) and one per
//   seller per 7 days.
const { Op } = require('sequelize');
const mod = require('./moderation');

function models() { return require('../models'); }

const DAY = 86400000;
const SAFETY_REASONS = ['scam', 'suspicious', 'no_show', 'prohibited'];
const STRIKE_DAYS = 90;
const STANDING_DAYS = 30;
const UNTRUSTED_PER_HOUR = 2;

function intEnv(name, dflt, allowZero) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && (n > 0 || (allowZero && n === 0)) ? n : dflt;
}

const sellerReporters = () => intEnv('SAFETY_SELLER_REPORTERS', 3, true);
const windowDays = () => intEnv('SAFETY_WINDOW_DAYS', 30);
const strikes = () => intEnv('SAFETY_STRIKES', 2, true);
const dismissedLimit = () => intEnv('REPORT_DISMISSED_LIMIT', 5);
const trustMinHours = () => intEnv('REPORT_TRUST_MIN_HOURS', 24, true);
const noShowPerDay = () => intEnv('NO_SHOW_PER_DAY', 3);

// { dismissed, upheld, untrusted } for post reports in the last 30 days.
async function standing(userId) {
  const m = models();
  const since = new Date(Date.now() - STANDING_DAYS * DAY);
  const [dismissed, upheld] = await Promise.all(['dismissed', 'actioned'].map((status) => m.Report.count({ where: { reporterId: userId, status, reviewedAt: { [Op.gte]: since } } })));
  return { dismissed, upheld, untrusted: dismissed >= dismissedLimit() && dismissed > upheld };
}

// Standing for many reporters at once: Map(id -> standing).
async function standings(ids) {
  const out = new Map();
  for (const id of Array.from(new Set(ids))) out.set(id, await standing(id));
  return out;
}

async function trusted(userId, opts) {
  const s = await standing(userId);
  if (s.untrusted) return false;
  if (!opts || !opts.age) return true;
  const hours = trustMinHours();
  if (!hours) return true;
  const u = await models().User.findByPk(userId, { attributes: ['id', 'createdAt'] });
  return !!u && Date.now() - new Date(u.createdAt).getTime() >= hours * 3600000;
}

const hourlyBudget = async (userId) => ((await standing(userId)).untrusted ? Math.min(UNTRUSTED_PER_HOUR, mod.reportsPerHour()) : mod.reportsPerHour());

// How `userId` dealt with the seller on `post`: 'hold' | 'conversation' | null.
async function contactWith(userId, post) {
  const m = models();
  if (await m.ItemHold.count({ where: { postId: post.id, buyerId: userId } })) return 'hold';
  if (await m.Conversation.count({ where: { postId: post.id, buyerId: userId, sellerId: post.userId } })) return 'conversation';
  return null;
}

// Checks before a no_show report. -> null when fine, else { status, code, message, retryAfter? }.
async function noShowCheck(userId, post) {
  const m = models();
  const contact = await contactWith(userId, post);
  if (!contact) return { status: 403, code: 'no_contact', message: 'You can flag a no-show only for a seller you arranged to meet.' };
  const day = await m.Report.count({ where: { reporterId: userId, reason: 'no_show', createdAt: { [Op.gte]: new Date(Date.now() - DAY) } } });
  if (day >= noShowPerDay()) return { status: 429, code: 'rate_limited', message: 'You have flagged a lot of no-shows today. Please try again tomorrow.', retryAfter: 86400 };
  const same = await m.Report.count({ where: { reporterId: userId, reason: 'no_show', sellerId: post.userId, createdAt: { [Op.gte]: new Date(Date.now() - 7 * DAY) } } });
  if (same) return { status: 409, code: 'conflict', message: 'You already flagged this seller for a no-show this week.' };
  return { contact };
}

// Distinct reporters (excluding untrusted ones) with open reports on a post.
async function trustedOpenReporters(postId) {
  const rows = await models().Report.findAll({ where: { postId, status: 'open' }, attributes: ['reporterId'], raw: true });
  let n = 0;
  for (const id of Array.from(new Set(rows.map((r) => r.reporterId)))) if (await trusted(id)) n += 1;
  return n;
}

async function hideAllFor(sellerId, at) {
  const m = models();
  const [n] = await m.Post.update({ hidden: true, hiddenAt: at, hiddenBy: null, hiddenSource: 'repeat' }, { where: { userId: sellerId, hidden: false } });
  return n;
}

// After a report was filed. -> 'hold' | 'strike' | null (never told to the reporter).
async function afterReport(report, post) {
  const m = models();
  if (SAFETY_REASONS.indexOf(report.reason) === -1 || !post.userId) return null;
  if (!(await trusted(report.reporterId))) return null;
  const sellerId = post.userId;
  const now = new Date();
  // Seller-level threshold: distinct trusted reporters across their listings.
  const need = sellerReporters();
  if (need) {
    const rows = await m.Report.findAll({
      where: { sellerId, reason: SAFETY_REASONS, status: { [Op.in]: ['open', 'actioned'] }, createdAt: { [Op.gte]: new Date(now.getTime() - windowDays() * DAY) } },
      attributes: ['reporterId'], raw: true,
    });
    let count = 0;
    for (const id of Array.from(new Set(rows.map((r) => r.reporterId)))) if (await trusted(id, { age: true })) count += 1;
    if (count >= need) {
      const seller = await m.User.findByPk(sellerId);
      if (seller && !seller.safetyHoldAt) await seller.update({ safetyHoldAt: now });
      await hideAllFor(sellerId, now);
      return 'hold';
    }
  }
  // Strikes: upheld safety reports against this seller (distinct posts).
  const k = strikes();
  if (k && !post.hidden) {
    const upheld = await m.Report.count({
      where: { sellerId, status: 'actioned', reason: SAFETY_REASONS, reviewedAt: { [Op.gte]: new Date(now.getTime() - STRIKE_DAYS * DAY) } },
      distinct: true, col: 'postId',
    });
    if (upheld >= k) { await mod.hide(post, null, 'repeat'); return 'strike'; }
  }
  return null;
}

// Admin: sellers on a safety hold, with what's hidden and why.
async function holds() {
  const m = models();
  const users = await m.User.findAll({ where: { safetyHoldAt: { [Op.ne]: null } }, attributes: ['id', 'email', 'firstName', 'lastName', 'safetyHoldAt'], order: [['safetyHoldAt', 'ASC']] });
  const out = [];
  for (const u of users) {
    const [hiddenCount, openReports, reporterRows] = await Promise.all([
      m.Post.count({ where: { userId: u.id, hidden: true, hiddenSource: 'repeat' } }),
      m.Report.count({ where: { sellerId: u.id, status: 'open' } }),
      m.Report.findAll({ where: { sellerId: u.id, reason: SAFETY_REASONS, createdAt: { [Op.gte]: new Date(Date.now() - windowDays() * DAY) } }, attributes: ['reporterId', 'reason'], raw: true }),
    ]);
    const reasons = {};
    reporterRows.forEach((r) => { reasons[r.reason] = (reasons[r.reason] || 0) + 1; });
    out.push({ user: { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName }, since: u.safetyHoldAt, hiddenCount, openReports, reporters: new Set(reporterRows.map((r) => r.reporterId)).size, reasons });
  }
  return out;
}

// Admin decision on a hold. release: listings hidden by the hold come back and
// the hold ends (open reports stay in the queue). confirm: hidden listings stay
// hidden as a moderator decision, open reports on them are upheld, and the
// hold stays (new posts keep starting hidden) until released.
async function decide(sellerId, action, by, note) {
  const m = models();
  const seller = await m.User.findByPk(sellerId);
  if (!seller || !seller.safetyHoldAt) return null;
  return m.sequelize.transaction(async (t) => {
    const posts = await m.Post.findAll({ where: { userId: sellerId, hidden: true, hiddenSource: 'repeat' }, transaction: t });
    if (action === 'release') {
      for (const p of posts) await mod.unhide(p, t);
      await seller.update({ safetyHoldAt: null }, { transaction: t });
      return { action, posts: posts.length };
    }
    for (const p of posts) {
      await p.update({ hiddenSource: 'moderator', hiddenBy: by }, { transaction: t });
      await mod.closeOpenReports(p.id, { status: 'actioned', action: 'hidden', reviewerId: by, resolutionNote: note || null }, t);
    }
    return { action, posts: posts.length };
  });
}

const config = () => ({ sellerReporters: sellerReporters(), windowDays: windowDays(), strikes: strikes(), dismissedLimit: dismissedLimit(), trustMinHours: trustMinHours(), noShowPerDay: noShowPerDay() });

module.exports = {
  SAFETY_REASONS, UNTRUSTED_PER_HOUR, standing, standings, trusted, hourlyBudget, contactWith, noShowCheck,
  trustedOpenReporters, afterReport, holds, decide, config,
};
