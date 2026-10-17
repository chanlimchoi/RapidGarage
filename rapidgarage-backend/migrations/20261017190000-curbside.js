'use strict';
// Free on the curb: leftovers (the whole sale or chosen items) offered free
// until a pickup time; neighbors tap "Taken", the seller can undo.
module.exports = {
  up: async (qi, S) => {
    await qi.addColumn('Posts', 'curbsideUntil', { type: S.DATE, allowNull: true });
    await qi.addColumn('Posts', 'curbsideNote', { type: S.STRING(200), allowNull: true });
    await qi.addColumn('Posts', 'curbsideAll', { type: S.BOOLEAN, allowNull: false, defaultValue: false });
    await qi.addColumn('Posts', 'curbsideStartedAt', { type: S.DATE, allowNull: true });
    await qi.addColumn('Posts', 'curbsideGoneAt', { type: S.DATE, allowNull: true });
    await qi.addColumn('Posts', 'curbsideGoneSource', { type: S.STRING(16), allowNull: true });
    await qi.addIndex('Posts', ['curbsideUntil'], { name: 'posts_curbside_until_idx' });
    await qi.addColumn('SaleItems', 'curbside', { type: S.BOOLEAN, allowNull: false, defaultValue: false });
    await qi.addColumn('SaleItems', 'curbsideGoneAt', { type: S.DATE, allowNull: true });
    await qi.addColumn('SaleItems', 'curbsideGoneSource', { type: S.STRING(16), allowNull: true });
    await qi.createTable('CurbsideMarks', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: S.INTEGER },
      postId: { type: S.INTEGER, allowNull: false, references: { model: 'Posts', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      itemId: { type: S.INTEGER, allowNull: true, references: { model: 'SaleItems', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      userId: { type: S.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      undoneAt: { type: S.DATE, allowNull: true },
      createdAt: { allowNull: false, type: S.DATE },
      updatedAt: { allowNull: false, type: S.DATE },
    });
    await qi.addIndex('CurbsideMarks', ['userId', 'createdAt'], { name: 'curbside_marks_user_time_idx' });
    await qi.addIndex('CurbsideMarks', ['postId'], { name: 'curbside_marks_post_idx' });
  },
  down: async (qi) => {
    await qi.dropTable('CurbsideMarks');
    for (const c of ['curbside', 'curbsideGoneAt', 'curbsideGoneSource']) await qi.removeColumn('SaleItems', c);
    await qi.removeIndex('Posts', 'posts_curbside_until_idx');
    for (const c of ['curbsideUntil', 'curbsideNote', 'curbsideAll', 'curbsideStartedAt', 'curbsideGoneAt', 'curbsideGoneSource']) await qi.removeColumn('Posts', c);
  },
};
