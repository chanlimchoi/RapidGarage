'use strict';
// Leftover donation pickup (lib/donations.js): after a sale ends the seller
// lists unsold items as one donation lot with pickup slots; a nearby person
// or organization claims it for one slot.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('DonationLots', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      postId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Posts', key: 'id' }, onDelete: 'CASCADE' },
      sellerId: { type: Sequelize.INTEGER, allowNull: false },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'open' },
      itemIds: { type: Sequelize.TEXT, allowNull: false, defaultValue: '[]' },
      note: { type: Sequelize.STRING(300), allowNull: true },
      slots: { type: Sequelize.TEXT, allowNull: false, defaultValue: '[]' },
      slotMinutes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 30 },
      timeZone: { type: Sequelize.STRING(64), allowNull: false },
      lat: { type: Sequelize.DOUBLE, allowNull: true },
      lng: { type: Sequelize.DOUBLE, allowNull: true },
      claimerId: { type: Sequelize.INTEGER, allowNull: true },
      claimOrg: { type: Sequelize.STRING(80), allowNull: true },
      chosenAt: { type: Sequelize.DATE, allowNull: true },
      claimedAt: { type: Sequelize.DATE, allowNull: true },
      conversationId: { type: Sequelize.INTEGER, allowNull: true },
      doneAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('DonationLots', ['postId'], { name: 'donation_lots_post_uniq', unique: true });
    await queryInterface.addIndex('DonationLots', ['status', 'lat'], { name: 'donation_lots_status_lat_idx' });
    await queryInterface.addIndex('DonationLots', ['claimerId', 'status'], { name: 'donation_lots_claimer_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('DonationLots');
  },
};
