'use strict';
// Live "what's left" (lib/whatsLeft.js): when the seller last changed the item list.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Posts', 'itemsUpdatedAt', { type: Sequelize.DATE, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Posts', 'itemsUpdatedAt');
  },
};
