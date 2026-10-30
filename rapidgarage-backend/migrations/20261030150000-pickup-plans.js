'use strict';
// Pickup scheduling: PickupPlans (one per conversation) and pickup event messages.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('PickupPlans', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      conversationId: { type: Sequelize.INTEGER, allowNull: false, unique: true, references: { model: 'Conversations', key: 'id' }, onDelete: 'CASCADE' },
      postId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Posts', key: 'id' }, onDelete: 'CASCADE' },
      sellerId: { type: Sequelize.INTEGER, allowNull: false },
      buyerId: { type: Sequelize.INTEGER, allowNull: false },
      slots: { type: Sequelize.TEXT, allowNull: false, defaultValue: '[]' },
      slotMinutes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 30 },
      timeZone: { type: Sequelize.STRING(64), allowNull: false },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'offered' },
      chosenAt: { type: Sequelize.DATE, allowNull: true },
      updatedBy: { type: Sequelize.INTEGER, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('PickupPlans', ['sellerId', 'status'], { name: 'pickup_plans_seller_status_idx' });
    await queryInterface.addIndex('PickupPlans', ['buyerId', 'status'], { name: 'pickup_plans_buyer_status_idx' });
    await queryInterface.addColumn('Messages', 'pickupId', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('Messages', 'pickupEvent', { type: Sequelize.STRING(16), allowNull: true });
    await queryInterface.addColumn('Messages', 'pickupStart', { type: Sequelize.DATE, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Messages', 'pickupStart');
    await queryInterface.removeColumn('Messages', 'pickupEvent');
    await queryInterface.removeColumn('Messages', 'pickupId');
    await queryInterface.dropTable('PickupPlans');
  },
};
