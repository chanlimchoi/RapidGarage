'use strict';
// Outbox row: "tell userId about postId" (one per user and post).
module.exports = (sequelize, DataTypes) => {
  const AlertNotification = sequelize.define('AlertNotification', {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    alertId: { type: DataTypes.INTEGER, allowNull: false },
    postId: { type: DataTypes.INTEGER, allowNull: false },
    distanceMiles: { type: DataTypes.FLOAT, allowNull: true },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    nextAttemptAt: { type: DataTypes.DATE, allowNull: true },
    claimToken: { type: DataTypes.STRING(40), allowNull: true },
    lastError: { type: DataTypes.STRING(200), allowNull: true },
    sentAt: { type: DataTypes.DATE, allowNull: true },
    digestId: { type: DataTypes.INTEGER, allowNull: true },
  }, {
    indexes: [
      { name: 'alert_notifications_user_post_uniq', unique: true, fields: ['userId', 'postId'] },
      { name: 'alert_notifications_status_idx', fields: ['status', 'nextAttemptAt'] },
    ],
  });
  AlertNotification.associate = (models) => {
    AlertNotification.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
    AlertNotification.belongsTo(models.SaleAlert, { foreignKey: 'alertId', onDelete: 'CASCADE' });
  };
  return AlertNotification;
};
