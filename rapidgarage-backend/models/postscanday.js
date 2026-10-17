'use strict';
// Scans of a post's short link (/s/<code>) per local day. No visitor data.
module.exports = (sequelize, DataTypes) => {
  const PostScanDay = sequelize.define('PostScanDay', {
    postId: { type: DataTypes.INTEGER, allowNull: false },
    day: { type: DataTypes.DATEONLY, allowNull: false },
    count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { indexes: [{ name: 'post_scan_days_uniq', unique: true, fields: ['postId', 'day'] }] });
  PostScanDay.associate = (models) => {
    PostScanDay.belongsTo(models.Post, { foreignKey: 'postId', onDelete: 'CASCADE' });
  };
  return PostScanDay;
};
