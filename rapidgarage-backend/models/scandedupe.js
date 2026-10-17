'use strict';
// Salted, keyed hash of (post, visitor) for the current UTC day only; the salt
// lives in memory and is replaced daily, after which old rows are deleted.
module.exports = (sequelize, DataTypes) => {
  const ScanDedupe = sequelize.define('ScanDedupe', {
    day: { type: DataTypes.STRING(10), allowNull: false },
    hash: { type: DataTypes.STRING(43), allowNull: false },
  }, {
    indexes: [
      { name: 'scan_dedupes_hash_uniq', unique: true, fields: ['hash'] },
      { name: 'scan_dedupes_day_idx', fields: ['day'] },
    ],
  });
  return ScanDedupe;
};
