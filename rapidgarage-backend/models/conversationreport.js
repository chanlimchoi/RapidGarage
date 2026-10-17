'use strict';
const REASONS = ['harassment', 'scam', 'spam', 'offensive', 'other'];
const STATUSES = ['open', 'dismissed', 'actioned'];

// A participant's report about a conversation (separate from post Reports).
module.exports = (sequelize, DataTypes) => {
  const ConversationReport = sequelize.define('ConversationReport', {
    conversationId: { type: DataTypes.INTEGER, allowNull: false },
    reporterId: { type: DataTypes.INTEGER, allowNull: false },
    reportedUserId: { type: DataTypes.INTEGER, allowNull: false },
    reason: { type: DataTypes.STRING(32), allowNull: false, validate: { isIn: [REASONS] } },
    note: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'open', validate: { isIn: [STATUSES] } },
    // dismissed | warned | banned
    action: { type: DataTypes.STRING(16), allowNull: true },
    reviewerId: { type: DataTypes.INTEGER, allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
    resolutionNote: { type: DataTypes.TEXT, allowNull: true },
  }, {
    indexes: [
      { name: 'conv_reports_conv_status_idx', fields: ['conversationId', 'status'] },
      { name: 'conv_reports_reporter_created_idx', fields: ['reporterId', 'createdAt'] },
      { name: 'conv_reports_one_open_per_user', unique: true, fields: ['conversationId', 'reporterId'], where: { status: 'open' } },
    ],
  });
  ConversationReport.associate = (models) => {
    ConversationReport.belongsTo(models.Conversation, { foreignKey: 'conversationId', onDelete: 'CASCADE' });
    ConversationReport.belongsTo(models.User, { as: 'reporter', foreignKey: 'reporterId', onDelete: 'CASCADE' });
    ConversationReport.belongsTo(models.User, { as: 'reportedUser', foreignKey: 'reportedUserId', onDelete: 'CASCADE' });
    ConversationReport.belongsTo(models.User, { as: 'reviewer', foreignKey: 'reviewerId', onDelete: 'SET NULL' });
  };
  ConversationReport.REASONS = REASONS;
  return ConversationReport;
};
