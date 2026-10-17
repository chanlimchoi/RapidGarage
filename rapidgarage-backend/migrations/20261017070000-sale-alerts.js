'use strict';
// Saved sale alerts + a DB-backed outbox for alert emails.
module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.createTable('SaleAlerts', {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
    userId: { allowNull: false, type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
    label: { allowNull: true, type: Sequelize.STRING(80) },
    lat: { allowNull: false, type: Sequelize.DOUBLE },
    lng: { allowNull: false, type: Sequelize.DOUBLE },
    radiusMiles: { allowNull: false, type: Sequelize.INTEGER },
    maxPrice: { allowNull: true, type: Sequelize.INTEGER },
    freeOnly: { allowNull: false, type: Sequelize.BOOLEAN, defaultValue: false },
    enabled: { allowNull: false, type: Sequelize.BOOLEAN, defaultValue: true },
    createdAt: { allowNull: false, type: Sequelize.DATE },
    updatedAt: { allowNull: false, type: Sequelize.DATE },
  })
    .then(() => queryInterface.addIndex('SaleAlerts', ['userId'], { name: 'sale_alerts_user_idx' }))
    .then(() => queryInterface.addIndex('SaleAlerts', ['enabled', 'lat'], { name: 'sale_alerts_enabled_lat_idx' }))
    .then(() => queryInterface.createTable('AlertNotifications', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      userId: { allowNull: false, type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      alertId: { allowNull: false, type: Sequelize.INTEGER, references: { model: 'SaleAlerts', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      // No FK: a deleted post just gets skipped at send time.
      postId: { allowNull: false, type: Sequelize.INTEGER },
      distanceMiles: { allowNull: true, type: Sequelize.FLOAT },
      // pending | sending | sent | skipped | failed
      status: { allowNull: false, type: Sequelize.STRING(16), defaultValue: 'pending' },
      attempts: { allowNull: false, type: Sequelize.INTEGER, defaultValue: 0 },
      nextAttemptAt: { allowNull: true, type: Sequelize.DATE },
      claimToken: { allowNull: true, type: Sequelize.STRING(40) },
      lastError: { allowNull: true, type: Sequelize.STRING(200) },
      sentAt: { allowNull: true, type: Sequelize.DATE },
      digestId: { allowNull: true, type: Sequelize.INTEGER },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    }))
    .then(() => queryInterface.addIndex('AlertNotifications', ['userId', 'postId'], { name: 'alert_notifications_user_post_uniq', unique: true }))
    .then(() => queryInterface.addIndex('AlertNotifications', ['status', 'nextAttemptAt'], { name: 'alert_notifications_status_idx' }))
    .then(() => queryInterface.createTable('AlertDigests', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      userId: { allowNull: false, type: Sequelize.INTEGER, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      postCount: { allowNull: false, type: Sequelize.INTEGER },
      sentAt: { allowNull: false, type: Sequelize.DATE },
      createdAt: { allowNull: false, type: Sequelize.DATE },
    }))
    .then(() => queryInterface.addIndex('AlertDigests', ['userId', 'sentAt'], { name: 'alert_digests_user_sent_idx' })),
  down: (queryInterface) => queryInterface.dropTable('AlertDigests')
    .then(() => queryInterface.dropTable('AlertNotifications'))
    .then(() => queryInterface.dropTable('SaleAlerts')),
};
