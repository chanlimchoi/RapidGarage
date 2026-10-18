'use strict';
// Safety + suggested public meetup spots: the admin-curated spot list,
// meetup proposals inside conversations, and their event messages.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('MeetupSpots', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      name: { type: Sequelize.STRING(120), allowNull: false },
      kind: { type: Sequelize.STRING(24), allowNull: false },
      address: { type: Sequelize.STRING(200), allowNull: true },
      city: { type: Sequelize.STRING(80), allowNull: true },
      state: { type: Sequelize.STRING(40), allowNull: true },
      lat: { type: Sequelize.DOUBLE, allowNull: false },
      lng: { type: Sequelize.DOUBLE, allowNull: false },
      notes: { type: Sequelize.STRING(300), allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdBy: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL' },
      updatedBy: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL' },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex('MeetupSpots', ['active', 'lat'], { name: 'meetup_spots_active_lat_idx' });
    await queryInterface.createTable('MeetupProposals', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      conversationId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Conversations', key: 'id' }, onDelete: 'CASCADE' },
      proposerId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      recipientId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      spotId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'MeetupSpots', key: 'id' }, onDelete: 'SET NULL' },
      placeName: { type: Sequelize.STRING(120), allowNull: false },
      placeKind: { type: Sequelize.STRING(24), allowNull: false },
      placeAddress: { type: Sequelize.STRING(200), allowNull: true },
      placeCity: { type: Sequelize.STRING(80), allowNull: true },
      placeState: { type: Sequelize.STRING(40), allowNull: true },
      placeLat: { type: Sequelize.DOUBLE, allowNull: true },
      placeLng: { type: Sequelize.DOUBLE, allowNull: true },
      meetAt: { type: Sequelize.DATE, allowNull: false },
      timeZone: { type: Sequelize.STRING(64), allowNull: false },
      note: { type: Sequelize.STRING(200), allowNull: true },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'pending' },
      respondedAt: { type: Sequelize.DATE, allowNull: true },
      counterOfId: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'MeetupProposals', key: 'id' }, onDelete: 'SET NULL' },
      endedReason: { type: Sequelize.STRING(16), allowNull: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex('MeetupProposals', ['conversationId', 'status'], { name: 'meetup_proposals_conversation_idx' });
    await queryInterface.addIndex('MeetupProposals', ['status', 'meetAt'], { name: 'meetup_proposals_status_meet_idx' });
    await queryInterface.addIndex('MeetupProposals', ['proposerId', 'createdAt'], { name: 'meetup_proposals_proposer_created_idx' });
    await queryInterface.addColumn('Messages', 'meetupId', { type: Sequelize.INTEGER, allowNull: true, references: { model: 'MeetupProposals', key: 'id' }, onDelete: 'SET NULL' });
    await queryInterface.addColumn('Messages', 'meetupEvent', { type: Sequelize.STRING(16), allowNull: true });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('Messages', 'meetupEvent');
    await queryInterface.removeColumn('Messages', 'meetupId');
    await queryInterface.dropTable('MeetupProposals');
    await queryInterface.dropTable('MeetupSpots');
  },
};
