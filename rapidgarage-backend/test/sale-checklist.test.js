const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const schedule = require('../lib/schedule');
const push = require('../lib/push');
const checklist = require('../lib/checklist');

const PW = 'correct-horse';
const P256DH = 'B' + 'x'.repeat(86);
const AUTH = 'a'.repeat(22);
// The sale is Monday 2027-03-15, 08:00-14:00 New York: the day after US DST
// starts (2027-03-14), so due dates on either side of the change are covered.
const SALE = '2027-03-15';
const at = (iso) => new Date(iso);

describe('sale-day checklist', function () {
  this.timeout(30000);
  let sam, bea, postId, now, sent;

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    return agent;
  }
  const url = (rest) => '/post/' + postId + '/checklist' + (rest || '');
  const tick = async (iso) => { now = at(iso); return checklist.processDue(now); };

  beforeEach(async () => {
    sent = [];
    push.setSender(async (s, payload) => { sent.push(JSON.parse(payload)); return { statusCode: 201 }; });
    await models.sequelize.sync({ force: true });
    now = at('2027-03-01T15:00:00Z');
    schedule.setClock(() => now);
    sam = await user('sam@example.com', 'Sam');
    bea = await user('bea@example.com', 'Bea');
    const p = await sam.post('/post').send({ title: 'Porch sale', street: '1 Main St', city: 'Brooklyn', zipCode: '11201',
      schedule: { timeZone: 'America/New_York', days: [{ date: SALE, start: '08:00', end: '14:00' }, { date: '2027-03-16', start: '08:00', end: '12:00' }] } });
    assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    postId = p.body.id;
  });
  after(() => { schedule.setClock(null); push.setSender(null); });

  it('creates the default list on first open, tied to the first sale day; seller only', async () => {
    assert.strictEqual((await bea.get(url())).status, 403);
    assert.strictEqual((await request(app).get(url())).status, 401);
    const r = await sam.get(url());
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.headers['cache-control'], 'no-store');
    assert.deepStrictEqual([r.body.saleDate, r.body.timeZone, r.body.remind], [SALE, 'America/New_York', true]);
    assert.deepStrictEqual(r.body.items.map((i) => [i.key, i.dueDays, i.dueDate, i.done]), [
      ['flyers', 3, '2027-03-12', false], ['pricing', 2, '2027-03-13', false], ['signs', 1, '2027-03-14', false], ['change', 1, '2027-03-14', false], ['setup', 0, SALE, false]]);
    // Opening again doesn't duplicate.
    assert.strictEqual((await sam.get(url())).body.items.length, 5);
    // Not in the public post.
    assert.ok(!/checklist/i.test(JSON.stringify((await request(app).get('/post/' + postId)).body)));
  });

  it('edit, add, tick off, delete, reset; validated', async () => {
    const list = (await sam.get(url())).body.items;
    let r = await sam.put(url('/' + list[0].id)).send({ label: '  Post on the  neighborhood board ', dueDays: 5 });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    let it = r.body.items.find((i) => i.id === list[0].id);
    assert.deepStrictEqual([it.key, it.label, it.dueDays, it.dueDate], [null, 'Post on the neighborhood board', 5, '2027-03-10']);
    r = await sam.put(url('/' + list[1].id)).send({ done: true });
    it = r.body.items.find((i) => i.id === list[1].id);
    assert.ok(it.done && it.doneAt);
    r = await sam.post(url()).send({ label: 'Borrow a folding table', dueDays: '2' });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.items.length, 6);
    assert.ok((await sam.post(url()).send({ label: '', dueDays: 1 })).body.error.details.label);
    assert.ok((await sam.post(url()).send({ label: 'x', dueDays: 15 })).body.error.details.dueDays);
    assert.ok((await sam.put(url('/' + list[1].id)).send({ done: 'yes' })).body.error.details.done);
    const ko = await sam.post(url()).set('Accept-Language', 'ko').send({ label: 'x', dueDays: -1 });
    assert.strictEqual(ko.body.error.details.dueDays, '세일 0~14일 전 중에서 선택하세요.');
    assert.strictEqual((await sam.delete(url('/' + list[2].id))).body.items.length, 5);
    assert.strictEqual((await sam.put(url('/99999')).send({ done: true })).status, 404);
    assert.strictEqual((await bea.put(url('/' + list[3].id)).send({ done: true })).status, 403);
    r = await sam.post(url('/reset'));
    assert.deepStrictEqual(r.body.items.map((i) => i.key), ['flyers', 'pricing', 'signs', 'change', 'setup']);
  });

  it('due-day windows are local calendar days across the DST change', () => {
    const first = { date: SALE, startsAt: at('2027-03-15T12:00:00Z').getTime(), timeZone: 'America/New_York' };
    // 09:00 EST (UTC-5) before the change, 09:00 EDT (UTC-4) after.
    assert.strictEqual(new Date(checklist.windowFor(first, '2027-03-12').sendAt).toISOString(), '2027-03-12T14:00:00.000Z');
    assert.strictEqual(new Date(checklist.windowFor(first, '2027-03-14').sendAt).toISOString(), '2027-03-14T13:00:00.000Z');
    // Sale day: an hour before the 08:00 opening, and not after it opens.
    const w = checklist.windowFor(first, SALE);
    assert.deepStrictEqual([new Date(w.sendAt).toISOString(), new Date(w.until).toISOString()], ['2027-03-15T11:00:00.000Z', '2027-03-15T12:00:00.000Z']);
  });

  it('reminds the seller once per due day with open items (bell + push); done items and reminders off are quiet', async () => {
    await sam.post('/push/subscriptions').send({ endpoint: 'https://fcm.googleapis.com/fcm/send/dev-1', keys: { p256dh: P256DH, auth: AUTH } });
    const list = (await sam.get(url())).body.items;
    // Before 09:00 local on the flyers day: nothing.
    assert.strictEqual((await tick('2027-03-12T13:59:00Z')).created, 0);
    assert.strictEqual((await tick('2027-03-12T14:00:00Z')).created, 1);
    assert.strictEqual((await tick('2027-03-12T20:00:00Z')).created, 0, 'once per day');
    await push.idle();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].url, '/post/' + postId + '/checklist');
    let bell = (await sam.get('/notifications')).body.results;
    assert.deepStrictEqual([bell[0].kind, bell[0].data.date, bell[0].data.count, bell[0].data.keys], ['checklist', '2027-03-12', 1, ['flyers']]);
    // Pricing (due 3/13) already done: no reminder that day.
    await sam.put(url('/' + list[1].id)).send({ done: true });
    assert.strictEqual((await tick('2027-03-13T15:00:00Z')).created, 0);
    // 3/14 (after the change): signs + change in one reminder at 09:00 EDT.
    assert.strictEqual((await tick('2027-03-14T12:59:00Z')).created, 0);
    assert.strictEqual((await tick('2027-03-14T13:00:00Z')).created, 1);
    bell = (await sam.get('/notifications')).body.results;
    assert.deepStrictEqual([bell[0].data.date, bell[0].data.count], ['2027-03-14', 2]);
    // Reminders off: the sale-day one never comes.
    await sam.put(url('/settings')).send({ remind: false });
    assert.strictEqual((await tick('2027-03-15T11:30:00Z')).created, 0);
    await sam.put(url('/settings')).send({ remind: true });
    assert.strictEqual((await tick('2027-03-15T11:30:00Z')).created, 1);
    // After opening: nothing more.
    assert.strictEqual((await tick('2027-03-15T13:00:00Z')).created, 0);
    // Bea (not the seller) never got anything.
    assert.strictEqual((await bea.get('/notifications')).body.results.length, 0);
  });
});
