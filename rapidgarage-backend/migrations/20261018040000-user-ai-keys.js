'use strict';
// Bring-your-own Anthropic key (lib/userAiKey.js): AES-256-GCM ciphertext
// bound to the user's row (lib/secretBox.js v2), last 4 characters for display.
module.exports = {
  up: async (qi, S) => {
    await qi.addColumn('Users', 'aiKeyEncrypted', { type: S.TEXT, allowNull: true });
    await qi.addColumn('Users', 'aiKeyLast4', { type: S.STRING(4), allowNull: true });
    await qi.addColumn('Users', 'aiKeySetAt', { type: S.DATE, allowNull: true });
  },
  down: async (qi) => {
    await qi.removeColumn('Users', 'aiKeySetAt');
    await qi.removeColumn('Users', 'aiKeyLast4');
    await qi.removeColumn('Users', 'aiKeyEncrypted');
  },
};
