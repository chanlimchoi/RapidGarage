'use strict';
// Buyer safety (lib/safety.js): the seller each post report is about (kept
// when the post is deleted, for repeat-offender counts), how a no-show
// reporter knew the seller (hold | conversation; never the conversation id),
// and a seller-level safety hold (listings hidden pending admin review).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Reports', 'sellerId', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('Reports', 'contact', { type: Sequelize.STRING(16), allowNull: true });
    await queryInterface.addIndex('Reports', ['sellerId', 'createdAt'], { name: 'reports_seller_created_idx' });
    await queryInterface.addIndex('Reports', ['reporterId', 'status', 'reviewedAt'], { name: 'reports_reporter_status_idx' });
    await queryInterface.addColumn('Users', 'safetyHoldAt', { type: Sequelize.DATE, allowNull: true });
    // Existing reports: the seller is the post's owner.
    await queryInterface.sequelize.query('UPDATE "Reports" SET "sellerId" = (SELECT "userId" FROM "Posts" WHERE "Posts"."id" = "Reports"."postId") WHERE "sellerId" IS NULL');
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'safetyHoldAt');
    await queryInterface.removeIndex('Reports', 'reports_reporter_status_idx');
    await queryInterface.removeIndex('Reports', 'reports_seller_created_idx');
    await queryInterface.removeColumn('Reports', 'contact');
    await queryInterface.removeColumn('Reports', 'sellerId');
  },
};
