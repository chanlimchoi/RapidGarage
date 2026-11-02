'use strict';
// Sale-day checklist (lib/checklist.js): the seller's to-dos tied to the
// sale's first day, with bell/push reminders on each due day.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('SaleChecklistItems', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      postId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Posts', key: 'id' }, onDelete: 'CASCADE' },
      key: { type: Sequelize.STRING(24), allowNull: true },
      label: { type: Sequelize.STRING(120), allowNull: true },
      dueDays: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      doneAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('SaleChecklistItems', ['postId', 'position'], { name: 'sale_checklist_post_position_idx' });
    await queryInterface.addIndex('SaleChecklistItems', ['doneAt', 'postId'], { name: 'sale_checklist_open_idx' });
    await queryInterface.addColumn('Posts', 'checklistRemind', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Posts', 'checklistRemind');
    await queryInterface.dropTable('SaleChecklistItems');
  },
};
