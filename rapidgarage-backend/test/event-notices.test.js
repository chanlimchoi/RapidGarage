const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const alerts = require('../lib/alerts');

const PW = 'correct-horse';
const C = { lat: 40.758, lng: -73.9855 };
const H = 3600000;
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
function fakeProvider(address) {
  if (/hell's kitchen/i.test(address)) return Promise.resolve({ status: 'ok', lat: C.lat, lng: C.lng });
  const m = /([\d.]+) mi St/.exec(address);
  if (!m) return Promise.resolve({ status: 'not_found' });
  return Promise.resolve({ status: 'ok', lat: C.lat + Number(m[1]) / 69.0, lng: C.lng });
}

describe('neighborhood sale notices in the bell', function () {
  this.timeout(30000);
  let org, orgId, sam, samId, bea, d1;
  const flush = () => new Promise((r) => setTimeout(r, 50));
  async function user(email, firstName, lastName) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName, lastName });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return [agent, r.body.id];
  }
  const sched = (days) => ({ timeZone: 'America/New_York', days: days.map((date) => ({ date, start: '08:00', end: '16:00' })) });
  async function makeEvent(agent, extra) {
    const r = await agent.post('/events').send(Object.assign({ name: 'Elm Street Block Sale', areaLabel: "Hell's Kitchen, New York", radiusMiles: 1, joinMode: 'approval', schedule: sched([d1]) }, extra));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return r.body;
  }
  async function sale(agent, title) {
    const r = await agent.post('/post').send({ title, street: '0.2 mi St', city: 'New York', state: 'NY', zipCode: '10036', schedule: sched([d1]) });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    await alerts.idle();
    return r.body;
  }
  const bell = async (agent) => {
    const r = await agent.get('/notifications');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const list = Array.isArray(r.body) ? r.body : r.body.notifications || r.body.results || [];
    return list.filter((n) => n.kind.indexOf('event_') === 0);
  };

  beforeEach(async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-server-key';
    geo.setProvider(fakeProvider);
    geo.resetRateLimits();
    await models.sequelize.sync({ force: true });
    d1 = ymd(new Date(Date.now() + 24 * H));
    [org, orgId] = await user('olga@example.com', 'Olga', 'Ortiz');
    [sam, samId] = await user('sam@example.com', 'Sam', 'Stone');
    [bea] = await user('bea@example.com', 'Bea', 'Banks');
  });
  after(() => { delete process.env.GOOGLE_MAPS_API_KEY; geo.setProvider(null); });

  it('organizer hears about a join request; seller hears about the approval', async () => {
    const ev = await makeEvent(org);
    const post = await sale(sam, 'Sam\'s toys');
    assert.strictEqual((await sam.post('/events/' + ev.id + '/join').send({ postId: post.id })).status, 201);
    await flush();
    const o = await bell(org);
    assert.strictEqual(o.length, 1);
    assert.strictEqual(o[0].kind, 'event_join');
    assert.deepStrictEqual(o[0].data, { eventId: ev.id, eventName: 'Elm Street Block Sale' });
    assert.strictEqual(o[0].post.seller.name, 'Sam S.');
    assert.ok(!/@/.test(JSON.stringify(o)), 'no emails');
    assert.strictEqual((await org.post('/events/' + ev.id + '/participants/' + post.id + '/approve').send({})).status, 200);
    await flush();
    const s = await bell(sam);
    assert.deepStrictEqual(s.map((n) => n.kind), ['event_approved']);
    assert.strictEqual((await bell(bea)).length, 0);
  });

  it('open events say "joined"; decline and removal tell the seller; the seller leaving tells nobody', async () => {
    const ev = await makeEvent(org, { joinMode: 'open' });
    const post = await sale(sam, 'Open one');
    await sam.post('/events/' + ev.id + '/join').send({ postId: post.id });
    await flush();
    assert.deepStrictEqual((await bell(org)).map((n) => n.kind), ['event_joined']);
    assert.strictEqual((await org.delete('/events/' + ev.id + '/participants/' + post.id)).status, 204);
    await flush();
    const s = await bell(sam);
    assert.deepStrictEqual(s.map((n) => [n.kind, n.data.declined]), [['event_removed', false]]);

    const ev2 = await makeEvent(org, { name: 'Oak Ave Sale' });
    await sam.post('/events/' + ev2.id + '/join').send({ postId: post.id });
    await org.delete('/events/' + ev2.id + '/participants/' + post.id);
    await sam.post('/events/' + ev2.id + '/join').send({ postId: post.id });
    await sam.delete('/events/' + ev2.id + '/participants/' + post.id);
    await flush();
    const after = await bell(sam);
    assert.deepStrictEqual(after.filter((n) => n.data.eventId === ev2.id).map((n) => [n.kind, n.data.declined]), [['event_removed', true]]);
  });

  it('hidden events drop out of the bell for the seller, and blocks suppress notices', async () => {
    const ev = await makeEvent(org);
    const post = await sale(sam, 'Toys');
    await sam.post('/events/' + ev.id + '/join').send({ postId: post.id });
    await org.post('/events/' + ev.id + '/participants/' + post.id + '/approve').send({});
    await flush();
    assert.strictEqual((await bell(sam)).length, 1);
    await models.SaleEvent.update({ hidden: true }, { where: { id: ev.id } });
    assert.strictEqual((await bell(sam)).length, 0);
    assert.strictEqual((await bell(org)).length, 1, 'the organizer still sees their own hidden event');
    await models.SaleEvent.update({ hidden: false }, { where: { id: ev.id } });
    await models.UserBlock.create({ blockerId: orgId, blockedId: samId });
    assert.strictEqual((await bell(sam)).length, 0);
    const n = await models.Notification.count();
    const ev2 = await makeEvent(org, { name: 'Second' });
    const post2 = await sale(bea, 'Bea sale');
    await models.UserBlock.create({ blockerId: orgId, blockedId: (await models.User.findOne({ where: { email: 'bea@example.com' } })).id });
    await bea.post('/events/' + ev2.id + '/join').send({ postId: post2.id });
    await flush();
    assert.strictEqual(await models.Notification.count(), n, 'blocked: no join request notice');
  });
});
