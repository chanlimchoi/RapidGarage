'use strict';
// Multi-language listings (lib/translate.js): the language a sale is written
// in, and a cache of machine translations keyed by a hash of
// (source, target, text) so edits simply miss the cache.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Posts', 'language', { type: Sequelize.STRING(10), allowNull: true });
    await queryInterface.createTable('Translations', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      hash: { type: Sequelize.STRING(64), allowNull: false },
      source: { type: Sequelize.STRING(10), allowNull: false },
      target: { type: Sequelize.STRING(10), allowNull: false },
      text: { type: Sequelize.TEXT, allowNull: false },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex('Translations', ['hash'], { unique: true, name: 'translations_hash_uniq' });
    await queryInterface.addIndex('Translations', ['createdAt'], { name: 'translations_created_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('Translations');
    await queryInterface.removeColumn('Posts', 'language');
  },
};
