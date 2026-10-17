'use strict';
// A user's report about a wanted post (same reasons and flow as post reports).
const REASONS = ['spam', 'scam', 'prohibited', 'offensive', 'wrong_info', 'other'];
const STATUSES = ['open', 'dismissed', 'actioned'];
module.exports = (sequelize, DataTypes) => {
  const WantedReport = sequelize.define('WantedReport', {
    wantedId: { type: DataTypes.INTEGER, allowNull: false },
    wantedTitle: { type: DataTypes.STRING(80), allowNull: true },
    reporterId: { type: DataTypes.INTEGER, allowNull: false },
    reason: { type: DataTypes.STRING(32), allowNull: false, validate: { isIn: [REASONS] } },
    note: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'open', validate: { isIn: [STATUSES] } },
    // dismissed | hidden | unhidden | deleted
    action: { type: DataTypes.STRING(16), allowNull: true },
    reviewerId: { type: DataTypes.INTEGER, allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
    resolutionNote: { type: DataTypes.TEXT, allowNull: true },
  }, {
    indexes: [
      { name: 'wanted_reports_event_status_idx', fields: ['wantedId', 'status'] },
      { name: 'wanted_reports_reporter_created_idx', fields: ['reporterId', 'createdAt'] },
      { name: 'wanted_reports_one_open_per_user', unique: true, fields: ['wantedId', 'reporterId'], where: { status: 'open' } },
    ],
  });
  WantedReport.associate = (models) => {
    WantedReport.belongsTo(models.WantedPost, { as: 'wanted', foreignKey: 'wantedId', onDelete: 'CASCADE' });
    WantedReport.belongsTo(models.User, { as: 'reporter', foreignKey: 'reporterId', onDelete: 'CASCADE' });
  };
  WantedReport.REASONS = REASONS;
  WantedReport.STATUSES = STATUSES;
  return WantedReport;
};
