'use strict';
// Early-bird access (lib/earlyBird.js): minutes before each sale day's start
// that followers and savers may come. null = off.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Posts', 'earlyMinutes', { type: Sequelize.INTEGER, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Posts', 'earlyMinutes');
  },
};
