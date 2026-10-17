'use strict';
// One row per alert email actually sent (drives the digest interval and daily cap).
module.exports = (sequelize, DataTypes) => {
  const AlertDigest = sequelize.define('AlertDigest', {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    postCount: { type: DataTypes.INTEGER, allowNull: false },
    sentAt: { type: DataTypes.DATE, allowNull: false },
  }, {
    updatedAt: false,
    indexes: [{ name: 'alert_digests_user_sent_idx', fields: ['userId', 'sentAt'] }],
  });
  AlertDigest.associate = (models) => {
    AlertDigest.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
  };
  return AlertDigest;
};
