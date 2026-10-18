'use strict';
const BODY_MAX = 2000;
// Plain text only; the client renders it as text (never HTML).
module.exports = (sequelize, DataTypes) => {
  const Message = sequelize.define('Message', {
    conversationId: { type: DataTypes.INTEGER, allowNull: false },
    senderId: { type: DataTypes.INTEGER, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false, validate: { len: [1, BODY_MAX] } },
    // Soft delete by a moderator: participants see "removed by moderator".
    removedAt: { type: DataTypes.DATE, allowNull: true },
    removedBy: { type: DataTypes.INTEGER, allowNull: true },
    // 'text', 'meetup' (below), or 'hold' for item-hold events (holdEvent: requested | accepted |
    // declined | released | cancelled | expired | sold); body keeps an English summary.
    kind: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'text' },
    holdId: { type: DataTypes.INTEGER, allowNull: true },
    holdEvent: { type: DataTypes.STRING(16), allowNull: true },
    // 'meetup' messages: a meetup suggestion step (meetupEvent: proposed |
    // countered | accepted | declined | cancelled | expired).
    meetupId: { type: DataTypes.INTEGER, allowNull: true },
    meetupEvent: { type: DataTypes.STRING(16), allowNull: true },
  }, {
    updatedAt: false,
    indexes: [
      { name: 'messages_conversation_idx', fields: ['conversationId', 'id'] },
      { name: 'messages_sender_created_idx', fields: ['senderId', 'createdAt'] },
    ],
  });
  Message.associate = (models) => {
    Message.belongsTo(models.Conversation, { foreignKey: 'conversationId', onDelete: 'CASCADE' });
    Message.belongsTo(models.User, { as: 'sender', foreignKey: 'senderId', onDelete: 'CASCADE' });
    Message.belongsTo(models.ItemHold, { as: 'hold', foreignKey: 'holdId', onDelete: 'SET NULL', constraints: false });
    Message.belongsTo(models.MeetupProposal, { as: 'meetup', foreignKey: 'meetupId', onDelete: 'SET NULL', constraints: false });
  };
  Message.BODY_MAX = BODY_MAX;
  return Message;
};
