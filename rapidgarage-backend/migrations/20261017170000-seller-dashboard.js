'use strict';
// Seller dashboard: page views of a sale per local day (counted like QR scans:
// a number per day, nothing about the visitor; see lib/scans.js, kind 'view').
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('PostViewDays', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      postId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Posts', key: 'id' }, onDelete: 'CASCADE' },
      // The sale's local date (its time zone).
      day: { type: Sequelize.DATEONLY, allowNull: false },
      count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex('PostViewDays', ['postId', 'day'], { name: 'post_view_days_uniq', unique: true });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('PostViewDays');
  },
};
