'use strict';
// A buyer's request to set one sale item aside (see lib/holds.js).
const STATUSES = ['pending', 'accepted', 'declined', 'cancelled', 'released', 'expired', 'completed'];
module.exports = (sequelize, DataTypes) => {
  const ItemHold = sequelize.define('ItemHold', {
    itemId: { type: DataTypes.INTEGER, allowNull: false },
    postId: { type: DataTypes.INTEGER, allowNull: false },
    conversationId: { type: DataTypes.INTEGER, allowNull: false },
    buyerId: { type: DataTypes.INTEGER, allowNull: false },
    sellerId: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending', validate: { isIn: [STATUSES] } },
    pickupAt: { type: DataTypes.DATE, allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    decidedAt: { type: DataTypes.DATE, allowNull: true },
    // Why it ended without the seller deciding: taken | sold | blocked | sale_ended | timeout
    endedReason: { type: DataTypes.STRING(16), allowNull: true },
  }, {
    indexes: [
      { name: 'item_holds_status_expires_idx', fields: ['status', 'expiresAt'] },
      { name: 'item_holds_item_status_idx', fields: ['itemId', 'status'] },
      { name: 'item_holds_buyer_created_idx', fields: ['buyerId', 'createdAt'] },
      { name: 'item_holds_conversation_idx', fields: ['conversationId'] },
    ],
  });
  ItemHold.associate = (models) => {
    ItemHold.belongsTo(models.SaleItem, { foreignKey: 'itemId', as: 'item', onDelete: 'CASCADE' });
    ItemHold.belongsTo(models.Post, { foreignKey: 'postId', onDelete: 'CASCADE' });
    ItemHold.belongsTo(models.Conversation, { foreignKey: 'conversationId', onDelete: 'CASCADE' });
    ItemHold.belongsTo(models.User, { foreignKey: 'buyerId', as: 'buyer', onDelete: 'CASCADE' });
    ItemHold.belongsTo(models.User, { foreignKey: 'sellerId', as: 'seller', onDelete: 'CASCADE' });
  };
  ItemHold.STATUSES = STATUSES;
  ItemHold.ACTIVE = ['pending', 'accepted'];
  return ItemHold;
};
