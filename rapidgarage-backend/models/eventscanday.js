'use strict';
// Scans of an event's short link per local day (see lib/scans.js). No visitor data.
module.exports = (sequelize, DataTypes) => {
  const EventScanDay = sequelize.define('EventScanDay', {
    eventId: { type: DataTypes.INTEGER, allowNull: false },
    day: { type: DataTypes.DATEONLY, allowNull: false },
    count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { indexes: [{ name: 'event_scan_days_uniq', unique: true, fields: ['eventId', 'day'] }] });
  EventScanDay.associate = (models) => {
    EventScanDay.belongsTo(models.SaleEvent, { foreignKey: 'eventId', onDelete: 'CASCADE' });
  };
  return EventScanDay;
};
