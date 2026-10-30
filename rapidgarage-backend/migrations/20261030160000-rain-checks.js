'use strict';
// Rain checks: cached Open-Meteo forecasts and postponement fields on Posts.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WeatherForecasts', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      cellKey: { type: Sequelize.STRING(32), allowNull: false, unique: true },
      days: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      fetchedAt: { type: Sequelize.DATE, allowNull: true },
      failedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addColumn('Posts', 'postponedAt', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('Posts', 'postponedFrom', { type: Sequelize.STRING(10), allowNull: true });
    await queryInterface.addColumn('Posts', 'rainCheckDismissed', { type: Sequelize.STRING(10), allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Posts', 'rainCheckDismissed');
    await queryInterface.removeColumn('Posts', 'postponedFrom');
    await queryInterface.removeColumn('Posts', 'postponedAt');
    await queryInterface.dropTable('WeatherForecasts');
  },
};
