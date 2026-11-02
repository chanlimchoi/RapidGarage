'use strict';
// Buyer wish radar (lib/wishRadar.js): a saved search with words counts,
// anonymously, toward the demand sellers nearby see unless its owner turns
// that off.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('SaleAlerts', 'radar', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('SaleAlerts', 'radar');
  },
};
