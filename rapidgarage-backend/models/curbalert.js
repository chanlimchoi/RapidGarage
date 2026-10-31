'use strict';
// "Tell me about free stuff at the curb near me" (lib/curbAlerts.js): one per person.
module.exports = (sequelize, DataTypes) => {
  const CurbAlert = sequelize.define('CurbAlert', {
    userId: { type: DataTypes.INTEGER, allowNull: false, unique: 'curb_alerts_user_uniq' },
    lat: { type: DataTypes.DOUBLE, allowNull: false },
    lng: { type: DataTypes.DOUBLE, allowNull: false },
    radiusMiles: { type: DataTypes.DOUBLE, allowNull: false },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, {
    indexes: [{ name: 'curb_alerts_enabled_lat_idx', fields: ['enabled', 'lat'] }],
  });
  CurbAlert.associate = (models) => {
    CurbAlert.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
  };
  // The person's own alert only; the place is theirs, so it's returned to them alone.
  CurbAlert.prototype.toJSON = function toJSON() {
    const v = this.get();
    return { lat: v.lat, lng: v.lng, radiusMiles: v.radiusMiles, enabled: !!v.enabled, updatedAt: v.updatedAt };
  };
  return CurbAlert;
};
