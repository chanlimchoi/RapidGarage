'use strict';
// A sale a buyer starred (see controllers/saved.js).
module.exports = (sequelize, DataTypes) => {
  const SavedPost = sequelize.define('SavedPost', {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    postId: { type: DataTypes.INTEGER, allowNull: false },
  }, {
    indexes: [
      { name: 'saved_posts_user_post_uniq', unique: true, fields: ['userId', 'postId'] },
      { name: 'saved_posts_post_idx', fields: ['postId'] },
    ],
  });
  SavedPost.associate = (models) => {
    SavedPost.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
    SavedPost.belongsTo(models.Post, { foreignKey: 'postId', as: 'post', onDelete: 'CASCADE' });
  };
  return SavedPost;
};
