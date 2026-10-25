'use strict';
// Site activity counts per local day (lib/activity.js): what was clicked or
// viewed, on what, and how many times. Never who: no user id, IP or user agent.
//   kind        what happened (lib/activity.js KINDS)
//   targetType  'post' | 'event' | 'wanted' | 'user' | 'page' | 'city' | '' (none)
//   targetId    the post/event/wanted/user id, or 0
//   key         page name ('home', 'search', ...) or city for empty searches, else ''
module.exports = (sequelize, DataTypes) => {
  const ActivityDay = sequelize.define('ActivityDay', {
    kind: { type: DataTypes.STRING(24), allowNull: false },
    targetType: { type: DataTypes.STRING(12), allowNull: false, defaultValue: '' },
    targetId: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    key: { type: DataTypes.STRING(64), allowNull: false, defaultValue: '' },
    day: { type: DataTypes.DATEONLY, allowNull: false },
    count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, {
    indexes: [
      { name: 'activity_days_uniq', unique: true, fields: ['kind', 'targetType', 'targetId', 'key', 'day'] },
      { name: 'activity_days_day_idx', fields: ['day'] },
      { name: 'activity_days_target_idx', fields: ['targetType', 'targetId'] },
    ],
  });
  return ActivityDay;
};
