'use strict';
// Pickup scheduling (lib/pickups.js): once the seller has accepted a hold or
// offer in a conversation, they offer a few pickup time slots and the buyer
// books one. One plan per conversation; offering new times replaces the old
// ones. Every step posts a Message (kind 'pickup').
const STATUSES = ['offered', 'booked', 'cancelled'];
module.exports = (sequelize, DataTypes) => {
  const PickupPlan = sequelize.define('PickupPlan', {
    conversationId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    postId: { type: DataTypes.INTEGER, allowNull: false },
    sellerId: { type: DataTypes.INTEGER, allowNull: false },
    buyerId: { type: DataTypes.INTEGER, allowNull: false },
    // JSON array of ISO start times, sorted.
    slots: { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' },
    slotMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
    // Zone used for the English summaries stored in Message.body.
    timeZone: { type: DataTypes.STRING(64), allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'offered', validate: { isIn: [STATUSES] } },
    chosenAt: { type: DataTypes.DATE, allowNull: true },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true },
  }, {
    indexes: [
      { name: 'pickup_plans_seller_status_idx', fields: ['sellerId', 'status'] },
      { name: 'pickup_plans_buyer_status_idx', fields: ['buyerId', 'status'] },
    ],
  });
  PickupPlan.associate = (models) => {
    PickupPlan.belongsTo(models.Conversation, { foreignKey: 'conversationId', onDelete: 'CASCADE' });
    PickupPlan.belongsTo(models.Post, { foreignKey: 'postId', onDelete: 'CASCADE' });
  };
  PickupPlan.prototype.slotList = function slotList() {
    try { const v = JSON.parse(this.slots || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  };
  PickupPlan.STATUSES = STATUSES;
  return PickupPlan;
};
