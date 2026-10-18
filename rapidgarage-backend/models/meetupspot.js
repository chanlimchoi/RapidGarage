'use strict';
// An admin-curated public place where buyers and sellers can meet ("Safe
// meetup spots"): police station exchange zones, libraries, stores...
// lat/lng is the spot's approximate location, used only to list the spots
// nearest a sale's area. See lib/meetups.js.
const KINDS = ['police', 'library', 'store', 'community', 'other'];
module.exports = (sequelize, DataTypes) => {
  const MeetupSpot = sequelize.define('MeetupSpot', {
    name: { type: DataTypes.STRING(120), allowNull: false },
    kind: { type: DataTypes.STRING(24), allowNull: false, validate: { isIn: [KINDS] } },
    // The place's public street address (optional; shown to both people).
    address: { type: DataTypes.STRING(200), allowNull: true },
    city: { type: DataTypes.STRING(80), allowNull: true },
    state: { type: DataTypes.STRING(40), allowNull: true },
    lat: { type: DataTypes.DOUBLE, allowNull: false },
    lng: { type: DataTypes.DOUBLE, allowNull: false },
    // e.g. "Marked exchange spaces under camera, open 24/7."
    notes: { type: DataTypes.STRING(300), allowNull: true },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: true },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true },
  }, {
    indexes: [{ name: 'meetup_spots_active_lat_idx', fields: ['active', 'lat'] }],
  });
  MeetupSpot.KINDS = KINDS;
  return MeetupSpot;
};
