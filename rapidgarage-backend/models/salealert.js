'use strict';
// A saved search: email me about new sales within radiusMiles of (lat, lng).
module.exports = (sequelize, DataTypes) => {
  const SaleAlert = sequelize.define('SaleAlert', {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    label: { type: DataTypes.STRING(80), allowNull: true },
    lat: { type: DataTypes.DOUBLE, allowNull: false },
    lng: { type: DataTypes.DOUBLE, allowNull: false },
    radiusMiles: { type: DataTypes.INTEGER, allowNull: false },
    maxPrice: { type: DataTypes.INTEGER, allowNull: true },
    freeOnly: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // instant: an email per new sale (batched); weekly: one weekend digest (lib/weekendDigest.js).
    frequency: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'instant', validate: { isIn: [['instant', 'weekly']] } },
    weeklySentAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    indexes: [
      { name: 'sale_alerts_user_idx', fields: ['userId'] },
      { name: 'sale_alerts_enabled_lat_idx', fields: ['enabled', 'lat'] },
    ],
  });
  SaleAlert.associate = (models) => {
    SaleAlert.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
    SaleAlert.hasMany(models.AlertNotification, { foreignKey: 'alertId', onDelete: 'CASCADE' });
  };
  SaleAlert.prototype.toJSON = function() {
    const v = this.get();
    return {
      id: v.id, label: v.label, lat: v.lat, lng: v.lng, radiusMiles: v.radiusMiles,
      maxPrice: v.maxPrice, freeOnly: v.freeOnly, enabled: v.enabled, frequency: v.frequency || 'instant', createdAt: v.createdAt, updatedAt: v.updatedAt,
    };
  };
  return SaleAlert;
};
