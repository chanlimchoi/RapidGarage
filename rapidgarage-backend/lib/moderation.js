// Post visibility + report resolution shared by the listing, search, post,
// report and admin controllers.
const { Op } = require('sequelize');
const { isAdmin } = require('./roles');

function models() { return require('../models'); }

const NOTE_MAX = 500;
const REASON_LABELS = {
  spam: 'Spam',
  scam: 'Scam or fraud',
  prohibited: 'Prohibited item',
  offensive: 'Offensive',
  wrong_info: 'Wrong information',
  other: 'Other',
};

// Sequelize where-clause for posts `user` may see in lists and search.
// Admins see everything; owners also see their own hidden posts.
function visibleWhere(user) {
  if (isAdmin(user)) return null;
  if (user && user.id) return { [Op.or]: [{ hidden: false }, { userId: user.id }] };
  return { hidden: false };
}

function canSee(user, post) {
  return !post.hidden || isAdmin(user) || (!!user && user.id === post.userId);
}

function intEnv(name) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const reportsPerHour = () => intEnv('REPORT_MAX_PER_HOUR') || 10;
// Off unless set to a positive integer.
const autoHideThreshold = () => intEnv('REPORT_AUTO_HIDE_THRESHOLD');

// Reports `userId` sent in the last hour, of every kind (one hourly budget).
async function recentReportCount(userId) {
  const m = models();
  const w = { where: { reporterId: userId, createdAt: { [Op.gte]: new Date(Date.now() - 3600 * 1000) } } };
  const counts = await Promise.all([m.Report, m.ConversationReport, m.EventReport, m.WantedReport].map((M) => M.count(w)));
  return counts.reduce((a, b) => a + b, 0);
}

// Close every open report on a post. fields: { status, action, reviewerId, resolutionNote }.
function closeOpenReports(postId, fields, transaction) {
  return models().Report.update(
    Object.assign({ reviewedAt: new Date() }, fields),
    { where: { postId, status: 'open' }, transaction }
  );
}

function hide(post, by, source, transaction) {
  return post.update({ hidden: true, hiddenAt: new Date(), hiddenBy: by || null, hiddenSource: source }, { transaction });
}

function unhide(post, transaction) {
  return post.update({ hidden: false, hiddenAt: null, hiddenBy: null, hiddenSource: null }, { transaction });
}

// After a new report: hide the post once N distinct users have open reports on it.
async function maybeAutoHide(post) {
  const n = autoHideThreshold();
  if (!n || post.hidden) return false;
  const reporters = await models().Report.count({ where: { postId: post.id, status: 'open' }, distinct: true, col: 'reporterId' });
  if (reporters < n) return false;
  await hide(post, null, 'auto');
  return true;
}

module.exports = {
  NOTE_MAX, REASON_LABELS, visibleWhere, canSee, reportsPerHour, autoHideThreshold, recentReportCount,
  closeOpenReports, hide, unhide, maybeAutoHide,
};
