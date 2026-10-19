'use strict';
// Post-sale summary email (lib/sellerTools.js): sent once per sale after it
// ends. Sales that already ended are marked as sent so the upgrade doesn't
// email everyone about old sales.
module.exports = {
  up: async (qi, S) => {
    await qi.addColumn('Posts', 'summarySentAt', { type: S.DATE, allowNull: true });
    await qi.sequelize.query('UPDATE "Posts" SET "summarySentAt" = CURRENT_TIMESTAMP WHERE "endDate" IS NOT NULL AND "endDate" < CURRENT_TIMESTAMP');
  },
  down: async (qi) => { await qi.removeColumn('Posts', 'summarySentAt'); },
};
