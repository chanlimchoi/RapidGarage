'use strict';
const REASONS = ['spam', 'scam', 'prohibited', 'offensive', 'wrong_info', 'other'];
const STATUSES = ['open', 'dismissed', 'actioned'];

module.exports = (sequelize, DataTypes) => {
  const Report = sequelize.define('Report', {
    postId: { type: DataTypes.INTEGER, allowNull: false },
    postTitle: { type: DataTypes.STRING, allowNull: true },
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
      { name: 'reports_post_status_idx', fields: ['postId', 'status'] },
      { name: 'reports_reporter_created_idx', fields: ['reporterId', 'createdAt'] },
      { name: 'reports_one_open_per_user', unique: true, fields: ['postId', 'reporterId'], where: { status: 'open' } },
    ],
  });
  Report.associate = (models) => {
    Report.belongsTo(models.User, { as: 'reporter', foreignKey: 'reporterId', onDelete: 'CASCADE' });
    Report.belongsTo(models.User, { as: 'reviewer', foreignKey: 'reviewerId', onDelete: 'SET NULL', constraints: false });
  };
  Report.REASONS = REASONS;
  Report.STATUSES = STATUSES;
  return Report;
};
