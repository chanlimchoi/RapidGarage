'use strict';
// "Sale postId matched wanted post wantedId": one row per (wanted, sale), so
// each match is sent once. Also the email outbox (status...) and the buyer's
// in-app list (seenAt).
module.exports = (sequelize, DataTypes) => {
  const WantedMatch = sequelize.define('WantedMatch', {
    wantedId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    postId: { type: DataTypes.INTEGER, allowNull: false },
    itemId: { type: DataTypes.INTEGER, allowNull: true },
    distanceMiles: { type: DataTypes.FLOAT, allowNull: true },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    nextAttemptAt: { type: DataTypes.DATE, allowNull: true },
    claimToken: { type: DataTypes.STRING(40), allowNull: true },
    lastError: { type: DataTypes.STRING(200), allowNull: true },
    sentAt: { type: DataTypes.DATE, allowNull: true },
    digestId: { type: DataTypes.INTEGER, allowNull: true },
    seenAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    indexes: [
      { name: 'wanted_matches_wanted_post_uniq', unique: true, fields: ['wantedId', 'postId'] },
      { name: 'wanted_matches_status_idx', fields: ['status', 'nextAttemptAt'] },
      { name: 'wanted_matches_user_seen_idx', fields: ['userId', 'seenAt'] },
    ],
  });
  WantedMatch.associate = (models) => {
    WantedMatch.belongsTo(models.WantedPost, { as: 'wanted', foreignKey: 'wantedId', onDelete: 'CASCADE' });
    WantedMatch.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
  };
  return WantedMatch;
};
