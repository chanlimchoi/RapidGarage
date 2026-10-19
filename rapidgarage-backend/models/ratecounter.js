'use strict';
// A fixed-window counter shared by every app instance (lib/counters.js).
module.exports = (sequelize, DataTypes) => sequelize.define('RateCounter', {
  key: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
  count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  resetAt: { type: DataTypes.DATE, allowNull: false },
}, { indexes: [{ name: 'rate_counters_reset_idx', fields: ['resetAt'] }] });
