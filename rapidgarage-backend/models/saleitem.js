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
    return { id: v.id, name: v.name, priceCents: v.priceCents, photoId: v.photoId, sold: !!v.sold, soldAt: v.soldAt, position: v.position };
  };
  return SaleItem;
};
