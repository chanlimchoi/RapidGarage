// Saved searches: alerts with words, the in-app notification list (the bell),
// and re-matching when a sale's text or items change.
const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const schedule = require('../lib/schedule');
const mailer = require('../lib/mailer');
const alerts = require('../lib/alerts');
const digest = require('../lib/weekendDigest');
const notifications = require('../lib/notifications');

const PW = 'correct-horse';
const C = { lat: 40.6943, lng: -73.9906 };
const THU_EVENING = new Date('2026-10-22T22:00:00Z');
const ENV = ['APP_BASE_URL', 'DEFAULT_TIME_ZONE', 'WEEKEND_DIGEST_HOUR', 'ALERT_DIGEST_MINUTES'];

describe('saved searches + notifications', function () {
  this.timeout(30000);
  let seller, buyer, other, sellerId, buyerId, otherId, now;
  const transport = { sendMail: async () => ({ messageId: 'x' }) };

  async function user(email, first, last) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: last });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return [agent, r.body.id];
  }
  async function sale(title, extra, where) {
    const p = await seller.post('/post').send(Object.assign({ title, street: '1 Main St', city: 'Brooklyn', zipCode: '11201',
      schedule: { timeZone: 'America/New_York', days: [{ date: '2026-10-24', start: '08:00', end: '13:00' }] } }, extra));
    assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    await models.Post.update(where || C, { where: { id: p.body.id } });
    await alerts.enqueueForPost(await models.Post.findByPk(p.body.id, { include: [{ model: models.SaleDay, as: 'saleDays' }] }));
    return p.body;
  }
  const search = (agent, body) => agent.post('/alerts').send(Object.assign({ lat: C.lat, lng: C.lng, radiusMiles: 5 }, body));
  const inbox = async (agent) => (await agent.get('/notifications')).body;

  beforeEach(async () => {
    ENV.forEach((k) => delete process.env[k]);
    process.env.APP_BASE_URL = 'https://garage.example';
    process.env.ALERT_DIGEST_MINUTES = '0';
    mailer.setTransport(transport);
    await models.sequelize.sync({ force: true });
    now = new Date('2026-10-20T15:00:00Z');
    schedule.setClock(() => now);
    [seller, sellerId] = await user('sam.seller@example.com', 'Sam', 'Seller');
    [buyer, buyerId] = await user('bea.buyer@example.com', 'Bea', 'Buyer');
    [other, otherId] = await user('oz.other@example.com', 'Oz', 'Other');
  });
  after(() => {
    ENV.forEach((k) => delete process.env[k]);
    mailer.setTransport(null);
    schedule.setClock(null);
  });

  it('saves, edits and clears the words of a search (same rules as the search box)', async () => {
    const r = await search(buyer, { keyword: '  Road   BIKE ', label: 'Bikes' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.keyword, 'Road BIKE');
    assert.strictEqual((await search(buyer, { keyword: 'x'.repeat(61) })).status, 400);
    assert.strictEqual((await search(buyer, { keyword: 5 })).status, 400);
    const u = await buyer.put('/alerts/' + r.body.id).send({ keyword: null });
    assert.strictEqual(u.status, 200, JSON.stringify(u.body));
    assert.strictEqual(u.body.keyword, null);
    assert.strictEqual((await buyer.put('/alerts/' + r.body.id).send({ keyword: 'lamp' })).body.keyword, 'lamp');
  });

  it('notifies in-app only when every word matches the title, description or an unsold item', async () => {
    await search(buyer, { keyword: 'road bike' });
    await sale('Moving sale', { description: 'Furniture and a road bike' });
    await sale('Bike parts', {});
    const box = await inbox(buyer);
    assert.strictEqual(box.results.length, 1);
    assert.strictEqual(box.unread, 1);
    const n = box.results[0];
    assert.strictEqual(n.kind, 'search_match');
    assert.strictEqual(n.post.title, 'Moving sale');
    assert.strictEqual(n.search.keyword, 'road bike');
    // Privacy: the seller is "First L.", and no email address appears anywhere.
    assert.deepStrictEqual(n.post.seller, { id: sellerId, name: 'Sam S.' });
    assert.ok(!/@/.test(JSON.stringify(box)));
    // Instant alerts still queue the email too (one per user and sale).
    assert.strictEqual(await models.AlertNotification.count({ where: { userId: buyerId } }), 1);
    // The nav badge carries the count.
    assert.strictEqual((await buyer.get('/conversations/unread')).body.notifications, 1);
    assert.deepStrictEqual((await inbox(other)).results, []);
  });

  it('re-matches when an item or the text changes, without telling anyone twice', async () => {
    await search(buyer, { keyword: 'kayak' });
    const p = await sale('Garage clean-out', {});
    assert.strictEqual((await inbox(buyer)).results.length, 0);
    assert.strictEqual((await seller.post('/post/' + p.id + '/items').send({ name: 'Blue kayak', price: '120' })).status, 201);
    await alerts.idle();
    assert.strictEqual((await inbox(buyer)).results.length, 1);
    // Another item and an edit that also match: still one notification and one email row.
    await seller.post('/post/' + p.id + '/items').send({ name: 'Kayak paddle', price: '20' });
    await seller.put('/post/' + p.id).send({ title: 'Kayak and garage clean-out' });
    await alerts.idle();
    assert.strictEqual(await models.Notification.count({ where: { userId: buyerId } }), 1);
    assert.strictEqual(await models.AlertNotification.count({ where: { userId: buyerId } }), 1);
    // Sold items don't count: a new sale whose only kayak is sold doesn't match.
    const q = await sale('Second sale', {});
    await seller.post('/post/' + q.id + '/items').send({ name: 'Old kayak', price: '50', sold: true });
    await alerts.idle();
    assert.strictEqual(await models.Notification.count({ where: { userId: buyerId } }), 1);
  });

  it('a text edit only re-checks searches with words (area-only searches were matched at create time)', async () => {
    const p = await sale('First', {});
    await search(buyer, {});
    await seller.put('/post/' + p.id).send({ title: 'First, renamed' });
    await alerts.idle();
    assert.strictEqual(await models.Notification.count(), 0);
    assert.strictEqual(await models.AlertNotification.count(), 0);
  });

  it('weekly searches get in-app matches but no instant email; the digest honours the words', async () => {
    await search(buyer, { keyword: 'lamp', frequency: 'weekly' });
    await sale('Lamps and rugs', { description: 'A brass lamp' });
    await sale('Tools only', {});
    assert.strictEqual((await inbox(buyer)).results.length, 1);
    assert.strictEqual(await models.AlertNotification.count(), 0);
    const alert = await models.SaleAlert.findOne({ where: { userId: buyerId } });
    const found = await digest.salesFor(alert, THU_EVENING);
    assert.deepStrictEqual(found.map((x) => x.post.title), ['Lamps and rugs']);
  });

  it('respects blocks and hidden sales, both when matching and when reading', async () => {
    await search(buyer, {});
    await search(other, {});
    await models.UserBlock.create({ blockerId: otherId, blockedId: sellerId });
    const p = await sale('Everything must go', {});
    assert.strictEqual((await inbox(other)).results.length, 0, 'blocked: never notified');
    assert.strictEqual((await inbox(buyer)).results.length, 1);
    // Blocked afterwards: the notification disappears from the list and the badge.
    await models.UserBlock.create({ blockerId: sellerId, blockedId: buyerId });
    assert.strictEqual((await inbox(buyer)).results.length, 0);
    assert.strictEqual((await buyer.get('/conversations/unread')).body.notifications, 0);
    await models.UserBlock.destroy({ where: {} });
    assert.strictEqual((await inbox(buyer)).results.length, 1);
    await models.Post.update({ hidden: true }, { where: { id: p.id } });
    assert.strictEqual((await inbox(buyer)).results.length, 0, 'hidden by a moderator');
  });

  it('marks seen (mine only), validates ids, and needs login', async () => {
    await search(buyer, {});
    await search(other, {});
    await sale('One', {});
    await sale('Two', {}, { lat: C.lat + 0.01, lng: C.lng });
    const mine = (await inbox(buyer)).results;
    const theirs = (await inbox(other)).results;
    assert.strictEqual(mine.length, 2);
    assert.strictEqual((await request(app).get('/notifications')).status, 401);
    assert.strictEqual((await buyer.post('/notifications/seen').send({ ids: 'all' })).status, 400);
    assert.strictEqual((await buyer.post('/notifications/seen').send({ ids: ['x'] })).status, 400);
    // Someone else's id is ignored.
    assert.strictEqual((await buyer.post('/notifications/seen').send({ ids: [theirs[0].id] })).body.marked, 0);
    assert.strictEqual((await buyer.post('/notifications/seen').send({ ids: [mine[0].id] })).body.marked, 1);
    assert.strictEqual((await inbox(buyer)).unread, 1);
    assert.strictEqual((await buyer.post('/notifications/seen').send({})).body.marked, 1);
    assert.strictEqual((await inbox(buyer)).unread, 0);
    assert.strictEqual((await inbox(other)).unread, 2);
  });

  it('is in the data export and goes away with the account; old ones are pruned', async () => {
    await search(buyer, {});
    await sale('One', {});
    const ex = await buyer.get('/me/export');
    assert.strictEqual(ex.status, 200);
    assert.strictEqual(ex.body.notifications.length, 1);
    const n = await models.Notification.findOne();
    await models.sequelize.query('UPDATE "Notifications" SET "createdAt" = :d WHERE id = :id', { replacements: { d: new Date(Date.now() - 61 * 86400000), id: n.id } });
    assert.strictEqual(await notifications.prune(new Date()), 1);
    await sale('Two', {}, { lat: C.lat + 0.01, lng: C.lng });
    assert.strictEqual(await models.Notification.count({ where: { userId: buyerId } }), 1);
    assert.strictEqual((await buyer.delete('/me').send({ currentPassword: PW, confirm: 'DELETE' })).status, 204);
    assert.strictEqual(await models.Notification.count({ where: { userId: buyerId } }), 0);
  });

  it('a seller never gets notified about their own sale', async () => {
    await search(seller, {});
    await sale('Mine', {});
    assert.strictEqual((await inbox(seller)).results.length, 0);
  });
});
