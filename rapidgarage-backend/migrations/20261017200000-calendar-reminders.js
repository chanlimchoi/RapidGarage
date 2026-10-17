'use strict';
// Add-to-calendar (.ics SEQUENCE + day history for cancellations) and
// morning-of reminders for saved sales (per-save opt-in, a default in
// settings, and a once-per-sale-day outbox the worker claims).
module.exports = {
  up: async (qi, S) => {
    for (const t of ['Posts', 'SaleEvents']) {
      await qi.addColumn(t, 'calendarSeq', { type: S.INTEGER, allowNull: false, defaultValue: 0 });
      await qi.addColumn(t, 'calendarDates', { type: S.TEXT, allowNull: true });
    }
    await qi.addColumn('Users', 'remindSaved', { type: S.BOOLEAN, allowNull: false, defaultValue: false });
    await qi.addColumn('SavedPosts', 'remind', { type: S.BOOLEAN, allowNull: false, defaultValue: false });
    await qi.addIndex('SavedPosts', ['remind', 'postId'], { name: 'saved_posts_remind_idx' });
    await qi.createTable('SaleReminders', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: S.INTEGER },
      userId: { type: S.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      postId: { type: S.INTEGER, allowNull: false, references: { model: 'Posts', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      date: { type: S.STRING(10), allowNull: false },
      startsAt: { type: S.DATE, allowNull: false },
      endsAt: { type: S.DATE, allowNull: false },
      status: { type: S.STRING(16), allowNull: false, defaultValue: 'pending' },
      claimToken: { type: S.STRING(32), allowNull: true },
      attempts: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
      nextAttemptAt: { type: S.DATE, allowNull: true },
      lastError: { type: S.STRING(200), allowNull: true },
      sentAt: { type: S.DATE, allowNull: true },
      noticeAt: { type: S.DATE, allowNull: true },
      seenAt: { type: S.DATE, allowNull: true },
      createdAt: { allowNull: false, type: S.DATE },
      updatedAt: { allowNull: false, type: S.DATE },
    });
    await qi.addIndex('SaleReminders', ['userId', 'postId', 'date'], { name: 'sale_reminders_user_post_date_uniq', unique: true });
    await qi.addIndex('SaleReminders', ['status', 'nextAttemptAt'], { name: 'sale_reminders_status_idx' });
    await qi.addIndex('SaleReminders', ['userId', 'endsAt'], { name: 'sale_reminders_user_ends_idx' });
  },
  down: async (qi) => {
    await qi.dropTable('SaleReminders');
    await qi.removeIndex('SavedPosts', 'saved_posts_remind_idx');
    await qi.removeColumn('SavedPosts', 'remind');
    await qi.removeColumn('Users', 'remindSaved');
    for (const t of ['Posts', 'SaleEvents']) {
      await qi.removeColumn(t, 'calendarSeq');
      await qi.removeColumn(t, 'calendarDates');
    }
  },
};
