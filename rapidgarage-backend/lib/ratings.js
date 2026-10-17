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

// May `me` rate the other participant of `conv`? { canRate, reason }
//   reason: needs_messages | blocked | former_user
async function eligibility(conv, me) {
  const other = conv.otherId(me);
  const otherUser = await models().User.findByPk(other, { attributes: ['id'] });
  if (!otherUser) return { canRate: false, reason: 'former_user' };
  const blocks = await msg.blockState(me, other);
  if (blocks.byMe || blocks.byThem) return { canRate: false, reason: 'blocked' };
  const [mine, theirs] = await Promise.all([
    models().Message.count({ where: { conversationId: conv.id, senderId: me } }),
    models().Message.count({ where: { conversationId: conv.id, senderId: other } }),
  ]);
  if (!mine || !theirs) return { canRate: false, reason: 'needs_messages' };
  return { canRate: true, reason: null };
}

const round1 = (n) => Math.round(n * 10) / 10;

// Map(userId -> { average, count }); users without ratings get { average: null, count: 0 }.
async function summaries(userIds) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  const out = new Map(ids.map((id) => [id, { average: null, count: 0 }]));
  if (!ids.length) return out;
  const rows = await models().Rating.findAll({
    attributes: ['rateeId', [fn('AVG', col('stars')), 'avg'], [fn('COUNT', col('id')), 'n']],
    where: { rateeId: { [Op.in]: ids } }, group: ['rateeId'], raw: true,
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

module.exports = { COMMENT_MAX, validate, eligibility, summaries, summaryOf, ratingJSON };
