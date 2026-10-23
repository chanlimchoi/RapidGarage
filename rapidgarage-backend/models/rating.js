'use strict';
// A participant's rating of the other person after a conversation (see lib/ratings.js).
module.exports = (sequelize, DataTypes) => {
  const Rating = sequelize.define('Rating', {
    conversationId: { type: DataTypes.INTEGER, allowNull: false },
    raterId: { type: DataTypes.INTEGER, allowNull: false },
    rateeId: { type: DataTypes.INTEGER, allowNull: false },
    raterRole: { type: DataTypes.STRING(8), allowNull: false, validate: { isIn: [['buyer', 'seller']] } },
    stars: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 5 } },
    comment: { type: DataTypes.STRING(280), allowNull: true },
    commentRemovedAt: { type: DataTypes.DATE, allowNull: true },
    commentRemovedBy: { type: DataTypes.INTEGER, allowNull: true },
  }, {
    indexes: [
      { name: 'ratings_conv_rater_uniq', unique: true, fields: ['conversationId', 'raterId'] },
      { name: 'ratings_ratee_idx', fields: ['rateeId', 'createdAt'] },
      { name: 'ratings_ratee_role_idx', fields: ['rateeId', 'raterRole'] },
    ],
  });
  Rating.associate = (models) => {
    Rating.belongsTo(models.Conversation, { foreignKey: 'conversationId', onDelete: 'CASCADE' });
    Rating.belongsTo(models.User, { as: 'rater', foreignKey: 'raterId', onDelete: 'CASCADE' });
    Rating.belongsTo(models.User, { as: 'ratee', foreignKey: 'rateeId', onDelete: 'CASCADE' });
    Rating.hasMany(models.RatingReport, { as: 'reports', foreignKey: 'ratingId', onDelete: 'CASCADE', hooks: true });
  };
  return Rating;
};
