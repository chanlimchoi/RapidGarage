'use strict';
// AI-assisted listing review (lib/aiReview.js): Claude's verdict on a sale's
// public text, for admins only. Nothing is hidden automatically.
module.exports = {
  up: async (qi, S) => {
    await qi.addColumn('Posts', 'aiFlagStatus', { type: S.STRING(16), allowNull: true }); // open | cleared | dismissed | actioned
    await qi.addColumn('Posts', 'aiFlagCategories', { type: S.STRING(200), allowNull: true });
    await qi.addColumn('Posts', 'aiFlagReason', { type: S.STRING(300), allowNull: true });
    await qi.addColumn('Posts', 'aiFlaggedAt', { type: S.DATE, allowNull: true });
    await qi.addColumn('Posts', 'aiReviewHash', { type: S.STRING(64), allowNull: true });
    await qi.addIndex('Posts', ['aiFlagStatus'], { name: 'posts_ai_flag_status_idx' });
  },
  down: async (qi) => {
    await qi.removeIndex('Posts', 'posts_ai_flag_status_idx');
    for (const c of ['aiReviewHash', 'aiFlaggedAt', 'aiFlagReason', 'aiFlagCategories', 'aiFlagStatus']) await qi.removeColumn('Posts', c);
  },
};
