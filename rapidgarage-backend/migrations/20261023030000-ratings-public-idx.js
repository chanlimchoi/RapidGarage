'use strict';
// Public seller ratings count buyer-to-seller ratings only (lib/ratings.js
// PUBLIC), so summaries filter on (rateeId, raterRole).
module.exports = {
  up: async (qi) => { await qi.addIndex('Ratings', ['rateeId', 'raterRole'], { name: 'ratings_ratee_role_idx' }); },
  down: async (qi) => { await qi.removeIndex('Ratings', 'ratings_ratee_role_idx'); },
};
