'use strict';
// Neighborhood sales: an organizer's event (name, area = center + radius,
// days like a post's schedule) that sellers join with their own sale.
// Short codes share the /s/<code> space with posts; scans are counted per
// event and local day like post scans; reports mirror post reports.
const ts = (S) => ({
  createdAt: { allowNull: false, type: S.DATE },
  updatedAt: { allowNull: false, type: S.DATE },
});
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const S = Sequelize;
    await queryInterface.createTable('SaleEvents', Object.assign({
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: S.INTEGER },
      organizerId: { type: S.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      name: { type: S.STRING(80), allowNull: false },
      description: { type: S.TEXT, allowNull: true },
      areaLabel: { type: S.STRING(120), allowNull: false },
      lat: { type: S.DOUBLE, allowNull: false },
      lng: { type: S.DOUBLE, allowNull: false },
      radiusMiles: { type: S.FLOAT, allowNull: false },
      // open: sellers join at once | approval: the organizer approves each sale
      joinMode: { type: S.STRING(16), allowNull: false, defaultValue: 'approval' },
      timeZone: { type: S.STRING(64), allowNull: false },
      // [{ date, startTime, endTime, startsAt, endsAt }] (lib/schedule.js), first start / last end.
      days: { type: S.TEXT, allowNull: false },
      startDate: { type: S.DATE, allowNull: false },
      endDate: { type: S.DATE, allowNull: false },
      shortCode: { type: S.STRING(12), allowNull: false },
      hidden: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
      hiddenAt: { type: S.DATE, allowNull: true },
      hiddenBy: { type: S.INTEGER, allowNull: true },
      hiddenSource: { type: S.STRING(16), allowNull: true },
    }, ts(S)));
    await queryInterface.addIndex('SaleEvents', ['shortCode'], { name: 'sale_events_short_code_uniq', unique: true });
    await queryInterface.addIndex('SaleEvents', ['lat', 'lng'], { name: 'sale_events_lat_lng_idx' });
    await queryInterface.addIndex('SaleEvents', ['endDate'], { name: 'sale_events_end_idx' });
    await queryInterface.addIndex('SaleEvents', ['organizerId', 'createdAt'], { name: 'sale_events_organizer_idx' });
    await queryInterface.createTable('EventParticipants', Object.assign({
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: S.INTEGER },
      eventId: { type: S.INTEGER, allowNull: false, references: { model: 'SaleEvents', key: 'id' }, onDelete: 'CASCADE' },
      postId: { type: S.INTEGER, allowNull: false, references: { model: 'Posts', key: 'id' }, onDelete: 'CASCADE' },
      // pending | approved (declined and removed rows are deleted; see lib/events.js)
      status: { type: S.STRING(16), allowNull: false, defaultValue: 'pending' },
      decidedAt: { type: S.DATE, allowNull: true },
    }, ts(S)));
    // A sale is in at most one event at a time.
    await queryInterface.addIndex('EventParticipants', ['postId'], { name: 'event_participants_post_uniq', unique: true });
    await queryInterface.addIndex('EventParticipants', ['eventId', 'status'], { name: 'event_participants_event_status_idx' });
    await queryInterface.createTable('EventScanDays', Object.assign({
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: S.INTEGER },
      eventId: { type: S.INTEGER, allowNull: false, references: { model: 'SaleEvents', key: 'id' }, onDelete: 'CASCADE' },
      day: { type: S.DATEONLY, allowNull: false },
      count: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
    }, ts(S)));
    await queryInterface.addIndex('EventScanDays', ['eventId', 'day'], { name: 'event_scan_days_uniq', unique: true });
    await queryInterface.createTable('EventReports', Object.assign({
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: S.INTEGER },
      eventId: { type: S.INTEGER, allowNull: false, references: { model: 'SaleEvents', key: 'id' }, onDelete: 'CASCADE' },
      eventName: { type: S.STRING(80), allowNull: true },
      reporterId: { type: S.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      reason: { type: S.STRING(32), allowNull: false },
      note: { type: S.TEXT, allowNull: true },
      status: { type: S.STRING(16), allowNull: false, defaultValue: 'open' },
      action: { type: S.STRING(16), allowNull: true },
      reviewerId: { type: S.INTEGER, allowNull: true },
      reviewedAt: { type: S.DATE, allowNull: true },
      resolutionNote: { type: S.TEXT, allowNull: true },
    }, ts(S)));
    await queryInterface.addIndex('EventReports', ['eventId', 'status'], { name: 'event_reports_event_status_idx' });
    await queryInterface.addIndex('EventReports', ['reporterId', 'createdAt'], { name: 'event_reports_reporter_created_idx' });
    await queryInterface.addIndex('EventReports', ['eventId', 'reporterId'], { name: 'event_reports_one_open_per_user', unique: true, where: { status: 'open' } });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('EventReports');
    await queryInterface.dropTable('EventScanDays');
    await queryInterface.dropTable('EventParticipants');
    await queryInterface.dropTable('SaleEvents');
  },
};
