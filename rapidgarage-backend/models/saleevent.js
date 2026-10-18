'use strict';
// A neighborhood sale (see lib/events.js). `days` holds the schedule as JSON
// in the shape lib/schedule.js uses for a post's SaleDays.
const JOIN_MODES = ['open', 'approval'];

module.exports = (sequelize, DataTypes) => {
  const SaleEvent = sequelize.define('SaleEvent', {
    organizerId: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    areaLabel: { type: DataTypes.STRING(120), allowNull: false },
    lat: { type: DataTypes.DOUBLE, allowNull: false },
    lng: { type: DataTypes.DOUBLE, allowNull: false },
    radiusMiles: { type: DataTypes.FLOAT, allowNull: false },
    joinMode: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'approval', validate: { isIn: [JOIN_MODES] } },
    timeZone: { type: DataTypes.STRING(64), allowNull: false },
    days: {
      type: DataTypes.TEXT, allowNull: false,
      get() { try { return JSON.parse(this.getDataValue('days') || '[]'); } catch (e) { return []; } },
      set(v) { this.setDataValue('days', JSON.stringify(v || [])); },
    },
    startDate: { type: DataTypes.DATE, allowNull: false },
    endDate: { type: DataTypes.DATE, allowNull: false },
    shortCode: { type: DataTypes.STRING(12), allowNull: false, unique: 'sale_events_short_code_uniq' },
    hidden: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    hiddenAt: { type: DataTypes.DATE, allowNull: true },
    hiddenBy: { type: DataTypes.INTEGER, allowNull: true },
    hiddenSource: { type: DataTypes.STRING(16), allowNull: true },
    // Add to calendar (lib/calendar.js): .ics SEQUENCE and every day ever scheduled.
    calendarSeq: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    calendarDates: { type: DataTypes.TEXT, allowNull: true },
  }, {
    hooks: {
      beforeSave: (ev) => {
        const cal = require('../lib/calendar');
        if (ev.isNewRecord || ev.changed('days')) {
          let prev = [];
          try { prev = JSON.parse(ev.previous('days') || '[]'); } catch (e) { prev = []; }
          const oldTz = ev.isNewRecord ? ev.timeZone : (ev.previous('timeZone') || ev.timeZone);
          ev.set('calendarDates', cal.mergeHistory(cal.mergeHistory(ev.get('calendarDates'), ev.isNewRecord ? [] : prev, oldTz), ev.days || [], ev.timeZone));
        }
        if (!ev.isNewRecord) cal.bumpOnChange(ev, cal.eventFields);
      },
    },
    indexes: [
      { name: 'sale_events_lat_lng_idx', fields: ['lat', 'lng'] },
      { name: 'sale_events_end_idx', fields: ['endDate'] },
      { name: 'sale_events_organizer_idx', fields: ['organizerId', 'createdAt'] },
    ],
  });
  SaleEvent.associate = (models) => {
    SaleEvent.belongsTo(models.User, { as: 'organizer', foreignKey: 'organizerId', onDelete: 'CASCADE' });
    SaleEvent.hasMany(models.EventParticipant, { as: 'participants', foreignKey: 'eventId', onDelete: 'CASCADE', hooks: true });
    SaleEvent.hasMany(models.EventScanDay, { as: 'scanDays', foreignKey: 'eventId', onDelete: 'CASCADE', hooks: true });
    SaleEvent.hasMany(models.EventReport, { as: 'reports', foreignKey: 'eventId', onDelete: 'CASCADE', hooks: true });
  };
  // lib/schedule.js reads `saleDays` (windowsOf / isEnded / statusOf).
  Object.defineProperty(SaleEvent.prototype, 'saleDays', { get() { return this.days; } });
  SaleEvent.JOIN_MODES = JOIN_MODES;
  return SaleEvent;
};
