'use strict';
// Sale dates & times: one row per sale day, in the sale's time zone.
module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.addColumn('Posts', 'timeZone', { type: Sequelize.STRING(64), allowNull: true })
    .then(() => queryInterface.createTable('SaleDays', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      postId: { allowNull: false, type: Sequelize.INTEGER, references: { model: 'Posts', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      // Local calendar date and wall-clock times in Posts.timeZone ...
      date: { allowNull: false, type: Sequelize.STRING(10) },
      startTime: { allowNull: false, type: Sequelize.STRING(5) },
      endTime: { allowNull: false, type: Sequelize.STRING(5) },
      // ... and the same window as UTC instants (computed on save).
      startsAt: { allowNull: false, type: Sequelize.DATE },
      endsAt: { allowNull: false, type: Sequelize.DATE },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    }))
    .then(() => queryInterface.addIndex('SaleDays', ['postId', 'date'], { name: 'sale_days_post_date_uniq', unique: true }))
    .then(() => queryInterface.addIndex('SaleDays', ['endsAt'], { name: 'sale_days_ends_idx' }))
    .then(() => queryInterface.addIndex('Posts', ['endDate'], { name: 'posts_end_date_idx' })),
  down: (queryInterface) => queryInterface.removeIndex('Posts', 'posts_end_date_idx')
    .then(() => queryInterface.dropTable('SaleDays'))
    .then(() => queryInterface.removeColumn('Posts', 'timeZone')),
};
