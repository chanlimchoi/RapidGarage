'use strict';
// One item on a sale's list (see controllers/items.js).
module.exports = (sequelize, DataTypes) => {
  const SaleItem = sequelize.define('SaleItem', {
    postId: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    priceCents: { type: DataTypes.INTEGER, allowNull: true },
    photoId: { type: DataTypes.INTEGER, allowNull: true },
    sold: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    soldAt: { type: DataTypes.DATE, allowNull: true },
    position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // Until when an accepted hold sets it aside (lib/holds.js); "Reserved" while in the future.
    reservedUntil: { type: DataTypes.DATE, allowNull: true },
  }, {
    indexes: [
      { name: 'sale_items_post_position_idx', fields: ['postId', 'position'] },
      { name: 'sale_items_photo_idx', fields: ['photoId'] },
    ],
  });
  SaleItem.associate = (models) => {
    SaleItem.belongsTo(models.Post, { foreignKey: 'postId', onDelete: 'CASCADE' });
    SaleItem.belongsTo(models.PostPhoto, { foreignKey: 'photoId', as: 'photo', onDelete: 'SET NULL', constraints: true });
  };
  SaleItem.prototype.toJSON = function toJSON() {
    const v = this.get({ plain: true });
    // Public: only that it is reserved (and until when), never by whom.
    const reserved = !v.sold && !!v.reservedUntil && new Date(v.reservedUntil) > require('../lib/schedule').now();
    return { id: v.id, name: v.name, priceCents: v.priceCents, photoId: v.photoId, sold: !!v.sold, soldAt: v.soldAt, position: v.position, reserved, reservedUntil: reserved ? v.reservedUntil : null };
  };
  return SaleItem;
};
