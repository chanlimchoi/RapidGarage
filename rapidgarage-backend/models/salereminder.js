'use strict';
// A morning-of reminder for one saved sale on one of its days (lib/reminders.js).
// The unique (user, post, date) index is the once-per-sale-day dedupe, also
// across several app instances; status/claimToken is the worker's claim.
// status: pending | sending | sent | skipped | failed. The in-app notice is
// independent of email: noticeAt is set when the reminder becomes due.
module.exports = (sequelize, DataTypes) => {
  const SaleReminder = sequelize.define('SaleReminder', {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    postId: { type: DataTypes.INTEGER, allowNull: false },
    date: { type: DataTypes.STRING(10), allowNull: false },
    startsAt: { type: DataTypes.DATE, allowNull: false },
    endsAt: { type: DataTypes.DATE, allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
    claimToken: { type: DataTypes.STRING(32), allowNull: true },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    nextAttemptAt: { type: DataTypes.DATE, allowNull: true },
    lastError: { type: DataTypes.STRING(200), allowNull: true },
    sentAt: { type: DataTypes.DATE, allowNull: true },
    noticeAt: { type: DataTypes.DATE, allowNull: true },
    seenAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    indexes: [
      { name: 'sale_reminders_user_post_date_uniq', unique: true, fields: ['userId', 'postId', 'date'] },
      { name: 'sale_reminders_status_idx', fields: ['status', 'nextAttemptAt'] },
      { name: 'sale_reminders_user_ends_idx', fields: ['userId', 'endsAt'] },
    ],
  });
  SaleReminder.associate = (models) => {
    SaleReminder.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
    SaleReminder.belongsTo(models.Post, { foreignKey: 'postId', as: 'post', onDelete: 'CASCADE' });
  };
  return SaleReminder;
};
