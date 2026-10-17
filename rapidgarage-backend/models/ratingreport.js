'use strict';
const REASONS = ['harassment', 'offensive', 'spam', 'fake', 'other'];
const STATUSES = ['open', 'dismissed', 'actioned'];

// Someone's report about a rating (usually its subject).
module.exports = (sequelize, DataTypes) => {
  const RatingReport = sequelize.define('RatingReport', {
    ratingId: { type: DataTypes.INTEGER, allowNull: false },
    reporterId: { type: DataTypes.INTEGER, allowNull: false },
    reason: { type: DataTypes.STRING(32), allowNull: false, validate: { isIn: [REASONS] } },
    note: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'open', validate: { isIn: [STATUSES] } },
    action: { type: DataTypes.STRING(20), allowNull: true },
    reviewerId: { type: DataTypes.INTEGER, allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
    resolutionNote: { type: DataTypes.TEXT, allowNull: true },
  }, {
    indexes: [
      { name: 'rating_reports_rating_status_idx', fields: ['ratingId', 'status'] },
      { name: 'rating_reports_reporter_created_idx', fields: ['reporterId', 'createdAt'] },
      { name: 'rating_reports_one_open_per_user', unique: true, fields: ['ratingId', 'reporterId'], where: { status: 'open' } },
    ],
  });
  RatingReport.associate = (models) => {
    RatingReport.belongsTo(models.Rating, { foreignKey: 'ratingId', onDelete: 'CASCADE' });
    RatingReport.belongsTo(models.User, { as: 'reporter', foreignKey: 'reporterId', onDelete: 'CASCADE' });
    RatingReport.belongsTo(models.User, { as: 'reviewer', foreignKey: 'reviewerId', onDelete: 'SET NULL' });
  };
  RatingReport.REASONS = REASONS;
  return RatingReport;
};
