'use strict';
// Page views of a sale per local day (seller dashboard). No visitor data.
module.exports = (sequelize, DataTypes) => {
  const PostViewDay = sequelize.define('PostViewDay', {
    postId: { type: DataTypes.INTEGER, allowNull: false },
    day: { type: DataTypes.DATEONLY, allowNull: false },
    count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { indexes: [{ name: 'post_view_days_uniq', unique: true, fields: ['postId', 'day'] }] });
  PostViewDay.associate = (models) => {
    PostViewDay.belongsTo(models.Post, { foreignKey: 'postId', onDelete: 'CASCADE' });
  };
  return PostViewDay;
};
