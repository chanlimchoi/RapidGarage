'use strict';
// Make an offer (lib/holds.js): a hold request can carry a price offer, and the
// seller can counter. Messages keep the amount of each step (holdCents).
// Weekend digest (lib/weekendDigest.js): a sale alert can be weekly instead of
// instant; weeklySentAt is when its last digest went out.
module.exports = {
  up: async (qi, S) => {
    await qi.addColumn('ItemHolds', 'offerCents', { type: S.INTEGER, allowNull: true });
    await qi.addColumn('ItemHolds', 'counterCents', { type: S.INTEGER, allowNull: true });
    await qi.addColumn('Messages', 'holdCents', { type: S.INTEGER, allowNull: true });
    await qi.addColumn('SaleAlerts', 'frequency', { type: S.STRING(8), allowNull: false, defaultValue: 'instant' });
    await qi.addColumn('SaleAlerts', 'weeklySentAt', { type: S.DATE, allowNull: true });
  },
  down: async (qi) => {
    await qi.removeColumn('SaleAlerts', 'weeklySentAt');
    await qi.removeColumn('SaleAlerts', 'frequency');
    await qi.removeColumn('Messages', 'holdCents');
    await qi.removeColumn('ItemHolds', 'counterCents');
    await qi.removeColumn('ItemHolds', 'offerCents');
  },
};
