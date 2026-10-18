'use strict';
// A buyer's "looking for" post (see lib/wanted.js).
module.exports = (sequelize, DataTypes) => {
  const WantedPost = sequelize.define('WantedPost', {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    title: { type: DataTypes.STRING(80), allowNull: false },
    keywords: { type: DataTypes.STRING(120), allowNull: true },
    category: { type: DataTypes.STRING(24), allowNull: true },
    details: { type: DataTypes.TEXT, allowNull: true },
    maxPriceCents: { type: DataTypes.INTEGER, allowNull: true },
    areaLabel: { type: DataTypes.STRING(80), allowNull: false },
    lat: { type: DataTypes.DOUBLE, allowNull: false },
    lng: { type: DataTypes.DOUBLE, allowNull: false },
    radiusMiles: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'active' },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    fulfilledAt: { type: DataTypes.DATE, allowNull: true },
    emailEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    hidden: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    hiddenAt: { type: DataTypes.DATE, allowNull: true },
    hiddenBy: { type: DataTypes.INTEGER, allowNull: true },
    hiddenSource: { type: DataTypes.STRING(16), allowNull: true },
  }, {
    indexes: [
      { name: 'wanted_posts_user_status_idx', fields: ['userId', 'status'] },
      { name: 'wanted_posts_active_lat_idx', fields: ['status', 'expiresAt', 'lat'] },
    ],
  });
  WantedPost.associate = (models) => {
    WantedPost.belongsTo(models.User, { as: 'poster', foreignKey: 'userId', onDelete: 'CASCADE' });
    WantedPost.hasMany(models.WantedMatch, { as: 'matches', foreignKey: 'wantedId', onDelete: 'CASCADE', hooks: true });
    WantedPost.hasMany(models.WantedReport, { as: 'reports', foreignKey: 'wantedId', onDelete: 'CASCADE', hooks: true });
  };
  WantedPost.STATUSES = ['active', 'fulfilled'];
  return WantedPost;
};
