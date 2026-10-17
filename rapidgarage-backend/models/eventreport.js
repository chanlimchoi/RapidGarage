'use strict';
// A user's report about a neighborhood sale (same reasons and flow as post reports).
const REASONS = ['spam', 'scam', 'prohibited', 'offensive', 'wrong_info', 'other'];
const STATUSES = ['open', 'dismissed', 'actioned'];
module.exports = (sequelize, DataTypes) => {
  const EventReport = sequelize.define('EventReport', {
    eventId: { type: DataTypes.INTEGER, allowNull: false },
    eventName: { type: DataTypes.STRING(80), allowNull: true },
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
      { name: 'event_reports_event_status_idx', fields: ['eventId', 'status'] },
      { name: 'event_reports_reporter_created_idx', fields: ['reporterId', 'createdAt'] },
      { name: 'event_reports_one_open_per_user', unique: true, fields: ['eventId', 'reporterId'], where: { status: 'open' } },
    ],
  });
  EventReport.associate = (models) => {
    EventReport.belongsTo(models.SaleEvent, { as: 'event', foreignKey: 'eventId', onDelete: 'CASCADE' });
    EventReport.belongsTo(models.User, { as: 'reporter', foreignKey: 'reporterId', onDelete: 'CASCADE' });
  };
  EventReport.REASONS = REASONS;
  EventReport.STATUSES = STATUSES;
  return EventReport;
};
