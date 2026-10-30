'use strict';
// Web push per-type opt-in for offers and saved-search matches (lib/push.js).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'pushOffers', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
    await queryInterface.addColumn('Users', 'pushSearches', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'pushSearches');
    await queryInterface.removeColumn('Users', 'pushOffers');
  },
};
