const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const schedule = require('../lib/schedule');
const mailer = require('../lib/mailer');
const alerts = require('../lib/alerts');
const digest = require('../lib/weekendDigest');

const PW = 'correct-horse';
const ENV = ['APP_BASE_URL', 'DEFAULT_TIME_ZONE', 'WEEKEND_DIGEST_HOUR', 'ALERT_DIGEST_MINUTES'];
const C = { lat: 40.6943, lng: -73.9906 };
// Thursday 2026-10-22, 6pm New York.
const THU_EVENING = new Date('2026-10-22T22:00:00Z');

describe('weekend digest (weekly sale alerts)', function () {
  this.timeout(30000);
  let seller, buyer, sent, now;
  const transport = { sendMail: async (msg) => { sent.push(msg); return { messageId: 'x' }; } };

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    return agent;
  }
  async function sale(title, date, where, extra) {
    const p = await seller.post('/post').send(Object.assign({ title, street: '1 Main St', city: 'Brooklyn', zipCode: '11201',
      schedule: { timeZone: 'America/New_York', days: [{ date, start: '08:00', end: '13:00' }] } }, extra));
    assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    await models.Post.update(where || C, { where: { id: p.body.id } });
    // No geocoding in tests: match alerts now that it has coordinates.
    await alerts.enqueueForPost(await models.Post.findByPk(p.body.id, { include: [{ model: models.SaleDay, as: 'saleDays' }] }));
    return p.body;
  }

  beforeEach(async () => {
    ENV.forEach((k) => delete process.env[k]);
    process.env.APP_BASE_URL = 'https://garage.example';
    process.env.ALERT_DIGEST_MINUTES = '0';
    sent = [];
    mailer.setTransport(transport);
    await models.sequelize.sync({ force: true });
    now = new Date('2026-10-20T15:00:00Z'); // Tuesday
    schedule.setClock(() => now);
    seller = await user('sam@example.com', 'Sam');
    buyer = await user('bea@example.com', 'Bea');
  });
  after(() => {
    ENV.forEach((k) => delete process.env[k]);
    mailer.setTransport(null);
    schedule.setClock(null);
  });

  it('weekly alerts get one Thursday email with that weekend\'s nearby sales, not instant emails', async () => {
    const a = await buyer.post('/alerts').send({ lat: C.lat, lng: C.lng, radiusMiles: 5, frequency: 'weekly' });
    assert.strictEqual(a.status, 201, JSON.stringify(a.body));
    assert.strictEqual(a.body.frequency, 'weekly');
    await sale('Saturday sale', '2026-10-24');
    await sale('Sunday sale', '2026-10-25', { lat: C.lat + 0.02, lng: C.lng });
    await sale('Wednesday sale', '2026-10-28');
    await sale('Far away', '2026-10-24', { lat: C.lat + 1, lng: C.lng });
    await sale('Pricey', '2026-10-24', null, { priceMin: 100, priceMax: 200 });
    await alerts.idle();
    // Instant alert emails never queue for a weekly alert.
    assert.strictEqual(await models.AlertNotification.count(), 0);

    // Too early in the week: nothing.
    assert.deepStrictEqual(await digest.processWeekly(new Date('2026-10-22T15:00:00Z')), { reason: 'not_now' });
    const r = await digest.processWeekly(THU_EVENING);
    assert.deepStrictEqual(r, { emails: 1, empty: 0 });
    assert.strictEqual(sent.length, 1);
    const mail = sent[0];
    assert.strictEqual(mail.to, 'bea@example.com');
    assert.strictEqual(mail.subject, 'This weekend: 3 garage sales near you');
    // Nearest first, weekend only, inside the radius; the alert's unsubscribe link.
    const order = ['Saturday sale', 'Pricey', 'Sunday sale'].map((t) => mail.text.indexOf(t));
    assert.ok(order.every((i) => i > 0), mail.text);
    assert.ok(order[0] < order[2], 'nearest first');
    assert.ok(!mail.text.includes('Wednesday sale') && !mail.text.includes('Far away'));
    assert.ok(mail.headers['List-Unsubscribe']);
    // Once per weekend.
    assert.deepStrictEqual(await digest.processWeekly(new Date('2026-10-23T15:00:00Z')), { emails: 0, empty: 0 });
    assert.strictEqual(sent.length, 1);
  });

  it('respects price filters, sends nothing when there is nothing, and retries a failed send', async () => {
    await buyer.post('/alerts').send({ lat: C.lat, lng: C.lng, radiusMiles: 5, frequency: 'weekly', maxPrice: 20 });
    await sale('Pricey', '2026-10-24', null, { priceMin: 100, priceMax: 200 });
    assert.deepStrictEqual(await digest.processWeekly(THU_EVENING), { emails: 0, empty: 1 });
    assert.strictEqual(sent.length, 0);

    await models.SaleAlert.update({ weeklySentAt: null, maxPrice: null }, { where: {} });
    mailer.setTransport({ sendMail: async () => { throw Object.assign(new Error('down'), { code: 'ECONNECTION' }); } });
    assert.deepStrictEqual(await digest.processWeekly(THU_EVENING), { emails: 0, empty: 0 });
    assert.strictEqual((await models.SaleAlert.findOne()).weeklySentAt, null, 'released for the next pass');
    mailer.setTransport(transport);
    assert.deepStrictEqual(await digest.processWeekly(new Date(THU_EVENING.getTime() + 600000)), { emails: 1, empty: 0 });
  });

  it('instant stays the default; switching an alert to weekly and back works; bad values are rejected', async () => {
    const a = await buyer.post('/alerts').send({ lat: C.lat, lng: C.lng, radiusMiles: 5 });
    assert.strictEqual(a.body.frequency, 'instant');
    assert.strictEqual((await buyer.put('/alerts/' + a.body.id).send({ frequency: 'daily' })).status, 400);
    assert.strictEqual((await buyer.put('/alerts/' + a.body.id).send({ frequency: 'weekly' })).body.frequency, 'weekly');
    await sale('Saturday sale', '2026-10-24');
    await alerts.idle();
    assert.strictEqual(await models.AlertNotification.count(), 0);
    await buyer.put('/alerts/' + a.body.id).send({ frequency: 'instant' });
    await sale('Another', '2026-10-24');
    await alerts.idle();
    assert.strictEqual(await models.AlertNotification.count(), 1);
  });

  it('the sending window follows the site time zone', () => {
    assert.strictEqual(digest.inWindow(new Date('2026-10-22T20:59:00Z')), false); // Thu 4:59pm NY
    assert.strictEqual(digest.inWindow(new Date('2026-10-22T21:00:00Z')), true); // Thu 5pm
    assert.strictEqual(digest.inWindow(new Date('2026-10-23T12:00:00Z')), true); // Fri
    assert.strictEqual(digest.inWindow(new Date('2026-10-24T17:00:00Z')), false); // Sat 1pm
    process.env.WEEKEND_DIGEST_HOUR = '9';
    assert.strictEqual(digest.inWindow(new Date('2026-10-22T13:00:00Z')), true); // Thu 9am
  });
});
