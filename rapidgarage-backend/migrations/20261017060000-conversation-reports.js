'use strict';
// Conversation reports, the admin moderation/audit log, messaging bans and
// moderator message removal. Post reports (Reports table) are untouched.
const userRef = (Sequelize, allowNull, onDelete) => ({ allowNull, type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onDelete, onUpdate: 'CASCADE' });

module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.addColumn('Users', 'messagingBanned', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false })
    .then(() => queryInterface.addColumn('Users', 'messagingBannedAt', { type: Sequelize.DATE, allowNull: true }))
    .then(() => queryInterface.addColumn('Messages', 'removedAt', { type: Sequelize.DATE, allowNull: true }))
    .then(() => queryInterface.addColumn('Messages', 'removedBy', { type: Sequelize.INTEGER, allowNull: true }))
    .then(() => queryInterface.createTable('ConversationReports', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      conversationId: { allowNull: false, type: Sequelize.INTEGER, references: { model: 'Conversations', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      reporterId: userRef(Sequelize, false, 'CASCADE'),
      reportedUserId: userRef(Sequelize, false, 'CASCADE'),
      reason: { allowNull: false, type: Sequelize.STRING(32) },
      note: { allowNull: true, type: Sequelize.TEXT },
      status: { allowNull: false, type: Sequelize.STRING(16), defaultValue: 'open' },
      action: { allowNull: true, type: Sequelize.STRING(16) },
      reviewerId: userRef(Sequelize, true, 'SET NULL'),
      reviewedAt: { allowNull: true, type: Sequelize.DATE },
      resolutionNote: { allowNull: true, type: Sequelize.TEXT },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    }))
    .then(() => queryInterface.addIndex('ConversationReports', ['conversationId', 'status'], { name: 'conv_reports_conv_status_idx' }))
    .then(() => queryInterface.addIndex('ConversationReports', ['reporterId', 'createdAt'], { name: 'conv_reports_reporter_created_idx' }))
    .then(() => queryInterface.addIndex('ConversationReports', ['conversationId', 'reporterId'], { name: 'conv_reports_one_open_per_user', unique: true, where: { status: 'open' } }))
    .then(() => queryInterface.createTable('ConversationModerationEvents', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      conversationId: { allowNull: false, type: Sequelize.INTEGER, references: { model: 'Conversations', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      reportId: { allowNull: true, type: Sequelize.INTEGER, references: { model: 'ConversationReports', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
      adminId: userRef(Sequelize, true, 'SET NULL'),
      // read | dismiss | warn | ban | unban | remove_message
      type: { allowNull: false, type: Sequelize.STRING(24) },
      targetUserId: { allowNull: true, type: Sequelize.INTEGER },
      messageId: { allowNull: true, type: Sequelize.INTEGER },
      note: { allowNull: true, type: Sequelize.TEXT },
      createdAt: { allowNull: false, type: Sequelize.DATE },
    }))
    .then(() => queryInterface.addIndex('ConversationModerationEvents', ['conversationId', 'createdAt'], { name: 'conv_mod_events_conv_idx' })),
  down: (queryInterface) => queryInterface.dropTable('ConversationModerationEvents')
    .then(() => queryInterface.dropTable('ConversationReports'))
    .then(() => queryInterface.removeColumn('Messages', 'removedBy'))
    .then(() => queryInterface.removeColumn('Messages', 'removedAt'))
    .then(() => queryInterface.removeColumn('Users', 'messagingBannedAt'))
    .then(() => queryInterface.removeColumn('Users', 'messagingBanned')),
};
