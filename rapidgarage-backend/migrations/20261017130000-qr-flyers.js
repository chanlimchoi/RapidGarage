'use strict';
// QR flyers: a random short code per post (for /s/<code>), daily scan counts,
// and short-lived salted visitor hashes used only to dedupe repeat scans.
const crypto = require('crypto');
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const code = () => Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('Posts', 'shortCode', { type: Sequelize.STRING(12), allowNull: true });
    const [rows] = await queryInterface.sequelize.query('SELECT id FROM "Posts" WHERE "shortCode" IS NULL');
    const used = new Set();
    for (const r of rows) {
      let c;
      do { c = code(); } while (used.has(c));
      used.add(c);
      await queryInterface.sequelize.query('UPDATE "Posts" SET "shortCode" = :c WHERE id = :id', { replacements: { c, id: r.id } });
    }
    await queryInterface.addIndex('Posts', ['shortCode'], { name: 'posts_short_code_uniq', unique: true });
    await queryInterface.createTable('PostScanDays', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      postId: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'Posts', key: 'id' }, onDelete: 'CASCADE' },
      // The sale's local date (its time zone).
      day: { type: Sequelize.DATEONLY, allowNull: false },
      count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex('PostScanDays', ['postId', 'day'], { name: 'post_scan_days_uniq', unique: true });
    await queryInterface.createTable('ScanDedupes', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      // UTC day of the salt that produced `hash`; rows of past days are deleted.
      day: { type: Sequelize.STRING(10), allowNull: false },
      hash: { type: Sequelize.STRING(43), allowNull: false },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex('ScanDedupes', ['hash'], { name: 'scan_dedupes_hash_uniq', unique: true });
    await queryInterface.addIndex('ScanDedupes', ['day'], { name: 'scan_dedupes_day_idx' });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('ScanDedupes');
    await queryInterface.dropTable('PostScanDays');
    await queryInterface.removeIndex('Posts', 'posts_short_code_uniq');
    await queryInterface.removeColumn('Posts', 'shortCode');
  },
};
