'use strict';
// Last-hour markdowns (lib/markdown.js): "X% off from HH:MM" on a sale.
module.exports = {
  up: async (qi, S) => {
    await qi.addColumn('Posts', 'markdownPercent', { type: S.INTEGER, allowNull: true });
    await qi.addColumn('Posts', 'markdownFrom', { type: S.STRING(5), allowNull: true });
    await qi.addColumn('Posts', 'markdownLastDay', { type: S.BOOLEAN, allowNull: false, defaultValue: false });
  },
  down: async (qi) => {
    await qi.removeColumn('Posts', 'markdownLastDay');
    await qi.removeColumn('Posts', 'markdownFrom');
    await qi.removeColumn('Posts', 'markdownPercent');
  },
};
