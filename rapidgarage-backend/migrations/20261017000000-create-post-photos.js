'use strict';
// Photos attached to posts (max 5 per post, enforced in the API).
module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.createTable('PostPhotos', {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
    postId: {
      allowNull: false,
      type: Sequelize.INTEGER,
      references: { model: 'Posts', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    storageKey: { allowNull: false, type: Sequelize.STRING },
    thumbKey: { allowNull: false, type: Sequelize.STRING },
    width: { allowNull: false, type: Sequelize.INTEGER },
    height: { allowNull: false, type: Sequelize.INTEGER },
    position: { allowNull: false, type: Sequelize.INTEGER, defaultValue: 0 },
    createdAt: { allowNull: false, type: Sequelize.DATE },
    updatedAt: { allowNull: false, type: Sequelize.DATE },
  }).then(() => queryInterface.addIndex('PostPhotos', ['postId'])),
  down: (queryInterface) => queryInterface.dropTable('PostPhotos'),
};
