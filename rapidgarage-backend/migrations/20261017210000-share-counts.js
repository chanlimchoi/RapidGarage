'use strict';
// Share link previews: aggregate Share button presses per sale and local day
// (seller dashboard "Shares"). Counts only; nothing about who shared or where.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('PostShareDays', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      postId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Posts', key: 'id' }, onDelete: 'CASCADE' },
      // The sale's local date (its time zone).
      day: { type: Sequelize.DATEONLY, allowNull: false },
      count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex('PostShareDays', ['postId', 'day'], { name: 'post_share_days_uniq', unique: true });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('PostShareDays');
  },
};
