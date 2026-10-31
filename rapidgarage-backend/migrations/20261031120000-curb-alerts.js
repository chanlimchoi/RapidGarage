'use strict';
// Free-stuff curb posts and alerts (lib/curbAlerts.js).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('CurbAlerts', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      userId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      lat: { type: Sequelize.DOUBLE, allowNull: false },
      lng: { type: Sequelize.DOUBLE, allowNull: false },
      radiusMiles: { type: Sequelize.DOUBLE, allowNull: false },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('CurbAlerts', ['userId'], { name: 'curb_alerts_user_uniq', unique: true });
    await queryInterface.addIndex('CurbAlerts', ['enabled', 'lat'], { name: 'curb_alerts_enabled_lat_idx' });
    // A quick "free at the curb" post (not a sale): auto-expires, listed only while its offer runs.
    await queryInterface.addColumn('Posts', 'quickCurb', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Posts', 'quickCurb');
    await queryInterface.dropTable('CurbAlerts');
  },
};
