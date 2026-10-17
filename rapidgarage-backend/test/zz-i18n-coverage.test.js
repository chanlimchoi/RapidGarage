// Runs last (mocha loads files alphabetically): every API message the whole
// suite produced must exist in every language catalog (lib/i18n.js records
// misses in test mode). Add new sentences to the translation table.
const assert = require('assert');
const i18n = require('../lib/i18n');

describe('i18n coverage (all messages seen during the test run)', () => {
  it('has a translation for every message sent', () => {
    assert.deepStrictEqual([...i18n._misses].sort(), []);
  });
});
