'use strict';
// Item lists on a sale: name, optional price and photo, sold mark.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('SaleItems', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      postId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Posts', key: 'id' }, onDelete: 'CASCADE' },
      name: { type: Sequelize.STRING(80), allowNull: false },
      priceCents: { type: Sequelize.INTEGER, allowNull: true },
      photoId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'PostPhotos', key: 'id' }, onDelete: 'SET NULL' },
      sold: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      soldAt: { type: Sequelize.DATE, allowNull: true },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex('SaleItems', ['postId', 'position'], { name: 'sale_items_post_position_idx' });
    await queryInterface.addIndex('SaleItems', ['photoId'], { name: 'sale_items_photo_idx' });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('SaleItems');
  },
};
