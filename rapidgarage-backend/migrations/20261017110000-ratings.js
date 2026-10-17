'use strict';
// Ratings after a conversation (one per participant per conversation) and
// reports about ratings.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Ratings', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      conversationId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Conversations', key: 'id' }, onDelete: 'CASCADE' },
      raterId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      rateeId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      // The rater's role in the conversation: buyer | seller.
      raterRole: { type: Sequelize.STRING(8), allowNull: false },
      stars: { type: Sequelize.INTEGER, allowNull: false },
      comment: { type: Sequelize.STRING(280), allowNull: true },
      commentRemovedAt: { type: Sequelize.DATE, allowNull: true },
      commentRemovedBy: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL' },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex('Ratings', ['conversationId', 'raterId'], { name: 'ratings_conv_rater_uniq', unique: true });
    await queryInterface.addIndex('Ratings', ['rateeId', 'createdAt'], { name: 'ratings_ratee_idx' });
    await queryInterface.createTable('RatingReports', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      ratingId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Ratings', key: 'id' }, onDelete: 'CASCADE' },
      reporterId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      reason: { type: Sequelize.STRING(32), allowNull: false },
      note: { type: Sequelize.TEXT, allowNull: true },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'open' },
      // dismissed | comment_removed | rating_removed
      action: { type: Sequelize.STRING(20), allowNull: true },
      reviewerId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL' },
      reviewedAt: { type: Sequelize.DATE, allowNull: true },
      resolutionNote: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex('RatingReports', ['ratingId', 'status'], { name: 'rating_reports_rating_status_idx' });
    await queryInterface.addIndex('RatingReports', ['reporterId', 'createdAt'], { name: 'rating_reports_reporter_created_idx' });
    await queryInterface.addIndex('RatingReports', ['ratingId', 'reporterId'], { name: 'rating_reports_one_open_per_user', unique: true, where: { status: 'open' } });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('RatingReports');
    await queryInterface.dropTable('Ratings');
  },
};
