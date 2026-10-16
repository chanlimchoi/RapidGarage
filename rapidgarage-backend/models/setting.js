'use strict';
// Persisted app-wide settings, editable by admins. Values are stored as JSON text.
module.exports = (sequelize, DataTypes) => {
  var Setting = sequelize.define('Setting', {
    key: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
    value: { type: DataTypes.TEXT, allowNull: true },
  });
  return Setting;
};
