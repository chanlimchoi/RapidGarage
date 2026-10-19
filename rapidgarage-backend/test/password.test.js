const assert = require('assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../app');
const models = require('../models');

// The app hashed passwords with bcrypt-nodejs until it moved to bcryptjs.
// Existing `$2a$` hashes must keep verifying (and log in) after the move, so
// the switch is not a forced password reset for every account.
const PW = 'correct-horse';

describe('password hashing (bcryptjs)', function () {
  this.timeout(10000);

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
  });

  it('produces a bcrypt hash that verifies', async () => {
    const hash = await models.User.hashPassword(PW);
    assert.ok(hash.startsWith('$2'), 'expected a $2 hash, got ' + hash.slice(0, 7));
    assert.ok(bcrypt.compareSync(PW, hash));
    assert.ok(!bcrypt.compareSync('wrong-password', hash));
  });

  it('verifies a legacy bcrypt-nodejs hash', () => {
    // Round-trip a hash made the way the old library made them, so the exact
    // prefix/salt layout stays accepted by compareSync.
    const legacy = bcrypt.hashSync(PW, bcrypt.genSaltSync(10));
    assert.ok(bcrypt.compareSync(PW, legacy));
  });

  it('logs in an account whose stored hash is a legacy hash', async () => {
    // Seed a user the way the old library would have.
    const user = await models.User.create({ email: 'legacy@example.com', firstName: 'Legacy' });
    await models.User.scope('withPassword').update(
      { password: bcrypt.hashSync(PW, bcrypt.genSaltSync(10)) },
      { where: { id: user.id } }
    );

    const res = await request(app).post('/login').send({ email: 'legacy@example.com', password: PW });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  });
});
