'use strict';
// Outbox row: email `userId` about `postId`, a new sale by someone they follow.
// Claimed and sent by the alert worker (lib/follows.js processQueue).
module.exports = (sequelize, DataTypes) => {
  const FollowNotification = sequelize.define('FollowNotification', {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    postId: { type: DataTypes.INTEGER, allowNull: false },
    followId: { type: DataTypes.INTEGER, allowNull: false },
    // pending | sending | sent | skipped | failed
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
    claimToken: { type: DataTypes.STRING(32), allowNull: true },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    nextAttemptAt: { type: DataTypes.DATE, allowNull: true },
    lastError: { type: DataTypes.STRING(200), allowNull: true },
    sentAt: { type: DataTypes.DATE, allowNull: true },
    digestId: { type: DataTypes.INTEGER, allowNull: true },
  }, {
    indexes: [
      { name: 'follow_notifications_user_post_uniq', unique: true, fields: ['userId', 'postId'] },
      { name: 'follow_notifications_status_idx', fields: ['status', 'nextAttemptAt'] },
    ],
  });
  FollowNotification.associate = (models) => {
    FollowNotification.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
    FollowNotification.belongsTo(models.Post, { foreignKey: 'postId', onDelete: 'CASCADE' });
    FollowNotification.belongsTo(models.Follow, { foreignKey: 'followId', onDelete: 'CASCADE' });
  };
  return FollowNotification;
};
