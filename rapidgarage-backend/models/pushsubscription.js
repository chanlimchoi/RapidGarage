'use strict';
// One browser/device that accepted push notifications (lib/push.js). The
// endpoint is the push service URL the browser gave us; p256dh/auth are the
// keys that encrypt each notification so only that browser can read it.
module.exports = (sequelize, DataTypes) => {
  const PushSubscription = sequelize.define('PushSubscription', {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    endpoint: { type: DataTypes.STRING(1024), allowNull: false },
    p256dh: { type: DataTypes.STRING(200), allowNull: false },
    auth: { type: DataTypes.STRING(100), allowNull: false },
    // "Chrome on Android" etc., so people can tell their devices apart.
    label: { type: DataTypes.STRING(120), allowNull: true },
    failures: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastSentAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    indexes: [
      { name: 'push_subscriptions_endpoint_uniq', unique: true, fields: ['endpoint'] },
      { name: 'push_subscriptions_user_idx', fields: ['userId'] },
    ],
  });
  PushSubscription.associate = (models) => {
    PushSubscription.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
  };
  return PushSubscription;
};
