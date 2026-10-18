'use strict';
// Forgot-password links (only a SHA-256 of each token is stored) and a
// per-user counter that signs out every other session when it changes.
module.exports = {
  up: async (qi, S) => {
    await qi.addColumn('Users', 'authVersion', { type: S.INTEGER, allowNull: false, defaultValue: 0 });
    await qi.createTable('PasswordResets', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: S.INTEGER },
      userId: { type: S.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      tokenHash: { type: S.STRING(64), allowNull: false },
      expiresAt: { type: S.DATE, allowNull: false },
      usedAt: { type: S.DATE, allowNull: true },
      createdAt: { allowNull: false, type: S.DATE },
      updatedAt: { allowNull: false, type: S.DATE },
    });
    await qi.addIndex('PasswordResets', ['tokenHash'], { name: 'password_resets_token_uniq', unique: true });
    await qi.addIndex('PasswordResets', ['userId', 'createdAt'], { name: 'password_resets_user_created_idx' });
  },
  down: async (qi) => {
    await qi.dropTable('PasswordResets');
    await qi.removeColumn('Users', 'authVersion');
  },
};
