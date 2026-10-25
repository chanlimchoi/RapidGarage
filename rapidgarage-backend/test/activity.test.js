const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const schedule = require('../lib/schedule');
const scans = require('../lib/scans');
const activity = require('../lib/activity');

const PW = 'correct-horse';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

describe('activity counters (lib/activity.js)', function () {
  this.timeout(30000);
  let now, seller, sellerId, buyer, buyerId, buyer2, admin, postId, eventId, wantedId;

  async function user(email, first, role) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    if (role) await models.User.update({ role }, { where: { id: r.body.id } });
    return [agent, r.body.id];
  }
  // A beacon from a visitor (ip/ua identify the visitor for dedupe only).
  const beacon = (agent, body, ip, ua, extra) => {
    let r = (agent || request(app)).post('/activity').set('X-Forwarded-For', ip || '203.0.113.5').set('User-Agent', ua === undefined ? PHONE : ua);
    Object.entries(extra || {}).forEach(([k, v]) => { r = r.set(k, v); });
    return r.send(body);
  };
  const count = async (where) => Number(await models.ActivityDay.sum('count', { where })) || 0;

  after(() => { schedule.setClock(null); scans.setClock(null); activity.setClock(null); });

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
    now = new Date('2026-10-23T14:00:00Z');
    schedule.setClock(() => now); scans.setClock(() => now); activity.setClock(() => now);
    scans.resetSalt();
    [seller, sellerId] = await user('sam@example.com', 'Sam');
    [buyer, buyerId] = await user('bea@example.com', 'Bea');
    [buyer2] = await user('bo@example.com', 'Bo');
    [admin] = await user('ada@example.com', 'Ada', 'admin');
    const p = await seller.post('/post').send({ title: 'Moving sale', street: '30 Henry St', city: 'Brooklyn', state: 'NY', zipCode: '11201',
      schedule: { timeZone: 'America/New_York', days: [{ date: '2026-10-24', start: '08:00', end: '14:00' }] } });
    assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    postId = p.body.id;
    await models.Post.update({ lat: 40.6959, lng: -73.9937 }, { where: { id: postId } });
    const e = await seller.post('/events').send({ name: 'Henry St block sale', description: 'Stoops', areaLabel: 'Brooklyn Heights', lat: 40.694, lng: -73.99,
      radiusMiles: 1, joinMode: 'open', schedule: { timeZone: 'America/New_York', days: [{ date: '2026-10-24', start: '08:00', end: '15:00' }] } });
    assert.strictEqual(e.status, 201, JSON.stringify(e.body));
    eventId = e.body.id;
    const w = await buyer.post('/wanted').send({ title: 'Toddler car seat', keywords: 'car seat', category: 'kids', maxPriceCents: 5000, areaLabel: 'Brooklyn Heights', lat: 40.694, lng: -73.99, radiusMiles: 3, emailEnabled: false });
    assert.strictEqual(w.status, 201, JSON.stringify(w.body));
    wantedId = w.body.id;
  });

  it('counts a beacon once per visitor per day; bots, previews and prefetches never count', async () => {
    const body = { kind: 'directions', targetType: 'post', targetId: postId };
    assert.strictEqual((await beacon(null, body)).status, 204);
    assert.strictEqual((await beacon(null, body)).status, 204, 'a repeat is accepted but not counted');
    assert.strictEqual((await beacon(null, body, '198.51.100.7')).status, 204);
    await beacon(null, body, '198.51.100.8', 'Mozilla/5.0 (compatible; Googlebot/2.1)');
    await beacon(null, body, '198.51.100.9', '');
    await beacon(null, body, '198.51.100.10', PHONE, { 'Sec-Purpose': 'prefetch' });
    assert.strictEqual(await count({ kind: 'directions', targetType: 'post', targetId: postId }), 2);
    // The next local day counts again.
    now = new Date('2026-10-24T14:00:00Z');
    await beacon(null, body);
    const rows = await models.ActivityDay.findAll({ where: { kind: 'directions' }, order: [['day', 'ASC']], raw: true });
    assert.deepStrictEqual(rows.map((r) => [String(r.day).slice(0, 10), r.count]), [['2026-10-23', 2], ['2026-10-24', 1]]);
  });

  it('validates beacons: only app kinds, known pages and visible targets', async () => {
    assert.strictEqual((await beacon(null, { kind: 'nope' })).status, 400);
    assert.strictEqual((await beacon(null, { kind: 'offer', targetType: 'post', targetId: postId })).status, 400, 'server-side kinds cannot be sent by the app');
    assert.strictEqual((await beacon(null, { kind: 'page', page: 'admin' })).status, 400);
    assert.strictEqual((await beacon(null, { kind: 'directions', targetType: 'wanted', targetId: wantedId })).status, 400);
    assert.strictEqual((await beacon(null, { kind: 'directions', targetType: 'post', targetId: 999999 })).status, 404);
    await models.Post.update({ hidden: true }, { where: { id: postId } });
    assert.strictEqual((await beacon(null, { kind: 'directions', targetType: 'post', targetId: postId })).status, 404, 'hidden sales are not counted');
    assert.strictEqual((await beacon(null, { kind: 'page', page: 'home' })).status, 204);
    assert.strictEqual((await beacon(null, { kind: 'bell' })).status, 204);
    assert.strictEqual(await count({ kind: 'page', key: 'home' }), 1);
  });

  it("owners and admins don't inflate their own numbers (except printing and sharing)", async () => {
    await beacon(seller, { kind: 'directions', targetType: 'post', targetId: postId }, '198.51.100.1');
    await beacon(admin, { kind: 'route_add', targetType: 'post', targetId: postId }, '198.51.100.2');
    await beacon(admin, { kind: 'page', page: 'home' }, '198.51.100.2');
    await beacon(buyer, { kind: 'view', targetType: 'user', targetId: buyerId }, '198.51.100.3');
    await beacon(buyer, { kind: 'view', targetType: 'wanted', targetId: wantedId }, '198.51.100.3');
    assert.strictEqual(await count({}), 0);
    await beacon(seller, { kind: 'print', targetType: 'post', targetId: postId }, '198.51.100.1');
    await beacon(seller, { kind: 'share', targetType: 'event', targetId: eventId }, '198.51.100.1');
    await beacon(buyer2, { kind: 'view', targetType: 'event', targetId: eventId }, '198.51.100.4');
    await beacon(buyer2, { kind: 'view', targetType: 'wanted', targetId: wantedId }, '198.51.100.4');
    await beacon(buyer2, { kind: 'view', targetType: 'user', targetId: sellerId }, '198.51.100.4');
    await beacon(buyer2, { kind: 'share', targetType: 'wanted', targetId: wantedId }, '198.51.100.4');
    const rows = await models.ActivityDay.findAll({ attributes: ['kind', 'targetType'], order: [['kind', 'ASC'], ['targetType', 'ASC']], raw: true });
    assert.deepStrictEqual(rows.map((r) => r.kind + ':' + r.targetType),
      ['print:post', 'share:event', 'share:wanted', 'view:event', 'view:user', 'view:wanted']);
  });

  it('stores no visitor data: no user id, IP, user agent or search text', async () => {
    const cols = Object.keys(await models.sequelize.getQueryInterface().describeTable('ActivityDays')).sort();
    assert.deepStrictEqual(cols, ['count', 'createdAt', 'day', 'id', 'key', 'kind', 'targetId', 'targetType', 'updatedAt']);
    await beacon(buyer, { kind: 'page', page: 'search' }, '203.0.113.77');
    // An empty search far from any sale, and one near the Brooklyn sale.
    const far = await buyer.get('/search?lat=47.6&lng=-122.3&radius=5&q=' + encodeURIComponent('secret couch 42')).set('User-Agent', PHONE);
    assert.strictEqual(far.status, 200, JSON.stringify(far.body));
    assert.strictEqual(far.body.total, 0);
    await models.Post.update({ hidden: true }, { where: { id: postId } });
    await buyer2.get('/search?lat=40.70&lng=-73.99&radius=5').set('User-Agent', PHONE);
    const dump = JSON.stringify(await models.ActivityDay.findAll({ raw: true })) + JSON.stringify(await models.ScanDedupe.findAll({ raw: true }));
    for (const bad of ['203.0.113.77', 'iPhone', 'secret', 'couch', 'bea@example.com']) assert.ok(!dump.includes(bad), 'stored ' + bad);
    const empty = await models.ActivityDay.findAll({ where: { kind: 'search_empty' }, order: [['key', 'ASC']], raw: true });
    assert.deepStrictEqual(empty.map((r) => [r.targetType, r.key, r.count]), [['city', '', 1], ['city', 'brooklyn', 1]]);
  });

  it('counts conversations started, holds, offers, bundles, saved searches and route plans on the server', async () => {
    const items = [];
    for (const [name, price] of [['Desk', '40'], ['Lamp', '15'], ['Mug', '5']]) items.push((await seller.post('/post/' + postId + '/items').send({ name, price })).body);
    await seller.put('/post/' + postId).send({ bundleMinItems: 2, bundlePercent: 10 });
    const c = await buyer.post('/conversations').send({ postId }).set('User-Agent', PHONE);
    assert.strictEqual(c.status, 201);
    await buyer.post('/conversations').send({ postId }).set('User-Agent', PHONE); // reopening is not a new start
    assert.strictEqual((await buyer.post('/conversations/' + c.body.id + '/holds').set('User-Agent', PHONE).send({ itemId: items[0].id })).status, 201);
    assert.strictEqual((await buyer.post('/conversations/' + c.body.id + '/holds').set('User-Agent', PHONE).send({ itemId: items[1].id, offerCents: 1000 })).status, 201);
    assert.strictEqual((await buyer.post('/conversations/' + c.body.id + '/bundles').set('User-Agent', PHONE).send({ itemIds: [items[2].id, items[0].id] })).status, 409, 'desk already requested');
    const c2 = await buyer2.post('/conversations').send({ postId }).set('User-Agent', PHONE).set('X-Forwarded-For', '198.51.100.20');
    assert.strictEqual((await buyer2.post('/conversations/' + c2.body.id + '/bundles').set('User-Agent', PHONE).set('X-Forwarded-For', '198.51.100.20').send({ itemIds: [items[2].id, items[0].id] })).status, 201);
    assert.strictEqual((await buyer.post('/alerts').set('User-Agent', PHONE).send({ lat: 40.69, lng: -73.99, radiusMiles: 5, label: 'Near me' })).status < 300, true);
    assert.strictEqual((await request(app).post('/route').set('User-Agent', PHONE).send({ postIds: [postId] })).status, 200);
    const got = {};
    (await models.ActivityDay.findAll({ raw: true })).forEach((r) => { got[r.kind] = (got[r.kind] || 0) + r.count; });
    assert.deepStrictEqual(got, { message_start: 2, hold: 1, offer: 1, bundle: 1, save_search: 1, route_plan: 1 });
  });

  it('admin analytics adds stored activity, top actions, page loads, views/shares and empty searches', async () => {
    // Analytics windows use row creation times, so run on the real clock here.
    now = new Date(); scans.resetSalt();
    await beacon(buyer, { kind: 'directions', targetType: 'post', targetId: postId }, '198.51.100.1');
    await beacon(buyer2, { kind: 'directions', targetType: 'post', targetId: postId }, '198.51.100.2');
    await beacon(buyer, { kind: 'bell' }, '198.51.100.1');
    await beacon(null, { kind: 'page', page: 'home' }, '198.51.100.3');
    await beacon(null, { kind: 'page', page: 'map' }, '198.51.100.3');
    await beacon(null, { kind: 'view', targetType: 'event', targetId: eventId }, '198.51.100.3');
    await beacon(null, { kind: 'share', targetType: 'wanted', targetId: wantedId }, '198.51.100.3');
    const al = await buyer2.post('/alerts').set('User-Agent', PHONE).send({ lat: 40.69, lng: -73.99, radiusMiles: 5 });
    assert.ok(al.status < 300, JSON.stringify(al.body));
    const r = await admin.get('/admin/analytics?days=7');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    for (const k of ['holds', 'offers', 'bundles', 'meetups', 'ratings', 'savedSearches', 'wantedPosts']) assert.ok(r.body.metrics[k] && typeof r.body.metrics[k].total === 'number', k);
    assert.strictEqual(r.body.metrics.wantedPosts.total, 1);
    assert.strictEqual(r.body.metrics.savedSearches.total, 1);
    const a = r.body.activity;
    assert.deepStrictEqual(a.actions.slice(0, 2).map((x) => [x.kind, x.total]), [['directions', 2], ['bell', 1]]);
    assert.ok(a.actions.some((x) => x.kind === 'save_search' && x.total === 1));
    assert.deepStrictEqual(a.pages.map((x) => x.page).sort(), ['home', 'map']);
    assert.strictEqual(a.views.event.total, 1);
    assert.strictEqual(a.shares.wanted.total, 1);
    assert.deepStrictEqual(a.emptySearches, { total: 0, cities: [] });
    assert.strictEqual((await buyer.get('/admin/analytics?days=7')).status, 403);
  });

  it("the seller's sale page shows a funnel: views, saves, messages, holds, sold", async () => {
    const items = [];
    for (const [name, price] of [['Desk', '40'], ['Lamp', '15']]) items.push((await seller.post('/post/' + postId + '/items').send({ name, price })).body);
    await request(app).post('/post/' + postId + '/view').set('User-Agent', PHONE).set('X-Forwarded-For', '198.51.100.1');
    await request(app).post('/post/' + postId + '/view').set('User-Agent', PHONE).set('X-Forwarded-For', '198.51.100.2');
    await buyer.put('/saved/' + postId);
    const c = await buyer.post('/conversations').send({ postId });
    await buyer.post('/conversations/' + c.body.id + '/holds').send({ itemId: items[0].id });
    await seller.put('/post/' + postId + '/items/' + items[1].id).send({ sold: true });
    await beacon(buyer, { kind: 'directions', targetType: 'post', targetId: postId }, '198.51.100.1');
    await beacon(buyer, { kind: 'calendar', targetType: 'post', targetId: postId }, '198.51.100.1');
    const r = await seller.get('/dashboard/sales/' + postId);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.sale.funnel.steps.map((s) => [s.key, s.count]), [['views', 2], ['saves', 1], ['messages', 1], ['holds', 1], ['sold', 1]]);
    assert.strictEqual(r.body.sale.funnel.steps[4].of, 2);
    assert.deepStrictEqual(r.body.sale.funnel.interest, { directions: 1, routeAdds: 0, calendar: 1 });
  });

  it('forgets counts when the sale, wanted post, event or account is deleted; export has profile views', async () => {
    await beacon(buyer2, { kind: 'directions', targetType: 'post', targetId: postId }, '198.51.100.1');
    await beacon(buyer2, { kind: 'view', targetType: 'wanted', targetId: wantedId }, '198.51.100.1');
    await beacon(buyer2, { kind: 'view', targetType: 'user', targetId: buyerId }, '198.51.100.1');
    await beacon(buyer2, { kind: 'view', targetType: 'event', targetId: eventId }, '198.51.100.1');
    await beacon(buyer2, { kind: 'page', page: 'home' }, '198.51.100.1');
    const ex = await buyer.get('/me/export');
    assert.strictEqual(ex.status, 200);
    assert.strictEqual(ex.body.profileViews, 1);
    assert.strictEqual((await seller.delete('/post/' + postId)).status, 204);
    assert.strictEqual(await count({ targetType: 'post' }), 0);
    assert.strictEqual((await buyer.delete('/wanted/' + wantedId)).status, 204);
    assert.strictEqual(await count({ targetType: 'wanted' }), 0);
    assert.strictEqual((await seller.delete('/events/' + eventId)).status < 300, true);
    assert.strictEqual(await count({ targetType: 'event' }), 0);
    const del = await buyer.delete('/me').send({ currentPassword: PW, confirm: 'DELETE' });
    assert.ok(del.status < 300, JSON.stringify(del.body));
    assert.strictEqual(await count({ targetType: 'user' }), 0);
    assert.strictEqual(await count({ kind: 'page' }), 1, 'site-wide page counts are not about anyone');
  });
});
