'use strict';
// Post reports + moderator hiding.
module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.addColumn('Posts', 'hidden', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false })
    .then(() => queryInterface.addColumn('Posts', 'hiddenAt', { type: Sequelize.DATE, allowNull: true }))
    .then(() => queryInterface.addColumn('Posts', 'hiddenBy', { type: Sequelize.INTEGER, allowNull: true }))
    .then(() => queryInterface.addColumn('Posts', 'hiddenSource', { type: Sequelize.STRING(16), allowNull: true }))
    .then(() => queryInterface.addIndex('Posts', ['hidden'], { name: 'posts_hidden_idx' }))
    .then(() => queryInterface.createTable('Reports', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      // No FK: resolved reports outlive deleted posts (postTitle keeps history readable).
      postId: { allowNull: false, type: Sequelize.INTEGER },
      postTitle: { allowNull: true, type: Sequelize.STRING },
      reporterId: { allowNull: false, type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      reason: { allowNull: false, type: Sequelize.STRING(32) },
      note: { allowNull: true, type: Sequelize.TEXT },
      status: { allowNull: false, type: Sequelize.STRING(16), defaultValue: 'open' },
      action: { allowNull: true, type: Sequelize.STRING(16) },
      reviewerId: { allowNull: true, type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
      reviewedAt: { allowNull: true, type: Sequelize.DATE },
      resolutionNote: { allowNull: true, type: Sequelize.TEXT },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    }))
    .then(() => queryInterface.addIndex('Reports', ['postId', 'status'], { name: 'reports_post_status_idx' }))
    .then(() => queryInterface.addIndex('Reports', ['reporterId', 'createdAt'], { name: 'reports_reporter_created_idx' }))
    // One *open* report per user per post (resolved ones don't block a new report).
    .then(() => queryInterface.addIndex('Reports', ['postId', 'reporterId'], { name: 'reports_one_open_per_user', unique: true, where: { status: 'open' } })),
  down: (queryInterface) => queryInterface.dropTable('Reports')
    .then(() => queryInterface.removeIndex('Posts', 'posts_hidden_idx'))
    .then(() => queryInterface.removeColumn('Posts', 'hiddenSource'))
    .then(() => queryInterface.removeColumn('Posts', 'hiddenBy'))
    .then(() => queryInterface.removeColumn('Posts', 'hiddenAt'))
    .then(() => queryInterface.removeColumn('Posts', 'hidden')),
};
