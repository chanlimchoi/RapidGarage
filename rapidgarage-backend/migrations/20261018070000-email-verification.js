'use strict';
// Email verification (lib/emailVerify.js). Accounts that exist before this
// migration count as verified, so nobody is locked out by the upgrade.
module.exports = {
  up: async (qi, S) => {
    await qi.addColumn('Users', 'emailVerifiedAt', { type: S.DATE, allowNull: true });
    await qi.sequelize.query('UPDATE "Users" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL');
    await qi.createTable('EmailVerifications', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: S.INTEGER },
      userId: { type: S.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      tokenHash: { type: S.STRING(64), allowNull: false },
      expiresAt: { type: S.DATE, allowNull: false },
      usedAt: { type: S.DATE, allowNull: true },
      createdAt: { allowNull: false, type: S.DATE },
      updatedAt: { allowNull: false, type: S.DATE },
    });
    await qi.addIndex('EmailVerifications', ['tokenHash'], { name: 'email_verifications_token_uniq', unique: true });
    await qi.addIndex('EmailVerifications', ['userId'], { name: 'email_verifications_user_idx' });
  },
  down: async (qi) => {
    await qi.dropTable('EmailVerifications');
    await qi.removeColumn('Users', 'emailVerifiedAt');
  },
};
