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
  };
  Message.BODY_MAX = BODY_MAX;
  return Message;
};
