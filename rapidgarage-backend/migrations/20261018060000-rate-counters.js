'use strict';
// Shared rate-limit counters (lib/counters.js, RATE_LIMIT_STORE=db): one row per
// limited key (a SHA-256, never a raw email or IP) with its window.
module.exports = {
  up: async (qi, S) => {
    await qi.createTable('RateCounters', {
      key: { type: S.STRING(64), allowNull: false, primaryKey: true },
      count: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
      resetAt: { type: S.DATE, allowNull: false },
      createdAt: { allowNull: false, type: S.DATE },
      updatedAt: { allowNull: false, type: S.DATE },
    });
    await qi.addIndex('RateCounters', ['resetAt'], { name: 'rate_counters_reset_idx' });
  },
  down: async (qi) => { await qi.dropTable('RateCounters'); },
};
