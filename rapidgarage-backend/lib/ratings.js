'use strict';
// Ratings after a conversation: who may rate, validation, summaries, JSON.
const { Op, fn, col } = require('sequelize');
const { publicUser } = require('./people');
const msg = require('./messaging');

function models() { return require('../models'); }

const COMMENT_MAX = 280;

// body -> { errors, value: { stars, comment } }
function validate(body) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = {};
  const value = {};
  if (!Number.isInteger(b.stars) || b.stars < 1 || b.stars > 5) errors.stars = 'Choose 1 to 5 stars.';
  else value.stars = b.stars;
  if (b.comment === undefined || b.comment === null) value.comment = null;
  else if (typeof b.comment !== 'string') errors.comment = 'Comment must be text.';
  else {
    const c = b.comment.trim().replace(/\s+/g, ' ');
    if (c.length > COMMENT_MAX) errors.comment = 'Keep the comment to ' + COMMENT_MAX + ' characters.';
    else value.comment = c || null;
  }
  return { errors, value };
}

// Was there a completed transaction in this conversation? A hold the seller
// marked sold ('completed'), or an accepted meetup whose time has passed.
async function completedTransaction(conv, at) {
  const m = models();
  const t = at || require('./schedule').now();
  const [hold, meetup] = await Promise.all([
    m.ItemHold.count({ where: { conversationId: conv.id, status: 'completed' } }),
    m.MeetupProposal.count({ where: { conversationId: conv.id, status: 'accepted', meetAt: { [Op.lte]: t } } }),
  ]);
  return hold > 0 || meetup > 0;
}

// May `me` rate the seller in `conv`? { canRate, reason }
//   reason: former_user | blocked | buyer_only | needs_transaction
// Only the buyer rates, and only after a completed meetup or sale; one rating
// per conversation (a conversation is one buyer and one seller about one sale).
async function eligibility(conv, me) {
  const other = conv.otherId(me);
  const otherUser = await models().User.findByPk(other, { attributes: ['id'] });
  if (!otherUser) return { canRate: false, reason: 'former_user' };
  const blocks = await msg.blockState(me, other);
  if (blocks.byMe || blocks.byThem) return { canRate: false, reason: 'blocked' };
  if (me !== conv.buyerId) return { canRate: false, reason: 'buyer_only' };
  if (!(await completedTransaction(conv))) return { canRate: false, reason: 'needs_transaction' };
  return { canRate: true, reason: null };
}

// Public seller ratings are the buyers' (older seller-to-buyer ratings stay
// visible to the two people in the conversation only).
const PUBLIC = { raterRole: 'buyer' };

const round1 = (n) => Math.round(n * 10) / 10;

// Map(userId -> { average, count }); users without ratings get { average: null, count: 0 }.
async function summaries(userIds) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  const out = new Map(ids.map((id) => [id, { average: null, count: 0 }]));
  if (!ids.length) return out;
  const rows = await models().Rating.findAll({
    attributes: ['rateeId', [fn('AVG', col('stars')), 'avg'], [fn('COUNT', col('id')), 'n']],
    where: Object.assign({ rateeId: { [Op.in]: ids } }, PUBLIC), group: ['rateeId'], raw: true,
  });
  rows.forEach((r) => out.set(r.rateeId, { average: round1(Number(r.avg)), count: Number(r.n) }));
  return out;
}

async function summaryOf(userId) { return (await summaries([userId])).get(userId); }

// What anyone may see of a rating: never the rater's email; removed comments are blanked.
function ratingJSON(r, viewerId) {
  return {
    id: r.id,
    stars: r.stars,
    comment: r.commentRemovedAt ? null : r.comment,
    commentRemoved: !!r.commentRemovedAt,
    raterRole: r.raterRole,
    rater: r.rater !== undefined ? (publicUser(r.rater) || { id: null, name: 'Former user' }) : undefined,
    rateeId: r.rateeId,
    mine: viewerId ? r.raterId === viewerId : false,
    edited: new Date(r.updatedAt) - new Date(r.createdAt) > 1000,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

module.exports = { COMMENT_MAX, PUBLIC, validate, completedTransaction, eligibility, summaries, summaryOf, ratingJSON };
