'use strict';
// Share button presses for a sale per local day (seller dashboard). No visitor data.
module.exports = (sequelize, DataTypes) => {
  const PostShareDay = sequelize.define('PostShareDay', {
    postId: { type: DataTypes.INTEGER, allowNull: false },
    day: { type: DataTypes.DATEONLY, allowNull: false },
    count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { indexes: [{ name: 'post_share_days_uniq', unique: true, fields: ['postId', 'day'] }] });
  PostShareDay.associate = (models) => {
    PostShareDay.belongsTo(models.Post, { foreignKey: 'postId', onDelete: 'CASCADE' });
  };
  return PostShareDay;
};
