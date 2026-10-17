const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const schedule = require('../lib/schedule');
const scans = require('../lib/scans');

const PW = 'correct-horse';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

describe('seller dashboard', function () {
  this.timeout(30000);
  let seller, sellerId, buyer, buyer2, admin, postId, endedId, otherPostId, code;
  let now;

  async function user(email, first, last, role) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: last });
    assert.strictEqual(r.status, 201);
    if (role) await models.User.update({ role }, { where: { id: r.body.id } });
    return [agent, r.body.id];
  }
  const view = (agent, id, ip, ua, extra) => {
    let r = (agent || request(app)).post('/post/' + (id || postId) + '/view').set('X-Forwarded-For', ip || '203.0.113.5');
    if (ua !== null) r = r.set('User-Agent', ua === undefined ? PHONE : ua);
    Object.entries(extra || {}).forEach(([k, v]) => { r = r.set(k, v); });
    return r;
  };
  const viewTotal = async () => Number(await models.PostViewDay.sum('count', { where: { postId } })) || 0;
  const dash = async (agent) => (agent || seller).get('/dashboard?tz=America/New_York');

  after(() => { schedule.setClock(null); scans.setClock(null); });

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
    now = new Date('2026-10-23T14:00:00Z'); // Fri 10am New York
    schedule.setClock(() => now); scans.setClock(() => now);
    scans.resetSalt();
    [seller, sellerId] = await user('sam@example.com', 'Sam', 'Seller');
    [buyer] = await user('bea@example.com', 'Bea', 'Buyer');
    [buyer2] = await user('bo@example.com', 'Bo', 'Brown');
    [admin] = await user('ada@example.com', 'Ada', 'Admin', 'admin');
    const p = await seller.post('/post').send({ title: 'Moving sale', street: '30 Henry St', city: 'Brooklyn', state: 'NY', zipCode: '11201',
      schedule: { timeZone: 'America/New_York', days: [{ date: '2026-10-24', start: '08:00', end: '14:00' }, { date: '2026-10-25', start: '09:00', end: '13:00' }] } });
    assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    postId = p.body.id;
    code = (await models.Post.findByPk(postId)).shortCode;
    const e = await seller.post('/post').send({ title: 'Last month sale', street: '2 Clark St', city: 'Brooklyn', state: 'NY', zipCode: '11201',
      schedule: { timeZone: 'America/New_York', days: [{ date: '2026-10-24', start: '08:00', end: '14:00' }] } });
    endedId = e.body.id;
    const o = await buyer.post('/post').send({ title: 'Someone else', street: '5 Pine St', city: 'Brooklyn', state: 'NY', zipCode: '11201' });
    otherPostId = o.body.id;
  });

  it('requires login; only ever shows my own sales, admins included', async () => {
    assert.strictEqual((await request(app).get('/dashboard')).status, 401);
    assert.strictEqual((await request(app).get('/dashboard/sales/' + postId)).status, 401);
    const mine = await dash();
    assert.strictEqual(mine.status, 200);
    assert.deepStrictEqual(mine.body.sales.map((s) => s.id).sort(), [postId, endedId].sort());
    // Another seller's sale is a 404 for everyone, admins too (no user parameter exists).
    assert.strictEqual((await seller.get('/dashboard/sales/' + otherPostId)).status, 404);
    assert.strictEqual((await admin.get('/dashboard/sales/' + postId)).status, 404);
    const adminDash = await admin.get('/dashboard?userId=' + sellerId);
    assert.strictEqual(adminDash.status, 200);
    assert.strictEqual(adminDash.body.sales.length, 0);
    assert.strictEqual((await seller.get('/dashboard/sales/abc')).status, 400);
    // Existing stats rule stays: admins still see scan counts on the print page.
    assert.strictEqual((await admin.get('/post/' + postId + '/print')).status, 200);
  });

  it('counts views like scans: once per visitor per day, never the seller, admins, bots, prefetches or hidden sales', async () => {
    for (let i = 0; i < 3; i++) assert.strictEqual((await view(null, postId, '203.0.113.5')).status, 204);
    assert.strictEqual(await viewTotal(), 1);
    await view(null, postId, '198.51.100.7');
    await view(buyer, postId, '198.51.100.8');
    assert.strictEqual(await viewTotal(), 3);
    await view(seller, postId, '192.0.2.1');
    await view(admin, postId, '192.0.2.2');
    await view(null, postId, '192.0.2.3', 'Googlebot/2.1 (+http://www.google.com/bot.html)');
    await view(null, postId, '192.0.2.4', null);
    await view(null, postId, '192.0.2.5', undefined, { 'Sec-Purpose': 'prefetch' });
    assert.strictEqual((await request(app).get('/post/' + postId + '/view')).status, 404); // GET never counts
    assert.strictEqual(await viewTotal(), 3);
    // A scan of the QR code is a scan, not a view (separate hash space and table).
    await request(app).get('/s/' + code).set('X-Forwarded-For', '203.0.113.5').set('User-Agent', PHONE);
    assert.strictEqual(await viewTotal(), 3);
    assert.strictEqual(Number(await models.PostScanDay.sum('count', { where: { postId } })), 1);
    // Nothing about the visitor is stored.
    const rows = await models.PostViewDay.findAll({ raw: true });
    assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['count', 'createdAt', 'day', 'id', 'postId', 'updatedAt']);
    const dedupe = JSON.stringify(await models.ScanDedupe.findAll({ raw: true }));
    assert.ok(!/203\.0\.113|198\.51|iPhone/.test(dedupe));
    // Hidden sale: 204 but not counted. Missing sale: 404.
    await models.Post.update({ hidden: true }, { where: { id: postId } });
    await view(null, postId, '203.0.113.99');
    assert.strictEqual(await viewTotal(), 3);
    assert.strictEqual((await view(null, 999999)).status, 404);
    // Next day the same visitor counts again, on that local day.
    await models.Post.update({ hidden: false }, { where: { id: postId } });
    now = new Date('2026-10-24T14:00:00Z');
    await view(null, postId, '203.0.113.5');
    const d = (await dash()).body.sales.find((s) => s.id === postId);
    assert.strictEqual(d.totals.views, 4);
    assert.deepStrictEqual(d.series.views.slice(-2), [{ date: '2026-10-23', count: 3 }, { date: '2026-10-24', count: 1 }]);
    assert.strictEqual(d.today.views, 1);
    assert.strictEqual(d.totals.scans, 1);
  });

  it('adds saves, conversations, buyer messages, holds, items and the 14-day overall series', async () => {
    await buyer.put('/saved/' + postId);
    await buyer2.put('/saved/' + postId);
    const items = [];
    for (const name of ['Bike', 'Desk', 'Lamp', 'Rug']) items.push((await seller.post('/post/' + postId + '/items').send({ name, price: '10' })).body.id);
    await seller.put('/post/' + postId + '/items/' + items[3]).send({ sold: true });
    const c1 = (await buyer.post('/conversations').send({ postId })).body;
    await buyer.post('/conversations/' + c1.id + '/messages').send({ body: 'Is the bike still there?' });
    await buyer.post('/conversations/' + c1.id + '/messages').send({ body: 'And the desk?' });
    await seller.post('/conversations/' + c1.id + '/messages').send({ body: 'Yes, both.' });
    const c2 = (await buyer2.post('/conversations').send({ postId })).body;
    await buyer2.post('/conversations/' + c2.id + '/messages').send({ body: 'Hi!' });
    const h1 = await buyer.post('/conversations/' + c1.id + '/holds').send({ itemId: items[0] });
    assert.strictEqual(h1.status, 201, JSON.stringify(h1.body));
    assert.strictEqual((await seller.post('/holds/' + h1.body.id + '/accept').send({})).status, 200);
    assert.strictEqual((await buyer2.post('/conversations/' + c2.id + '/holds').send({ itemId: items[1] })).status, 201);
    // Row timestamps come from the real clock; put them on the test's "today".
    await models.SavedPost.update({ createdAt: now }, { where: {}, silent: true });
    await models.Message.update({ createdAt: now }, { where: {}, silent: true });

    const body = (await dash()).body;
    const s = body.sales.find((x) => x.id === postId);
    assert.strictEqual(s.totals.saves, 2);
    assert.strictEqual(s.today.saves, 2);
    assert.strictEqual(s.conversations, 2);
    assert.strictEqual(s.totals.messages, 3); // buyers' text messages only (not hold events, not mine)
    assert.strictEqual(s.today.messages, 3);
    assert.ok(s.unread >= 1);
    assert.deepStrictEqual(s.holds, { pending: 1, active: 1 });
    assert.deepStrictEqual(s.items, { total: 4, sold: 1, reserved: 1 });
    assert.strictEqual(s.status, 'upcoming');
    assert.strictEqual(body.span, 14);
    assert.strictEqual(body.overall.series.views.length, 14);
    assert.strictEqual(body.overall.series.saves[13].date, '2026-10-23');
    assert.strictEqual(body.overall.series.saves[13].count, 2);
    assert.strictEqual(body.overall.totals.messages, 3);
    assert.strictEqual(body.overall.holdsPending, 1);
    assert.strictEqual(body.overall.itemsSold, 1);
    assert.strictEqual(body.overall.itemsTotal, 4);
    assert.strictEqual(body.overall.sales, 2);
    // Never an email; buyers who saved are not named anywhere.
    const text = JSON.stringify(body);
    assert.ok(!/@example\.com/.test(text));
    assert.ok(!/Bea|Bo /.test(text));

    // Detail: open holds and conversations with "First L." names, no emails.
    const d = (await seller.get('/dashboard/sales/' + postId)).body.sale;
    assert.deepStrictEqual(d.holdList.map((h) => [h.item, h.status, h.buyer]).sort(), [['Bike', 'accepted', 'Bea B.'], ['Desk', 'pending', 'Bo B.']]);
    assert.strictEqual(d.conversationList.length, 2);
    assert.ok(d.conversationList.every((c) => /^B\w+ B\.$/.test(c.buyer)));
    assert.ok(!/@example\.com|Buyer|Brown/.test(JSON.stringify(d)));
    // Expired holds drop out after the sweep.
    now = new Date('2026-10-26T14:00:00Z');
    const later = (await dash()).body.sales.find((x) => x.id === postId);
    assert.deepStrictEqual(later.holds, { pending: 0, active: 0 });
  });

  it('includes ended and hidden sales and shows neighborhood sale membership', async () => {
    const ev = await seller.post('/events').send({ name: 'Heights block sale', areaLabel: 'Brooklyn Heights', lat: 40.6939, lng: -73.9897, radiusMiles: 5,
      joinMode: 'open', schedule: { timeZone: 'America/New_York', days: [{ date: '2026-10-24', start: '08:00', end: '15:00' }] } });
    assert.strictEqual(ev.status, 201, JSON.stringify(ev.body));
    await models.Post.update({ lat: 40.694, lng: -73.99 }, { where: { id: postId } });
    const j = await seller.post('/events/' + ev.body.id + '/join').send({ postId });
    assert.strictEqual(j.status, 201, JSON.stringify(j.body));
    let s = (await dash()).body.sales.find((x) => x.id === postId);
    assert.deepStrictEqual(s.event, { id: ev.body.id, name: 'Heights block sale', status: 'approved', ended: false });
    // A moderator-hidden event isn't shown.
    await models.SaleEvent.update({ hidden: true }, { where: { id: ev.body.id } });
    s = (await dash()).body.sales.find((x) => x.id === postId);
    assert.strictEqual(s.event, null);
    // After the sales end they stay listed, marked ended; hidden sales show as hidden.
    now = new Date('2026-11-02T14:00:00Z');
    await models.Post.update({ hidden: true }, { where: { id: endedId } });
    const body = (await dash()).body;
    const byId = new Map(body.sales.map((x) => [x.id, x]));
    assert.strictEqual(byId.get(postId).status, 'ended');
    assert.strictEqual(byId.get(postId).ended, true);
    assert.strictEqual(byId.get(endedId).status, 'hidden');
    assert.strictEqual(body.overall.ended, 2);
    assert.strictEqual(body.overall.active, 0);
    assert.strictEqual((await seller.get('/dashboard/sales/' + endedId)).status, 200);
  });

  it('a bad time zone falls back to the default; deleting a sale removes its view counts', async () => {
    const r = await seller.get('/dashboard?tz=Not/AZone');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.overall.timeZone);
    await view(null, postId, '203.0.113.5');
    assert.strictEqual(await viewTotal(), 1);
    assert.strictEqual((await seller.delete('/post/' + postId)).status < 300, true);
    assert.strictEqual(await models.PostViewDay.count({ where: { postId } }), 0);
  });
});
