const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const alerts = require('../lib/alerts');
const schedule = require('../lib/schedule');
const eve = require('../lib/eveReminders');
const { datesFor } = require('../controllers/saleCalendar');

const PW = 'correct-horse';
const C = { lat: 40.758, lng: -73.9855 };
const TZ = 'America/New_York';
function fakeProvider(address) {
  const m = /([\d.]+) mi St/.exec(address);
  if (!m) return Promise.resolve({ status: 'not_found' });
  return Promise.resolve({ status: 'ok', lat: C.lat + Number(m[1]) / 69.0, lng: C.lng });
}

describe('"This weekend" calendar and night-before reminders', function () {
  this.timeout(30000);
  let sam, bea, beaId, tom, now;
  // Wednesday 2026-11-04, 10:00 New York.
  const WED = '2026-11-04';
  const at = (date, hhmm) => { now = schedule.zonedToUtc(date, hhmm, TZ); };

  async function user(email, firstName, lastName) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName, lastName });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return [agent, r.body.id];
  }
  async function sale(agent, title, miles, days, extra) {
    const r = await agent.post('/post').send(Object.assign({ title, description: 'Stuff', street: miles + ' mi St', city: 'New York', state: 'NY', zipCode: '10036',
      schedule: { timeZone: TZ, days: days.map(([date, start, end]) => ({ date, start, end })) } }, extra || {}));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return r.body;
  }
  const cal = (agent, q) => agent.get('/calendar').query(Object.assign({ tz: TZ }, q));
  const titles = (day) => day.sales.map((s) => s.title);

  let A, B, Cs, D;
  beforeEach(async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-server-key';
    geo.setProvider(fakeProvider);
    geo.resetRateLimits();
    at(WED, '10:00');
    schedule.setClock(() => now);
    await models.sequelize.sync({ force: true });
    [sam] = await user('sam@example.com', 'Sam', 'Stone');
    [bea, beaId] = await user('bea@example.com', 'Bea', 'Banks');
    [tom] = await user('tom@example.com', 'Tom', 'Tran');
    A = await sale(sam, 'Saturday lamps', 1, [['2026-11-07', '08:00', '12:00']], { description: 'Lamps and rugs' });
    B = await sale(sam, 'Fri-Sat moving sale', 2, [['2026-11-06', '15:00', '18:00'], ['2026-11-07', '07:00', '11:00']]);
    Cs = await sale(sam, 'Thursday books', 1, [['2026-11-05', '09:00', '13:00']]);
    D = await sale(tom, 'Far away sale', 60, [['2026-11-07', '09:00', '12:00']]);
    await alerts.idle();
  });
  after(() => { delete process.env.GOOGLE_MAPS_API_KEY; geo.setProvider(null); schedule.setClock(null); delete process.env.EVE_REMINDER_HOUR; });

  it('weekend view: Friday to Sunday of this weekend, grouped by the sale\'s local date, nearby only', async () => {
    assert.deepStrictEqual(datesFor('weekend', '2026-11-04'), ['2026-11-06', '2026-11-07', '2026-11-08']);
    assert.deepStrictEqual(datesFor('weekend', '2026-11-08'), ['2026-11-06', '2026-11-07', '2026-11-08'], 'on Sunday: this weekend');
    const r = await cal(request(app), { lat: C.lat, lng: C.lng, radius: 10 });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.view, 'weekend');
    assert.deepStrictEqual(r.body.dates, ['2026-11-06', '2026-11-07', '2026-11-08']);
    assert.deepStrictEqual(r.body.days.map(titles), [['Fri-Sat moving sale'], ['Fri-Sat moving sale', 'Saturday lamps'], []]);
    const s = r.body.days[1].sales[1];
    assert.strictEqual(s.start, '08:00');
    assert.strictEqual(s.distanceMiles, 1);
    assert.strictEqual(s.saved, false);
    assert.ok(!/@/.test(JSON.stringify(r.body)), 'no emails');
  });

  it('day and week views, and no location = every upcoming sale', async () => {
    const day = await cal(request(app), { view: 'day', date: '2026-11-05', lat: C.lat, lng: C.lng });
    assert.deepStrictEqual(day.body.days.map(titles), [['Thursday books']]);
    const week = await cal(request(app), { view: 'week', lat: C.lat, lng: C.lng });
    assert.strictEqual(week.body.dates.length, 7);
    assert.deepStrictEqual(week.body.days.slice(0, 4).map(titles), [[], ['Thursday books'], ['Fri-Sat moving sale'], ['Fri-Sat moving sale', 'Saturday lamps']]);
    const all = await cal(request(app), {});
    assert.deepStrictEqual(all.body.days[1].sales.map((x) => x.title), ['Fri-Sat moving sale', 'Saturday lamps', 'Far away sale']);
    assert.strictEqual(all.body.mode, 'all');
  });

  it('leaves out ended days, hidden sales and blocked sellers', async () => {
    at('2026-11-06', '18:30');
    let r = await cal(request(app), { lat: C.lat, lng: C.lng });
    assert.deepStrictEqual(r.body.days.map(titles), [[], ['Fri-Sat moving sale', 'Saturday lamps'], []], 'Friday\'s day ended');
    await models.Post.update({ hidden: true }, { where: { id: A.id } });
    r = await cal(request(app), { lat: C.lat, lng: C.lng });
    assert.deepStrictEqual(r.body.days[1].sales.map((x) => x.title), ['Fri-Sat moving sale']);
    await models.UserBlock.create({ blockerId: beaId, blockedId: (await models.User.findOne({ where: { email: 'sam@example.com' } })).id });
    r = await cal(bea, {});
    assert.deepStrictEqual(r.body.days[1].sales.map((x) => x.title), ['Far away sale']);
  });

  it('a saved search drives the calendar (place, radius, words), only for its owner', async () => {
    const al = await bea.post('/alerts').send({ lat: C.lat, lng: C.lng, radiusMiles: 5, keyword: 'lamps', label: 'Lamps' });
    assert.ok(al.status < 300, JSON.stringify(al.body));
    const r = await cal(bea, { alert: al.body.id });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.alert, { id: al.body.id, label: 'Lamps', keyword: 'lamps' });
    assert.deepStrictEqual(r.body.days.map(titles), [[], ['Saturday lamps'], []]);
    assert.strictEqual((await cal(tom, { alert: al.body.id })).status, 404);
    assert.strictEqual((await cal(request(app), { alert: al.body.id })).status, 401);
  });

  it('shows saved and "remind me" state, and rejects bad input', async () => {
    assert.ok((await bea.put('/saved/' + A.id + '/reminder').send({ on: true })).status < 300);
    const r = await cal(bea, { lat: C.lat, lng: C.lng });
    const a = r.body.days[1].sales.find((x) => x.postId === A.id);
    assert.deepStrictEqual([a.saved, a.remind, a.own], [true, true, false]);
    const mine = await cal(sam, { lat: C.lat, lng: C.lng });
    assert.strictEqual(mine.body.days[1].sales.find((x) => x.postId === A.id).own, true);
    for (const q of [{ view: 'month' }, { date: '2026-13-01' }, { radius: 7 }, { lat: 'x', lng: 1 }, { alert: 'abc' }]) {
      assert.strictEqual((await cal(request(app), q)).status, 400, JSON.stringify(q));
    }
  });

  it('night-before reminder: in the bell from 19:00 the evening before, once, first day of a run only, per-person switch', async () => {
    const [ada] = await user('ada@example.com', 'Ada', 'Ames');
    await bea.put('/saved/' + A.id + '/reminder').send({ on: true });
    await bea.put('/saved/' + B.id + '/reminder').send({ on: true });
    await ada.put('/saved/' + A.id + '/reminder').send({ on: true });
    assert.strictEqual((await ada.put('/reminders/settings').send({ nightBefore: false })).body.nightBefore, false);
    assert.strictEqual((await bea.get('/reminders/settings')).body.nightBefore, true);

    at('2026-11-05', '18:59');
    assert.strictEqual((await eve.processDue(now)).created, 0);
    at('2026-11-05', '19:00');
    assert.strictEqual((await alerts.processQueue(now)).eveReminders.created, 1, 'B opens Friday');
    at('2026-11-06', '20:00');
    assert.strictEqual((await eve.processDue(now)).created, 1, 'A opens Saturday; B\'s Saturday continues Friday, no second one');
    assert.strictEqual((await eve.processDue(now)).created, 0, 'once');
    const list = await bea.get('/notifications');
    const kinds = list.body.notifications ? list.body.notifications : list.body;
    const eves = (Array.isArray(kinds) ? kinds : kinds.results || []).filter((n) => n.kind === 'reminder_eve');
    assert.deepStrictEqual(eves.map((n) => n.post.id).sort(), [A.id, B.id].sort());
    assert.deepStrictEqual(eves.find((n) => n.post.id === A.id).data, { date: '2026-11-07', start: '08:00', end: '12:00', timeZone: TZ });
    assert.strictEqual(await models.Notification.count({ where: { kind: 'reminder_eve' } }), 2, 'Ada turned it off');
    at('2026-11-07', '00:30');
    assert.strictEqual((await eve.processDue(now)).created, 0, 'past midnight: too late');
  });
});
