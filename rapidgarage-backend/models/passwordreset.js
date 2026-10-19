'use strict';
// One forgot-password link (lib/passwordReset.js). The token itself is only
// ever in the email; this row keeps its SHA-256.
module.exports = (sequelize, DataTypes) => {
  const PasswordReset = sequelize.define('PasswordReset', {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    tokenHash: { type: DataTypes.STRING(64), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    usedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    indexes: [
      { name: 'password_resets_token_uniq', unique: true, fields: ['tokenHash'] },
      { name: 'password_resets_user_created_idx', fields: ['userId', 'createdAt'] },
    ],
  });
  PasswordReset.associate = (models) => {
    PasswordReset.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
  };
  return PasswordReset;
};
