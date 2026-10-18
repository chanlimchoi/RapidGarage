'use strict';
// Following sellers: who follows whom (with an email switch per follow) and
// the outbox of "new sale from someone you follow" emails.
module.exports = {
  up: async (qi, S) => {
    await qi.createTable('Follows', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: S.INTEGER },
      followerId: { type: S.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      sellerId: { type: S.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      notify: { type: S.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { allowNull: false, type: S.DATE },
      updatedAt: { allowNull: false, type: S.DATE },
    });
    await qi.addIndex('Follows', ['followerId', 'sellerId'], { name: 'follows_pair_uniq', unique: true });
    await qi.addIndex('Follows', ['sellerId'], { name: 'follows_seller_idx' });
    await qi.createTable('FollowNotifications', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: S.INTEGER },
      userId: { type: S.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      postId: { type: S.INTEGER, allowNull: false, references: { model: 'Posts', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      followId: { type: S.INTEGER, allowNull: false, references: { model: 'Follows', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      status: { type: S.STRING(16), allowNull: false, defaultValue: 'pending' },
      claimToken: { type: S.STRING(32), allowNull: true },
      attempts: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
      nextAttemptAt: { type: S.DATE, allowNull: true },
      lastError: { type: S.STRING(200), allowNull: true },
      sentAt: { type: S.DATE, allowNull: true },
      digestId: { type: S.INTEGER, allowNull: true },
      createdAt: { allowNull: false, type: S.DATE },
      updatedAt: { allowNull: false, type: S.DATE },
    });
    await qi.addIndex('FollowNotifications', ['userId', 'postId'], { name: 'follow_notifications_user_post_uniq', unique: true });
    await qi.addIndex('FollowNotifications', ['status', 'nextAttemptAt'], { name: 'follow_notifications_status_idx' });
  },
  down: async (qi) => {
    await qi.dropTable('FollowNotifications');
    await qi.dropTable('Follows');
  },
};
