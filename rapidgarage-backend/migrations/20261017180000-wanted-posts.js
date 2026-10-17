'use strict';
// Wanted posts: a buyer's "looking for" post (keywords, optional category and
// max price, an area = center + radius, an expiry), the per-post match log that
// doubles as the email outbox and in-app notification list, and reports.
// Conversations can now be about a wanted post instead of a sale (postId null,
// wantedId set). AlertDigests gets a kind so wanted emails share the alert
// digest interval and daily cap.
const ts = (S) => ({
  createdAt: { allowNull: false, type: S.DATE },
  updatedAt: { allowNull: false, type: S.DATE },
});
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const S = Sequelize;
    await queryInterface.createTable('WantedPosts', Object.assign({
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: S.INTEGER },
      userId: { type: S.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      title: { type: S.STRING(80), allowNull: false },
      // Normalized, space-separated match words (max 5); null = words from the title.
      keywords: { type: S.STRING(120), allowNull: true },
      category: { type: S.STRING(24), allowNull: true },
      details: { type: S.TEXT, allowNull: true },
      maxPriceCents: { type: S.INTEGER, allowNull: true },
      areaLabel: { type: S.STRING(80), allowNull: false },
      // Exact center: only used for matching; the API shows a rounded point.
      lat: { type: S.DOUBLE, allowNull: false },
      lng: { type: S.DOUBLE, allowNull: false },
      radiusMiles: { type: S.INTEGER, allowNull: false },
      // active | fulfilled ("expired" = active with expiresAt in the past)
      status: { type: S.STRING(16), allowNull: false, defaultValue: 'active' },
      expiresAt: { type: S.DATE, allowNull: false },
      fulfilledAt: { type: S.DATE, allowNull: true },
      emailEnabled: { type: S.BOOLEAN, allowNull: false, defaultValue: true },
      hidden: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
      hiddenAt: { type: S.DATE, allowNull: true },
      hiddenBy: { type: S.INTEGER, allowNull: true },
      hiddenSource: { type: S.STRING(16), allowNull: true },
    }, ts(S)));
    await queryInterface.addIndex('WantedPosts', ['userId', 'status'], { name: 'wanted_posts_user_status_idx' });
    await queryInterface.addIndex('WantedPosts', ['status', 'expiresAt', 'lat'], { name: 'wanted_posts_active_lat_idx' });
    await queryInterface.createTable('WantedMatches', Object.assign({
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: S.INTEGER },
      wantedId: { type: S.INTEGER, allowNull: false, references: { model: 'WantedPosts', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      userId: { type: S.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      // No FKs: a deleted sale or item is skipped at send/show time.
      postId: { type: S.INTEGER, allowNull: false },
      itemId: { type: S.INTEGER, allowNull: true },
      distanceMiles: { type: S.FLOAT, allowNull: true },
      // Email outbox: pending | sending | sent | skipped | failed
      status: { type: S.STRING(16), allowNull: false, defaultValue: 'pending' },
      attempts: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
      nextAttemptAt: { type: S.DATE, allowNull: true },
      claimToken: { type: S.STRING(40), allowNull: true },
      lastError: { type: S.STRING(200), allowNull: true },
      sentAt: { type: S.DATE, allowNull: true },
      digestId: { type: S.INTEGER, allowNull: true },
      // In-app: null until the buyer opens the wanted post.
      seenAt: { type: S.DATE, allowNull: true },
    }, ts(S)));
    await queryInterface.addIndex('WantedMatches', ['wantedId', 'postId'], { name: 'wanted_matches_wanted_post_uniq', unique: true });
    await queryInterface.addIndex('WantedMatches', ['status', 'nextAttemptAt'], { name: 'wanted_matches_status_idx' });
    await queryInterface.addIndex('WantedMatches', ['userId', 'seenAt'], { name: 'wanted_matches_user_seen_idx' });
    await queryInterface.createTable('WantedReports', Object.assign({
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: S.INTEGER },
      wantedId: { type: S.INTEGER, allowNull: false, references: { model: 'WantedPosts', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      wantedTitle: { type: S.STRING(80), allowNull: true },
      reporterId: { type: S.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
      reason: { type: S.STRING(32), allowNull: false },
      note: { type: S.TEXT, allowNull: true },
      status: { type: S.STRING(16), allowNull: false, defaultValue: 'open' },
      action: { type: S.STRING(16), allowNull: true },
      reviewerId: { type: S.INTEGER, allowNull: true },
      reviewedAt: { type: S.DATE, allowNull: true },
      resolutionNote: { type: S.TEXT, allowNull: true },
    }, ts(S)));
    await queryInterface.addIndex('WantedReports', ['wantedId', 'status'], { name: 'wanted_reports_wanted_status_idx' });
    await queryInterface.addIndex('WantedReports', ['reporterId', 'createdAt'], { name: 'wanted_reports_reporter_created_idx' });
    await queryInterface.addIndex('WantedReports', ['wantedId', 'reporterId'], { name: 'wanted_reports_one_open_per_user', unique: true, where: { status: 'open' } });
    // Conversations about a wanted post (the seller writes to the buyer).
    await queryInterface.addColumn('Conversations', 'wantedId', { type: S.INTEGER, allowNull: true });
    await queryInterface.changeColumn('Conversations', 'postId', { type: S.INTEGER, allowNull: true });
    await queryInterface.addIndex('Conversations', ['wantedId', 'buyerId', 'sellerId'], { name: 'conversations_wanted_buyer_seller_uniq', unique: true });
    await queryInterface.addColumn('AlertDigests', 'kind', { type: S.STRING(16), allowNull: false, defaultValue: 'alert' });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('AlertDigests', 'kind');
    await queryInterface.removeIndex('Conversations', 'conversations_wanted_buyer_seller_uniq');
    // Wanted conversations have no sale; they go with the feature.
    await queryInterface.sequelize.query('DELETE FROM "Conversations" WHERE "postId" IS NULL');
    await queryInterface.changeColumn('Conversations', 'postId', { type: Sequelize.INTEGER, allowNull: false });
    await queryInterface.removeColumn('Conversations', 'wantedId');
    await queryInterface.dropTable('WantedReports');
    await queryInterface.dropTable('WantedMatches');
    await queryInterface.dropTable('WantedPosts');
  },
};
