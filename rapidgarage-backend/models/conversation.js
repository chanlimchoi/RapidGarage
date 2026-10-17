'use strict';
// One conversation per (post, buyer, seller). postId has no FK so the thread
// stays readable after the post is deleted (postTitle keeps a snapshot).
module.exports = (sequelize, DataTypes) => {
  const Conversation = sequelize.define('Conversation', {
    postId: { type: DataTypes.INTEGER, allowNull: false },
    postTitle: { type: DataTypes.STRING, allowNull: true },
    buyerId: { type: DataTypes.INTEGER, allowNull: false },
    sellerId: { type: DataTypes.INTEGER, allowNull: false },
    lastMessageAt: { type: DataTypes.DATE, allowNull: true },
    buyerLastReadAt: { type: DataTypes.DATE, allowNull: true },
    sellerLastReadAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    indexes: [
      { name: 'conversations_post_buyer_seller_uniq', unique: true, fields: ['postId', 'buyerId', 'sellerId'] },
      { name: 'conversations_buyer_idx', fields: ['buyerId', 'lastMessageAt'] },
      { name: 'conversations_seller_idx', fields: ['sellerId', 'lastMessageAt'] },
    ],
  });
  Conversation.associate = (models) => {
    Conversation.belongsTo(models.User, { as: 'buyer', foreignKey: 'buyerId', onDelete: 'CASCADE' });
    Conversation.belongsTo(models.User, { as: 'seller', foreignKey: 'sellerId', onDelete: 'CASCADE' });
    Conversation.hasMany(models.Message, { as: 'messages', foreignKey: 'conversationId', onDelete: 'CASCADE' });
  };
  Conversation.prototype.isParticipant = function(userId) {
    return userId === this.buyerId || userId === this.sellerId;
  };
  Conversation.prototype.otherId = function(userId) {
    return userId === this.buyerId ? this.sellerId : this.buyerId;
  };
  Conversation.prototype.lastReadField = function(userId) {
    return userId === this.buyerId ? 'buyerLastReadAt' : 'sellerLastReadAt';
  };
  return Conversation;
};
