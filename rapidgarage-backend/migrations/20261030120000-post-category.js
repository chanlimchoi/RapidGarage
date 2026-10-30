'use strict';
// Photo-to-listing (lib/listingSuggest.js): an optional category on a sale,
// one of lib/wanted.js CATEGORY_KEYS. Used for suggestions from similar sales.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Posts', 'category', { type: Sequelize.STRING(20), allowNull: true });
    await queryInterface.addIndex('Posts', ['category'], { name: 'posts_category_idx' });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('Posts', 'posts_category_idx');
    await queryInterface.removeColumn('Posts', 'category');
  },
};
