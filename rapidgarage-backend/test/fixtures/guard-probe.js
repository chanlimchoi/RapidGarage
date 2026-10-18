// Run as a child mocha process by test/test-db-guard.test.js (not part of the
// suite: mocha only loads test/*.js). Prints the database the models use.
const models = require('../../models');
describe('guard probe', () => {
  it('reports the database', () => {
    const { label, describeDb } = require('../../lib/testDbGuard');
    console.log('PROBE_DB=' + label(describeDb(models.sequelize)));
  });
});
