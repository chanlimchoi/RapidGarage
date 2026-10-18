'use strict';
// A suggestion, inside a conversation, to meet at a public place at a time.
// The other person accepts, declines or counters (a new proposal with
// counterOfId; the old one becomes 'countered'). Every step posts an event
// message (Message.kind = 'meetup'). The place is a snapshot: editing or
// removing a curated spot later doesn't change what was agreed.
const STATUSES = ['pending', 'accepted', 'declined', 'countered', 'cancelled', 'expired'];
module.exports = (sequelize, DataTypes) => {
  const MeetupProposal = sequelize.define('MeetupProposal', {
    conversationId: { type: DataTypes.INTEGER, allowNull: false },
    proposerId: { type: DataTypes.INTEGER, allowNull: false },
    recipientId: { type: DataTypes.INTEGER, allowNull: false },
    spotId: { type: DataTypes.INTEGER, allowNull: true },
    placeName: { type: DataTypes.STRING(120), allowNull: false },
    // A spot kind (MeetupSpot.KINDS) or 'custom' for a place typed in.
    placeKind: { type: DataTypes.STRING(24), allowNull: false },
    placeAddress: { type: DataTypes.STRING(200), allowNull: true },
    placeCity: { type: DataTypes.STRING(80), allowNull: true },
    placeState: { type: DataTypes.STRING(40), allowNull: true },
    placeLat: { type: DataTypes.DOUBLE, allowNull: true },
    placeLng: { type: DataTypes.DOUBLE, allowNull: true },
    meetAt: { type: DataTypes.DATE, allowNull: false },
    // Zone used for the English summary stored in Message.body.
    timeZone: { type: DataTypes.STRING(64), allowNull: false },
    note: { type: DataTypes.STRING(200), allowNull: true },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending', validate: { isIn: [STATUSES] } },
    respondedAt: { type: DataTypes.DATE, allowNull: true },
    counterOfId: { type: DataTypes.INTEGER, allowNull: true },
    // Why it ended without an answer: blocked
    endedReason: { type: DataTypes.STRING(16), allowNull: true },
  }, {
    indexes: [
      { name: 'meetup_proposals_conversation_idx', fields: ['conversationId', 'status'] },
      { name: 'meetup_proposals_status_meet_idx', fields: ['status', 'meetAt'] },
      { name: 'meetup_proposals_proposer_created_idx', fields: ['proposerId', 'createdAt'] },
    ],
  });
  MeetupProposal.associate = (models) => {
    MeetupProposal.belongsTo(models.Conversation, { foreignKey: 'conversationId', onDelete: 'CASCADE' });
    MeetupProposal.belongsTo(models.MeetupSpot, { foreignKey: 'spotId', as: 'spot', onDelete: 'SET NULL', constraints: false });
  };
  MeetupProposal.STATUSES = STATUSES;
  return MeetupProposal;
};
