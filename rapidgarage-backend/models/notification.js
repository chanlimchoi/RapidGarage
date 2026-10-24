'use strict';
// In-app notification: "something you asked to hear about happened".
// kind: search_match (a saved search matched a new sale). dedupeKey makes
// each event land once per user (e.g. "search:<postId>").
module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define('Notification', {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    kind: { type: DataTypes.STRING(24), allowNull: false },
    postId: { type: DataTypes.INTEGER, allowNull: true },
    alertId: { type: DataTypes.INTEGER, allowNull: true },
    dedupeKey: { type: DataTypes.STRING(80), allowNull: false },
    data: { type: DataTypes.TEXT, allowNull: true },
    seenAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    indexes: [
      { name: 'notifications_user_dedupe_uniq', unique: true, fields: ['userId', 'dedupeKey'] },
      { name: 'notifications_user_seen_idx', fields: ['userId', 'seenAt'] },
    ],
  });
  Notification.associate = (models) => {
    Notification.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
    Notification.belongsTo(models.Post, { foreignKey: 'postId', onDelete: 'CASCADE' });
    Notification.belongsTo(models.SaleAlert, { foreignKey: 'alertId', onDelete: 'SET NULL' });
  };
  return Notification;
};
