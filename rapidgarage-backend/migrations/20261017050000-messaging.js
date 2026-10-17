'use strict';
// Buyer-seller messaging: conversations, messages and user blocks.
const ts = (Sequelize) => ({ allowNull: false, type: Sequelize.DATE });
const userRef = (Sequelize) => ({ allowNull: false, type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });

module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.createTable('Conversations', {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
    // No FK: the conversation outlives a deleted post.
    postId: { allowNull: false, type: Sequelize.INTEGER },
    postTitle: { allowNull: true, type: Sequelize.STRING },
    buyerId: userRef(Sequelize),
    sellerId: userRef(Sequelize),
    lastMessageAt: { allowNull: true, type: Sequelize.DATE },
    buyerLastReadAt: { allowNull: true, type: Sequelize.DATE },
    sellerLastReadAt: { allowNull: true, type: Sequelize.DATE },
    createdAt: ts(Sequelize),
    updatedAt: ts(Sequelize),
  })
    .then(() => queryInterface.addIndex('Conversations', ['postId', 'buyerId', 'sellerId'], { name: 'conversations_post_buyer_seller_uniq', unique: true }))
    .then(() => queryInterface.addIndex('Conversations', ['buyerId', 'lastMessageAt'], { name: 'conversations_buyer_idx' }))
    .then(() => queryInterface.addIndex('Conversations', ['sellerId', 'lastMessageAt'], { name: 'conversations_seller_idx' }))
    .then(() => queryInterface.createTable('Messages', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      conversationId: { allowNull: false, type: Sequelize.INTEGER, references: { model: 'Conversations', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      senderId: userRef(Sequelize),
      body: { allowNull: false, type: Sequelize.TEXT },
      createdAt: ts(Sequelize),
    }))
    .then(() => queryInterface.addIndex('Messages', ['conversationId', 'id'], { name: 'messages_conversation_idx' }))
    .then(() => queryInterface.addIndex('Messages', ['senderId', 'createdAt'], { name: 'messages_sender_created_idx' }))
    .then(() => queryInterface.createTable('UserBlocks', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      blockerId: userRef(Sequelize),
      blockedId: userRef(Sequelize),
      createdAt: ts(Sequelize),
    }))
    .then(() => queryInterface.addIndex('UserBlocks', ['blockerId', 'blockedId'], { name: 'user_blocks_pair_uniq', unique: true }))
    .then(() => queryInterface.addIndex('UserBlocks', ['blockedId'], { name: 'user_blocks_blocked_idx' })),
  down: (queryInterface) => queryInterface.dropTable('UserBlocks')
    .then(() => queryInterface.dropTable('Messages'))
    .then(() => queryInterface.dropTable('Conversations')),
};
