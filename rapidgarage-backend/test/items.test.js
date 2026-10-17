const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const items = require('../lib/items');
const LocalStorage = require('../lib/storage/local');
const { setStorage } = require('../lib/storage');

const PW = 'correct-horse';
const C = { lat: 40.758, lng: -73.9855 };
const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer();

describe('sale item lists', function () {
  this.timeout(30000);
  let dir, alice, bob, admin, post, other;

  async function user(email, role) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: email.split('@')[0], lastName: 'Zed' });
    assert.strictEqual(r.status, 201);
    if (role) await models.User.update({ role }, { where: { id: r.body.id } });
    return agent;
  }
  async function sale(title, extra, agent) {
    const r = await (agent || alice).post('/post').send(Object.assign({ title, street: '1 Main St', city: 'New York', zipCode: '10036' }, extra));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return r.body;
  }
  const add = (body, p, agent) => (agent || alice).post('/post/' + (p || post).id + '/items').send(body);
  const names = (r) => (Array.isArray(r.body) ? r.body : r.body.results).map((p) => p.title).sort();

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-items-'));
    setStorage(new LocalStorage(dir));
    geo.setProvider(async () => ({ status: 'ok', lat: C.lat, lng: C.lng }));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    geo.setProvider(null);
    delete process.env.GOOGLE_MAPS_API_KEY;
  });
  beforeEach(async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    geo.resetRateLimits();
    await models.sequelize.sync({ force: true });
    alice = await user('alice@example.com');
    bob = await user('bob@example.com');
    admin = await user('admin@example.com', 'admin');
    post = await sale('Moving sale', { description: 'Furniture and more' });
    other = await sale('Other sale');
  });

  it('parses prices to cents', () => {
    assert.deepStrictEqual(items.parseCents('5'), { value: 500 });
    assert.deepStrictEqual(items.parseCents('2.5'), { value: 250 });
    assert.deepStrictEqual(items.parseCents('$0.75'), { value: 75 });
    assert.deepStrictEqual(items.parseCents(12.99), { value: 1299 });
    assert.deepStrictEqual(items.parseCents(''), { value: null });
    assert.ok(items.parseCents('-1').error);
    assert.ok(items.parseCents('1.999').error);
    assert.ok(items.parseCents('abc').error);
    assert.ok(items.parseCents('200000').error);
  });

  it('lets the seller add items, shown in order on the post', async () => {
    const a = await add({ name: '  Road   bike ', price: '45' });
    assert.strictEqual(a.status, 201, JSON.stringify(a.body));
    assert.deepStrictEqual([a.body.name, a.body.priceCents, a.body.sold, a.body.photoId, a.body.position], ['Road bike', 4500, false, null, 0]);
    const b = await add({ name: 'Lamp' });
    assert.strictEqual(b.body.priceCents, null);
    assert.strictEqual(b.body.position, 1);
    const p = await request(app).get('/post/' + post.id);
    assert.deepStrictEqual(p.body.items.map((i) => i.name), ['Road bike', 'Lamp']);
    assert.strictEqual(p.body.items[0].postId, undefined);
    const list = await request(app).get('/post/' + post.id + '/items');
    assert.deepStrictEqual(list.body.items.map((i) => i.name), ['Road bike', 'Lamp']);
    assert.strictEqual(list.body.max, items.MAX_ITEMS);
  });

  it('validates names, prices and photos', async () => {
    const r = await add({ name: ' ', price: 'free' });
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error.details.name);
    assert.ok(r.body.error.details.price);
    assert.ok((await add({ name: 'x'.repeat(81) })).body.error.details.name);
    assert.ok((await add({ name: 'Box', sold: 'yes' })).body.error.details.sold);
    // Only this post's photos.
    const up = await alice.post('/post/' + other.id + '/photos').attach('photos', await png(), 'a.png');
    assert.strictEqual(up.status, 201, JSON.stringify(up.body));
    const bad = await add({ name: 'Box', photoId: up.body[0].id });
    assert.strictEqual(bad.status, 400);
    assert.ok(bad.body.error.details.photoId);
    const mine = await alice.post('/post/' + post.id + '/photos').attach('photos', await png(), 'b.png');
    const ok = await add({ name: 'Box', photoId: mine.body[0].id });
    assert.strictEqual(ok.status, 201);
    assert.strictEqual(ok.body.photoId, mine.body[0].id);
    // Deleting the photo keeps the item, without a photo.
    assert.strictEqual((await alice.delete('/post/' + post.id + '/photos/' + mine.body[0].id)).status, 204);
    const after = await request(app).get('/post/' + post.id);
    assert.strictEqual(after.body.items[0].photoId, null);
  });

  it('marks items sold and back, recording when', async () => {
    const a = (await add({ name: 'Chair', price: 10 })).body;
    const s = await alice.put('/post/' + post.id + '/items/' + a.id).send({ sold: true });
    assert.strictEqual(s.status, 200);
    assert.strictEqual(s.body.sold, true);
    assert.ok(s.body.soldAt);
    const again = await alice.put('/post/' + post.id + '/items/' + a.id).send({ sold: true });
    assert.strictEqual(again.body.soldAt, s.body.soldAt);
    const u = await alice.put('/post/' + post.id + '/items/' + a.id).send({ sold: false, name: 'Oak chair', price: '' });
    assert.deepStrictEqual([u.body.sold, u.body.soldAt, u.body.name, u.body.priceCents], [false, null, 'Oak chair', null]);
    assert.strictEqual((await alice.put('/post/' + post.id + '/items/' + a.id).send({})).status, 400);
    // Created as sold.
    const pre = await add({ name: 'Gone already', sold: true });
    assert.strictEqual(pre.body.sold, true);
    assert.ok(pre.body.soldAt);
  });

  it('reorders items', async () => {
    const a = (await add({ name: 'A' })).body;
    const b = (await add({ name: 'B' })).body;
    const c = (await add({ name: 'C' })).body;
    const r = await alice.put('/post/' + post.id + '/items/order').send({ ids: [c.id, a.id, b.id] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.items.map((i) => i.name), ['C', 'A', 'B']);
    assert.deepStrictEqual((await request(app).get('/post/' + post.id)).body.items.map((i) => i.name), ['C', 'A', 'B']);
    assert.strictEqual((await alice.put('/post/' + post.id + '/items/order').send({ ids: [c.id, a.id] })).status, 400);
    assert.strictEqual((await alice.put('/post/' + post.id + '/items/order').send({ ids: [c.id, a.id, a.id] })).status, 400);
  });

  it('only the seller edits; admins may delete; others are refused', async () => {
    const a = (await add({ name: 'Rug' })).body;
    assert.strictEqual((await request(app).post('/post/' + post.id + '/items').send({ name: 'X' })).status, 401);
    assert.strictEqual((await add({ name: 'X' }, post, bob)).status, 403);
    assert.strictEqual((await add({ name: 'X' }, post, admin)).status, 403);
    assert.strictEqual((await bob.put('/post/' + post.id + '/items/' + a.id).send({ sold: true })).status, 403);
    assert.strictEqual((await bob.delete('/post/' + post.id + '/items/' + a.id)).status, 403);
    // An item id from another post is not found.
    const o = (await add({ name: 'Elsewhere' }, other)).body;
    assert.strictEqual((await alice.put('/post/' + post.id + '/items/' + o.id).send({ sold: true })).status, 404);
    assert.strictEqual((await admin.delete('/post/' + post.id + '/items/' + a.id)).status, 204);
    assert.strictEqual((await alice.delete('/post/' + post.id + '/items/' + o.id)).status, 404);
    assert.strictEqual((await alice.delete('/post/' + other.id + '/items/' + o.id)).status, 204);
  });

  it('respects hidden posts and caps the list', async () => {
    await add({ name: 'Secret' });
    await models.Post.update({ hidden: true }, { where: { id: post.id } });
    assert.strictEqual((await bob.get('/post/' + post.id + '/items')).status, 404);
    assert.strictEqual((await alice.get('/post/' + post.id + '/items')).status, 200);
    await models.Post.update({ hidden: false }, { where: { id: post.id } });
    const rows = [];
    for (let i = 0; i < items.MAX_ITEMS - 1; i += 1) rows.push({ postId: post.id, name: 'Thing ' + i, position: i + 1 });
    await models.SaleItem.bulkCreate(rows);
    const r = await add({ name: 'One too many' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'too_many');
  });

  it('deleting the post removes its items', async () => {
    await add({ name: 'A' });
    assert.strictEqual((await alice.delete('/post/' + post.id)).status, 204);
    assert.strictEqual(await models.SaleItem.count({ where: { postId: post.id } }), 0);
  });

  describe('keyword search', () => {
    beforeEach(async () => {
      await add({ name: 'Road bike', price: 45 });
      await add({ name: 'Bike helmet' });
      const sold = (await add({ name: 'Kayak' })).body;
      await alice.put('/post/' + post.id + '/items/' + sold.id).send({ sold: true });
      await sale('Bike repair stand clear-out', {});
      await sale('Books', { description: 'Mostly paperbacks' });
    });

    it('matches titles, descriptions and unsold item names (all words)', async () => {
      const q = (keyword) => request(app).get('/search').query({ lat: C.lat, lng: C.lng, keyword });
      assert.deepStrictEqual(names(await q('bike')), ['Bike repair stand clear-out', 'Moving sale']);
      assert.deepStrictEqual(names(await q('HELMET')), ['Moving sale']);
      assert.deepStrictEqual(names(await q('furniture')), ['Moving sale']);
      assert.deepStrictEqual(names(await q('paperbacks')), ['Books']);
      assert.deepStrictEqual(names(await q('kayak')), [], 'sold items do not match');
      assert.deepStrictEqual(names(await q('bike helmet')), ['Moving sale']);
      assert.deepStrictEqual(names(await q('bike books')), []);
      const r = await q('bike');
      assert.strictEqual(r.body.filter.keyword, 'bike');
      const moving = r.body.results.find((p) => p.title === 'Moving sale');
      assert.deepStrictEqual(moving.matchedItems, ['Road bike', 'Bike helmet']);
      assert.deepStrictEqual(r.body.results.find((p) => p.title !== 'Moving sale').matchedItems, []);
      // No keyword: no matchedItems field, filter unchanged.
      const plain = await request(app).get('/search').query({ lat: C.lat, lng: C.lng });
      assert.strictEqual(plain.body.results[0].matchedItems, undefined);
      assert.strictEqual(plain.body.filter.keyword, undefined);
      assert.strictEqual((await q('x'.repeat(61))).status, 400);
    });

    it('works on the recent list and the text fallback, and treats % and _ literally', async () => {
      const recent = await request(app).get('/allPosts').query({ keyword: 'helmet' });
      assert.deepStrictEqual(names(recent), ['Moving sale']);
      assert.deepStrictEqual(recent.body[0].matchedItems, ['Bike helmet']);
      assert.deepStrictEqual(names(await request(app).get('/allPosts').query({ keyword: '%' })), []);
      assert.strictEqual((await request(app).get('/allPosts').query({ keyword: 'y'.repeat(61) })).status, 400);
      delete process.env.GOOGLE_MAPS_API_KEY;
      const text = await request(app).get('/search').query({ q: 'New York', keyword: 'road bike' });
      assert.strictEqual(text.body.mode, 'text');
      assert.deepStrictEqual(names(text), ['Moving sale']);
      assert.deepStrictEqual(text.body.results[0].matchedItems, ['Road bike']);
    });

    it('never matches hidden posts for other people', async () => {
      await models.Post.update({ hidden: true }, { where: { id: post.id } });
      assert.deepStrictEqual(names(await request(app).get('/allPosts').query({ keyword: 'helmet' })), []);
      assert.deepStrictEqual(names(await alice.get('/allPosts').query({ keyword: 'helmet' })), ['Moving sale']);
    });
  });
});
