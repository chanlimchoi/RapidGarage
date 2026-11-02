'use strict';
// One to-do on a seller's sale-day checklist (lib/checklist.js). Default items
// have a key (label translated by the apps); the seller's own have a label.
module.exports = (sequelize, DataTypes) => {
  const SaleChecklistItem = sequelize.define('SaleChecklistItem', {
    postId: { type: DataTypes.INTEGER, allowNull: false },
    key: { type: DataTypes.STRING(24), allowNull: true },
    label: { type: DataTypes.STRING(120), allowNull: true },
    // Days before the sale's first day it is due (0 = the sale day).
    dueDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    doneAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    indexes: [
      { name: 'sale_checklist_post_position_idx', fields: ['postId', 'position'] },
      { name: 'sale_checklist_open_idx', fields: ['doneAt', 'postId'] },
    ],
  });
  SaleChecklistItem.associate = (models) => {
    SaleChecklistItem.belongsTo(models.Post, { foreignKey: 'postId', onDelete: 'CASCADE' });
  };
  SaleChecklistItem.prototype.toJSON = function toJSON() {
    const v = this.get();
    return { id: v.id, key: v.key || null, label: v.label || null, dueDays: v.dueDays, position: v.position, done: !!v.doneAt, doneAt: v.doneAt || null };
  };
  return SaleChecklistItem;
};
