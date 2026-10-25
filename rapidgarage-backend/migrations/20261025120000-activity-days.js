'use strict';
// Site activity counters (lib/activity.js). Aggregate counts only.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ActivityDays', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      kind: { type: Sequelize.STRING(24), allowNull: false },
      targetType: { type: Sequelize.STRING(12), allowNull: false, defaultValue: '' },
      targetId: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      key: { type: Sequelize.STRING(64), allowNull: false, defaultValue: '' },
      day: { type: Sequelize.DATEONLY, allowNull: false },
      count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex('ActivityDays', ['kind', 'targetType', 'targetId', 'key', 'day'], { name: 'activity_days_uniq', unique: true });
    await queryInterface.addIndex('ActivityDays', ['day'], { name: 'activity_days_day_idx' });
    await queryInterface.addIndex('ActivityDays', ['targetType', 'targetId'], { name: 'activity_days_target_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('ActivityDays');
  },
};
