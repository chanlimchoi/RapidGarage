'use strict';
// A sale taking part in a neighborhood sale. pending until the organizer
// approves (joinMode "approval"); approved at once for "open" events.
const STATUSES = ['pending', 'approved'];
module.exports = (sequelize, DataTypes) => {
  const EventParticipant = sequelize.define('EventParticipant', {
    eventId: { type: DataTypes.INTEGER, allowNull: false },
    postId: { type: DataTypes.INTEGER, allowNull: false, unique: 'event_participants_post_uniq' },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending', validate: { isIn: [STATUSES] } },
    decidedAt: { type: DataTypes.DATE, allowNull: true },
  }, { indexes: [{ name: 'event_participants_event_status_idx', fields: ['eventId', 'status'] }] });
  EventParticipant.associate = (models) => {
    EventParticipant.belongsTo(models.SaleEvent, { as: 'event', foreignKey: 'eventId', onDelete: 'CASCADE' });
    EventParticipant.belongsTo(models.Post, { as: 'post', foreignKey: 'postId', onDelete: 'CASCADE' });
  };
  EventParticipant.STATUSES = STATUSES;
  return EventParticipant;
};
