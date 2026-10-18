'use strict';
// Accessibility: a seller-written description (alt text) for each sale photo.
// Empty means the app uses "<sale title>, photo n of m".
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('PostPhotos', 'alt', { type: Sequelize.STRING(250), allowNull: true });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('PostPhotos', 'alt');
  },
};
