'use strict';
// Web Push (lib/push.js): one row per subscribed browser/device, and what
// each person wants to be notified about.
module.exports = {
  up: async (qi, S) => {
    await qi.createTable('PushSubscriptions', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: S.INTEGER },
      userId: { type: S.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      endpoint: { type: S.STRING(1024), allowNull: false },
      p256dh: { type: S.STRING(200), allowNull: false },
      auth: { type: S.STRING(100), allowNull: false },
      label: { type: S.STRING(120), allowNull: true },
      failures: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
      lastSentAt: { type: S.DATE, allowNull: true },
      createdAt: { allowNull: false, type: S.DATE },
      updatedAt: { allowNull: false, type: S.DATE },
    });
    await qi.addIndex('PushSubscriptions', ['endpoint'], { name: 'push_subscriptions_endpoint_uniq', unique: true });
    await qi.addIndex('PushSubscriptions', ['userId'], { name: 'push_subscriptions_user_idx' });
    await qi.addColumn('Users', 'pushMessages', { type: S.BOOLEAN, allowNull: false, defaultValue: true });
    await qi.addColumn('Users', 'pushFollows', { type: S.BOOLEAN, allowNull: false, defaultValue: true });
    await qi.addColumn('Users', 'pushReminders', { type: S.BOOLEAN, allowNull: false, defaultValue: true });
  },
  down: async (qi) => {
    await qi.removeColumn('Users', 'pushReminders');
    await qi.removeColumn('Users', 'pushFollows');
    await qi.removeColumn('Users', 'pushMessages');
    await qi.dropTable('PushSubscriptions');
  },
};
