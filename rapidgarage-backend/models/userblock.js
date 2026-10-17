'use strict';
// blockerId has blocked blockedId: no new messages either way.
module.exports = (sequelize, DataTypes) => {
  const UserBlock = sequelize.define('UserBlock', {
    blockerId: { type: DataTypes.INTEGER, allowNull: false },
    blockedId: { type: DataTypes.INTEGER, allowNull: false },
  }, {
    updatedAt: false,
    indexes: [
      { name: 'user_blocks_pair_uniq', unique: true, fields: ['blockerId', 'blockedId'] },
      { name: 'user_blocks_blocked_idx', fields: ['blockedId'] },
    ],
  });
  UserBlock.associate = (models) => {
    UserBlock.belongsTo(models.User, { as: 'blocker', foreignKey: 'blockerId', onDelete: 'CASCADE' });
    UserBlock.belongsTo(models.User, { as: 'blocked', foreignKey: 'blockedId', onDelete: 'CASCADE' });
  };
  return UserBlock;
};
