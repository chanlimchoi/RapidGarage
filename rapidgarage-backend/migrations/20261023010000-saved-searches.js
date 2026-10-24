'use strict';
// Saved searches: sale alerts gain a keyword query, and matches (plus later
// favorites updates) land in an in-app notification list.
module.exports = {
  up: async (qi, S) => {
    await qi.addColumn('SaleAlerts', 'keyword', { type: S.STRING(100), allowNull: true });
    await qi.createTable('Notifications', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: S.INTEGER },
      userId: { type: S.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      kind: { type: S.STRING(24), allowNull: false },
      postId: { type: S.INTEGER, allowNull: true, references: { model: 'Posts', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      alertId: { type: S.INTEGER, allowNull: true, references: { model: 'SaleAlerts', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' },
      dedupeKey: { type: S.STRING(80), allowNull: false },
      data: { type: S.TEXT, allowNull: true },
      seenAt: { type: S.DATE, allowNull: true },
      createdAt: { allowNull: false, type: S.DATE },
      updatedAt: { allowNull: false, type: S.DATE },
    });
    await qi.addIndex('Notifications', ['userId', 'dedupeKey'], { name: 'notifications_user_dedupe_uniq', unique: true });
    await qi.addIndex('Notifications', ['userId', 'seenAt'], { name: 'notifications_user_seen_idx' });
  },
  down: async (qi) => {
    await qi.dropTable('Notifications');
    await qi.removeColumn('SaleAlerts', 'keyword');
  },
};
