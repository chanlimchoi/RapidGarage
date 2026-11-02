'use strict';
// Offer rules (lib/offerRules.js): per-item auto-accept and floor prices
// (cents) and per-sale defaults as a percentage of each item's asking price.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('SaleItems', 'offerAcceptCents', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('SaleItems', 'offerFloorCents', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('Posts', 'offerAcceptPercent', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('Posts', 'offerFloorPercent', { type: Sequelize.INTEGER, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Posts', 'offerFloorPercent');
    await queryInterface.removeColumn('Posts', 'offerAcceptPercent');
    await queryInterface.removeColumn('SaleItems', 'offerFloorCents');
    await queryInterface.removeColumn('SaleItems', 'offerAcceptCents');
  },
};
