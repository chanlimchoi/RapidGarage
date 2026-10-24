'use strict';
// Bundle deals (lib/bundles.js): the seller's "N+ items, X% off" rule on a
// sale, and the key that ties together the holds a buyer asked for as a bundle.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Posts', 'bundleMinItems', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('Posts', 'bundlePercent', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('ItemHolds', 'bundleKey', { type: Sequelize.STRING(24), allowNull: true });
    await queryInterface.addIndex('ItemHolds', ['bundleKey'], { name: 'item_holds_bundle_idx' });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('ItemHolds', 'item_holds_bundle_idx');
    await queryInterface.removeColumn('ItemHolds', 'bundleKey');
    await queryInterface.removeColumn('Posts', 'bundlePercent');
    await queryInterface.removeColumn('Posts', 'bundleMinItems');
  },
};
