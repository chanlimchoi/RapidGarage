'use strict';
// One "confirm your email" link (lib/emailVerify.js); only the token's SHA-256 is kept.
module.exports = (sequelize, DataTypes) => {
  const EmailVerification = sequelize.define('EmailVerification', {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    tokenHash: { type: DataTypes.STRING(64), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    usedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    indexes: [
      { name: 'email_verifications_token_uniq', unique: true, fields: ['tokenHash'] },
      { name: 'email_verifications_user_idx', fields: ['userId'] },
    ],
  });
  EmailVerification.associate = (models) => {
    EmailVerification.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
  };
  return EmailVerification;
};
