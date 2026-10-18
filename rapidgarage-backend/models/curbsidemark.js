'use strict';
// Someone marked curbside leftovers taken (lib/curbside.js). Kept for the
// per-user rate limit, so the seller can see who and undo it.
module.exports = (sequelize, DataTypes) => {
  const CurbsideMark = sequelize.define('CurbsideMark', {
    postId: { type: DataTypes.INTEGER, allowNull: false },
    itemId: { type: DataTypes.INTEGER, allowNull: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    undoneAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    indexes: [
      { name: 'curbside_marks_user_time_idx', fields: ['userId', 'createdAt'] },
      { name: 'curbside_marks_post_idx', fields: ['postId'] },
    ],
  });
  CurbsideMark.associate = (models) => {
    CurbsideMark.belongsTo(models.Post, { foreignKey: 'postId', onDelete: 'CASCADE' });
    CurbsideMark.belongsTo(models.SaleItem, { foreignKey: 'itemId', as: 'item', onDelete: 'CASCADE' });
    CurbsideMark.belongsTo(models.User, { foreignKey: 'userId', as: 'user', onDelete: 'CASCADE' });
  };
  return CurbsideMark;
};
