// Settings + helpers shared by the conversation endpoints.
const { Op } = require('sequelize');

function models() { return require('../models'); }

function intEnv(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : dflt;
}

const BODY_MAX = 2000;
const PAGE_SIZE = 30;
const messagesPerMinute = () => intEnv('MESSAGE_MAX_PER_MINUTE', 20);
const conversationsPerHour = () => intEnv('CONVERSATION_MAX_PER_HOUR', 20);

// Validate a message body: plain text, 1..2000 chars after trimming.
function validateBody(body) {
  if (typeof body !== 'string') return { error: 'Write a message.' };
  const text = body.replace(/\r\n?/g, '\n').trim();
  if (!text) return { error: 'Write a message.' };
  if (text.length > BODY_MAX) return { error: 'Keep messages under ' + BODY_MAX + ' characters.' };
  return { text };
}

// Block state between two users: { byMe, byThem }.
async function blockState(me, other) {
  const rows = await models().UserBlock.findAll({
    where: { [Op.or]: [{ blockerId: me, blockedId: other }, { blockerId: other, blockedId: me }] },
    attributes: ['blockerId'], raw: true,
  });
  return { byMe: rows.some((r) => r.blockerId === me), byThem: rows.some((r) => r.blockerId === other) };
}

// Unread message counts per conversation for `me`: Map(conversationId -> n).
async function unreadCounts(me, conversationIds) {
  const { sequelize } = models();
  const where = conversationIds ? ' AND c.id IN (:ids)' : '';
  if (conversationIds && !conversationIds.length) return new Map();
  const rows = await sequelize.query(
    'SELECT m."conversationId" AS id, COUNT(*) AS n FROM "Messages" m JOIN "Conversations" c ON c.id = m."conversationId" ' +
    'WHERE m."senderId" <> :me AND (' +
    '(c."buyerId" = :me AND (c."buyerLastReadAt" IS NULL OR m."createdAt" > c."buyerLastReadAt")) OR ' +
    '(c."sellerId" = :me AND (c."sellerLastReadAt" IS NULL OR m."createdAt" > c."sellerLastReadAt")))' + where +
    ' GROUP BY m."conversationId"',
    { replacements: { me, ids: conversationIds || [] }, type: sequelize.QueryTypes.SELECT }
  );
  return new Map(rows.map((r) => [Number(r.id), Number(r.n)]));
}

module.exports = { BODY_MAX, PAGE_SIZE, messagesPerMinute, conversationsPerHour, validateBody, blockState, unreadCounts };
