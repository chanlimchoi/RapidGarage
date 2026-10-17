'use strict';
// Item holds: a buyer asks the seller to set an item aside (optionally with a
// pickup time). Events are posted into the conversation as messages
// (kind "hold"), so they show in the thread and count as unread.
// SaleItems.reservedUntil mirrors the accepted hold so "Reserved" needs no join.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('ItemHolds', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      itemId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'SaleItems', key: 'id' }, onDelete: 'CASCADE' },
      postId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Posts', key: 'id' }, onDelete: 'CASCADE' },
      conversationId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Conversations', key: 'id' }, onDelete: 'CASCADE' },
      buyerId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      sellerId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      // pending | accepted | declined | cancelled | released | expired | completed
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'pending' },
      pickupAt: { type: Sequelize.DATE, allowNull: true },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      decidedAt: { type: Sequelize.DATE, allowNull: true },
      endedReason: { type: Sequelize.STRING(16), allowNull: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex('ItemHolds', ['status', 'expiresAt'], { name: 'item_holds_status_expires_idx' });
    await queryInterface.addIndex('ItemHolds', ['itemId', 'status'], { name: 'item_holds_item_status_idx' });
    await queryInterface.addIndex('ItemHolds', ['buyerId', 'createdAt'], { name: 'item_holds_buyer_created_idx' });
    await queryInterface.addIndex('ItemHolds', ['conversationId'], { name: 'item_holds_conversation_idx' });
    await queryInterface.addColumn('SaleItems', 'reservedUntil', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('Messages', 'kind', { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'text' });
    await queryInterface.addColumn('Messages', 'holdId', { type: Sequelize.INTEGER, allowNull: true, references: { model: 'ItemHolds', key: 'id' }, onDelete: 'SET NULL' });
    await queryInterface.addColumn('Messages', 'holdEvent', { type: Sequelize.STRING(16), allowNull: true });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('Messages', 'holdEvent');
    await queryInterface.removeColumn('Messages', 'holdId');
    await queryInterface.removeColumn('Messages', 'kind');
    await queryInterface.removeColumn('SaleItems', 'reservedUntil');
    await queryInterface.dropTable('ItemHolds');
  },
};
