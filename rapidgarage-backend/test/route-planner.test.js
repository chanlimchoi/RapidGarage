// POST /route: a time-aware route through picked sales (lib/route.js planTimed).
const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const schedule = require('../lib/schedule');
const route = require('../lib/route');

const PW = 'correct-horse';
const C = { lat: 40.6943, lng: -73.9906 };
const north = (mi) => ({ lat: C.lat + mi / 69.0, lng: C.lng });
const DAY = '2026-10-24'; // Saturday; New York is UTC-4
const at = (hhmm) => new Date(DAY + 'T' + hhmm + ':00-04:00');

describe('route planner (time-aware)', function () {
  this.timeout(30000);
  let seller, buyer;

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return agent;
  }
  async function sale(title, mi, start, end, date) {
    const p = await seller.post('/post').send({ title, street: mi + ' Main St', city: 'Brooklyn', zipCode: '11201',
      schedule: { timeZone: 'America/New_York', days: [{ date: date || DAY, start, end }] } });
    assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    await models.Post.update(north(mi), { where: { id: p.body.id } });
    return p.body.id;
  }
  const plan = (agent, body) => agent.post('/route').send(body);

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
    schedule.setClock(() => at('09:30'));
    seller = await user('sam@example.com', 'Sam');
    buyer = await user('bea@example.com', 'Bea');
  });
  after(() => schedule.setClock(null));

  it('orders open sales by distance and times each stop', async () => {
    const far = await sale('Far', 3, '08:00', '16:00');
    const near = await sale('Near', 1, '08:00', '16:00');
    const mid = await sale('Mid', 2, '08:00', '16:00');
    const r = await plan(buyer, { postIds: [far, near, mid], lat: C.lat, lng: C.lng, departAt: at('10:00').toISOString(), dwellMinutes: 15 });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.stops.map((s) => s.post.title), ['Near', 'Mid', 'Far']);
    const s1 = r.body.stops[0];
    assert.strictEqual(s1.legMiles, 1);
    // 1 mi x 1.3 at 20 mph = 3.9 minutes.
    assert.ok(Math.abs(new Date(s1.arriveAt).getTime() - (at('10:00').getTime() + 3.9 * 60000)) < 2000, s1.arriveAt);
    assert.strictEqual(s1.waitMinutes, 0);
    assert.strictEqual(new Date(s1.leaveAt) - new Date(s1.arriveAt), 15 * 60000);
    assert.strictEqual(s1.status, 'open');
    assert.strictEqual(r.body.totalMiles, 3);
    assert.strictEqual(r.body.finishAt, r.body.stops[2].leaveAt);
    assert.deepStrictEqual(r.body.skipped, []);
    // The Maps link: from the start, through the first two, ending at the last.
    const u = new URL(r.body.googleMapsUrl);
    assert.strictEqual(u.searchParams.get('origin'), C.lat + ',' + C.lng);
    assert.ok(u.searchParams.get('destination').startsWith('3 Main St'));
    assert.deepStrictEqual(u.searchParams.get('waypoints').split('|').map((x) => x.split(',')[0]), ['1 Main St', '2 Main St']);
  });

  it('respects opening times: goes to the open sale first instead of waiting at a closed one nearby', async () => {
    const later = await sale('Opens at 1pm', 0.5, '13:00', '17:00');
    const now = await sale('Morning only', 3, '08:00', '12:00');
    const r = await plan(buyer, { postIds: [later, now], lat: C.lat, lng: C.lng, departAt: at('10:00').toISOString() });
    assert.deepStrictEqual(r.body.stops.map((s) => s.post.title), ['Morning only', 'Opens at 1pm']);
    const second = r.body.stops[1];
    assert.strictEqual(new Date(second.leaveAt).getTime() - new Date(second.opensAt).getTime(), 20 * 60000, 'waits for opening, then the default 20 minutes');
    assert.ok(second.waitMinutes > 60);
    assert.strictEqual(second.opensAt, at('13:00').toISOString());
    assert.strictEqual(second.closesAt, at('17:00').toISOString());
  });

  it('lists sales you cannot make (closed by then, ended, no location), hidden ones as unavailable', async () => {
    const ok = await sale('Fine', 1, '08:00', '16:00');
    const soon = await sale('Closes 10:30, far away', 30, '08:00', '10:30');
    schedule.setClock(() => new Date('2026-10-22T12:00:00Z'));
    const ended = await sale('Yesterday', 1, '08:00', '12:00', '2026-10-23');
    schedule.setClock(() => at('09:30'));
    const hidden = await sale('Secret hidden sale', 1, '08:00', '16:00');
    await models.Post.update({ hidden: true }, { where: { id: hidden } });
    const nowhere = await sale('No coordinates', 1, '08:00', '16:00');
    await models.Post.update({ lat: null, lng: null }, { where: { id: nowhere } });
    const r = await plan(request(app), { postIds: [ok, soon, ended, hidden, nowhere, 99999], lat: C.lat, lng: C.lng, departAt: at('10:00').toISOString() });
    assert.strictEqual(r.status, 200, 'works logged out');
    assert.deepStrictEqual(r.body.stops.map((s) => s.post.id), [ok]);
    const why = Object.fromEntries(r.body.skipped.map((s) => [s.postId, s.reason]));
    assert.deepStrictEqual(why, { [soon]: 'closed_by_then', [ended]: 'ended', [hidden]: 'unavailable', [nowhere]: 'no_location', 99999: 'unavailable' });
    assert.ok(!JSON.stringify(r.body).includes('Secret hidden sale'), 'hidden titles never leak');
  });

  it('without a start, begins at the sale that opens first', async () => {
    schedule.setClock(() => at('07:30'));
    const a = await sale('Opens 11', 1, '11:00', '15:00');
    const b = await sale('Opens 9', 4, '09:00', '15:00');
    const r = await plan(buyer, { postIds: [a, b], departAt: at('08:00').toISOString() });
    assert.deepStrictEqual(r.body.stops.map((s) => s.post.title), ['Opens 9', 'Opens 11']);
    assert.strictEqual(r.body.stops[0].legMiles, null);
    assert.strictEqual(r.body.stops[0].arriveAt, at('08:00').toISOString());
    assert.strictEqual(r.body.stops[0].waitMinutes, 60);
    assert.ok(!new URL(r.body.googleMapsUrl).searchParams.get('origin'));
  });

  it('validates the request', async () => {
    const id = await sale('One', 1, '08:00', '16:00');
    const bad = async (body, field) => { const r = await plan(buyer, body); assert.strictEqual(r.status, 400, JSON.stringify(body)); assert.ok(r.body.error.details[field], field); };
    await bad({}, 'postIds');
    await bad({ postIds: [] }, 'postIds');
    await bad({ postIds: Array.from({ length: 11 }, (_, i) => i + 1) }, 'postIds');
    await bad({ postIds: ['x'] }, 'postIds');
    await bad({ postIds: [id], lat: C.lat }, 'location');
    await bad({ postIds: [id], lat: 200, lng: 0 }, 'location');
    await bad({ postIds: [id], departAt: 'soon' }, 'departAt');
    await bad({ postIds: [id], departAt: '2027-06-01T10:00:00Z' }, 'departAt');
    await bad({ postIds: [id], dwellMinutes: 2 }, 'dwellMinutes');
    await bad({ postIds: [id], dwellMinutes: 7.5 }, 'dwellMinutes');
    const r = await plan(buyer, { postIds: [id, id] });
    assert.strictEqual(r.body.stops.length, 1, 'duplicates count once');
    assert.strictEqual(r.body.dwellMinutes, 20);
  });

  it('planTimed: sales without dates count as always open; at most 10 stops', () => {
    const posts = Array.from({ length: 12 }, (_, i) => Object.assign({ id: i + 1, title: 'P' + i, saleDays: [] }, north(i + 1)));
    const r = route.planTimed(posts, C, +at('10:00'), 10);
    assert.strictEqual(r.stops.length, 10);
    assert.deepStrictEqual(r.skipped.map((s) => s.reason), ['too_many', 'too_many']);
    assert.strictEqual(r.stops[0].opensAt, null);
  });
});
