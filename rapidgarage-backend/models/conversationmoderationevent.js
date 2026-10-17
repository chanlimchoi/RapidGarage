'use strict';
const TYPES = ['read', 'dismiss', 'warn', 'ban', 'unban', 'remove_message'];

// Append-only audit log: every admin read of a reported conversation and
// every moderation action on it.
module.exports = (sequelize, DataTypes) => {
  const ConversationModerationEvent = sequelize.define('ConversationModerationEvent', {
    conversationId: { type: DataTypes.INTEGER, allowNull: false },
    reportId: { type: DataTypes.INTEGER, allowNull: true },
    adminId: { type: DataTypes.INTEGER, allowNull: true },
    type: { type: DataTypes.STRING(24), allowNull: false, validate: { isIn: [TYPES] } },
    targetUserId: { type: DataTypes.INTEGER, allowNull: true },
    messageId: { type: DataTypes.INTEGER, allowNull: true },
    note: { type: DataTypes.TEXT, allowNull: true },
  }, {
    updatedAt: false,
    indexes: [{ name: 'conv_mod_events_conv_idx', fields: ['conversationId', 'createdAt'] }],
  });
  ConversationModerationEvent.associate = (models) => {
    ConversationModerationEvent.belongsTo(models.Conversation, { foreignKey: 'conversationId', onDelete: 'CASCADE' });
    ConversationModerationEvent.belongsTo(models.ConversationReport, { as: 'report', foreignKey: 'reportId', onDelete: 'SET NULL' });
    ConversationModerationEvent.belongsTo(models.User, { as: 'admin', foreignKey: 'adminId', onDelete: 'SET NULL' });
  };
  ConversationModerationEvent.TYPES = TYPES;
  return ConversationModerationEvent;
};
