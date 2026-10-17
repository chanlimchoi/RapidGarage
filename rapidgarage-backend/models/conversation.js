'use strict';
// One conversation per (post, buyer, seller), or per (wanted post, buyer,
// seller) when a seller answers a buyer's wanted post (postId null; the buyer
// is the wanted post's author). postId/wantedId have no FK so the thread stays
// readable after the post is deleted (postTitle keeps a snapshot).
module.exports = (sequelize, DataTypes) => {
  const Conversation = sequelize.define('Conversation', {
    postId: { type: DataTypes.INTEGER, allowNull: true },
    wantedId: { type: DataTypes.INTEGER, allowNull: true },
    postTitle: { type: DataTypes.STRING, allowNull: true },
    buyerId: { type: DataTypes.INTEGER, allowNull: false },
    sellerId: { type: DataTypes.INTEGER, allowNull: false },
    lastMessageAt: { type: DataTypes.DATE, allowNull: true },
    buyerLastReadAt: { type: DataTypes.DATE, allowNull: true },
    sellerLastReadAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    indexes: [
      { name: 'conversations_post_buyer_seller_uniq', unique: true, fields: ['postId', 'buyerId', 'sellerId'] },
      { name: 'conversations_wanted_buyer_seller_uniq', unique: true, fields: ['wantedId', 'buyerId', 'sellerId'] },
      { name: 'conversations_buyer_idx', fields: ['buyerId', 'lastMessageAt'] },
      { name: 'conversations_seller_idx', fields: ['sellerId', 'lastMessageAt'] },
    ],
  });
  Conversation.associate = (models) => {
    Conversation.belongsTo(models.User, { as: 'buyer', foreignKey: 'buyerId', onDelete: 'CASCADE' });
    Conversation.belongsTo(models.User, { as: 'seller', foreignKey: 'sellerId', onDelete: 'CASCADE' });
    Conversation.hasMany(models.Message, { as: 'messages', foreignKey: 'conversationId', onDelete: 'CASCADE' });
    Conversation.hasMany(models.Rating, { as: 'ratings', foreignKey: 'conversationId', onDelete: 'CASCADE' });
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
