'use strict';
// A sale's leftovers offered as one donation lot (lib/donations.js).
const STATUSES = ['open', 'claimed', 'done', 'cancelled'];
module.exports = (sequelize, DataTypes) => {
  const DonationLot = sequelize.define('DonationLot', {
    postId: { type: DataTypes.INTEGER, allowNull: false, unique: 'donation_lots_post_uniq' },
    sellerId: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'open', validate: { isIn: [STATUSES] } },
    // JSON array of SaleItem ids in the lot.
    itemIds: { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' },
    note: { type: DataTypes.STRING(300), allowNull: true },
    // JSON array of ISO pickup start times (as PickupPlan.slots).
    slots: { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' },
    slotMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
    timeZone: { type: DataTypes.STRING(64), allowNull: false },
    // Copied from the sale for the nearby search.
    lat: { type: DataTypes.DOUBLE, allowNull: true },
    lng: { type: DataTypes.DOUBLE, allowNull: true },
    claimerId: { type: DataTypes.INTEGER, allowNull: true },
    // Optional: the organization the claimer picks up for ("Food bank", "Church thrift").
    claimOrg: { type: DataTypes.STRING(80), allowNull: true },
    chosenAt: { type: DataTypes.DATE, allowNull: true },
    claimedAt: { type: DataTypes.DATE, allowNull: true },
    // The claimer's conversation with the seller about the sale.
    conversationId: { type: DataTypes.INTEGER, allowNull: true },
    doneAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    indexes: [
      { name: 'donation_lots_status_lat_idx', fields: ['status', 'lat'] },
      { name: 'donation_lots_claimer_idx', fields: ['claimerId', 'status'] },
    ],
  });
  DonationLot.associate = (models) => {
    DonationLot.belongsTo(models.Post, { foreignKey: 'postId', onDelete: 'CASCADE' });
  };
  const list = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  DonationLot.prototype.slotList = function slotList() { return list(this.slots); };
  DonationLot.prototype.itemIdList = function itemIdList() { return list(this.itemIds); };
  DonationLot.STATUSES = STATUSES;
  return DonationLot;
};
