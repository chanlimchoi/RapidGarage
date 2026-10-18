'use strict';
// A buyer following a seller (lib/follows.js).
module.exports = (sequelize, DataTypes) => {
  const Follow = sequelize.define('Follow', {
    followerId: { type: DataTypes.INTEGER, allowNull: false },
    sellerId: { type: DataTypes.INTEGER, allowNull: false },
    // Email me about this seller's new sales (the in-app feed shows them either way).
    notify: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, {
    indexes: [
      { name: 'follows_pair_uniq', unique: true, fields: ['followerId', 'sellerId'] },
      { name: 'follows_seller_idx', fields: ['sellerId'] },
    ],
  });
  Follow.associate = (models) => {
    Follow.belongsTo(models.User, { as: 'follower', foreignKey: 'followerId', onDelete: 'CASCADE' });
    Follow.belongsTo(models.User, { as: 'seller', foreignKey: 'sellerId', onDelete: 'CASCADE' });
  };
  return Follow;
};
