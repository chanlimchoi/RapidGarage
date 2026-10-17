'use strict';
// Buyers' saved ("starred") sales. One row per user + post.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('SavedPosts', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      userId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      postId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Posts', key: 'id' }, onDelete: 'CASCADE' },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex('SavedPosts', ['userId', 'postId'], { name: 'saved_posts_user_post_uniq', unique: true });
    await queryInterface.addIndex('SavedPosts', ['postId'], { name: 'saved_posts_post_idx' });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('SavedPosts');
  },
};
