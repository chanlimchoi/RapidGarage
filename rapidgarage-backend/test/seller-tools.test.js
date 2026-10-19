const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const app = require('../app');
const models = require('../models');
const LocalStorage = require('../lib/storage/local');
const { setStorage } = require('../lib/storage');
const { setSetting } = require('../lib/features');
const aiItems = require('../lib/aiItems');
const alerts = require('../lib/alerts');
const mailer = require('../lib/mailer');
const sellerTools = require('../lib/sellerTools');

const PW = 'correct-horse';
const ENV = ['ANTHROPIC_API_KEY', 'AI_ITEMS_PER_DAY', 'APP_BASE_URL'];
const DAY = 86400000;

describe('seller tools: duplicate, AI title & description, sale summary', function () {
  this.timeout(30000);
  let dir, alice, bob, aliceId, postId, calls, reply, sent;

  const fake = { beta: { messages: { create: async (req) => { calls.push(req); return typeof reply === 'function' ? reply(req) : reply; } } } };
  const answer = (obj, extra) => Object.assign({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }] }, extra);
  const image = (color) => sharp({ create: { width: 60, height: 40, channels: 3, background: color || '#a33' } }).jpeg().toBuffer();
  const transport = { sendMail: async (msg) => { sent.push(msg); return { messageId: 'x' }; } };

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-seller-'));
    setStorage(new LocalStorage(dir));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    aiItems.setClient(null);
    mailer.setTransport(null);
    ENV.forEach((k) => delete process.env[k]);
  });

  beforeEach(async () => {
    ENV.forEach((k) => delete process.env[k]);
    process.env.APP_BASE_URL = 'https://garage.example';
    calls = [];
    sent = [];
    reply = answer({ title: 'Big family sale: tools, books and a dresser', description: 'Lots of tools and books.\nAlso an oak dresser.' });
    aiItems.setClient(fake);
    await aiItems.resetBudgets();
    await models.sequelize.sync({ force: true });
    await setSetting('aiReview', false);
    alice = request.agent(app);
    bob = request.agent(app);
    aliceId = (await alice.post('/signup').send({ email: 'alice@example.com', password: PW, firstName: 'Alice' })).body.id;
    await bob.post('/signup').send({ email: 'bob@example.com', password: PW, firstName: 'Bob' });
    const p = await alice.post('/post').send({ title: 'Moving sale', street: '1 Main St', city: 'Austin', state: 'TX', zipCode: '78701', description: 'Everything goes', priceMin: 1, priceMax: 50,
      markdownPercent: 50, markdownFrom: '13:00', markdownLastDay: true });
    assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    postId = p.body.id;
    const up = await alice.post('/post/' + postId + '/photos').attach('photos', await image('#a33'), 'a.jpg').attach('photos', await image('#3a3'), 'b.jpg');
    assert.strictEqual(up.status, 201, JSON.stringify(up.body));
    const photos = await models.PostPhoto.findAll({ where: { postId }, order: [['position', 'ASC']] });
    const bulk = await alice.post('/post/' + postId + '/items/bulk').send({ items: [
      { name: 'Oak dresser', price: '40', photoId: photos[0].id },
      { name: 'Box of books', price: '5', photoId: photos[1].id },
      { name: 'Drill', price: '15' },
    ] });
    assert.strictEqual(bulk.status, 201, JSON.stringify(bulk.body));
    await models.SaleItem.update({ sold: true, soldAt: new Date() }, { where: { postId, name: 'Drill' } });
    await alerts.idle();
  });

  it('duplicates a sale: details, markdown, unsold items and copied photos, but no dates', async () => {
    await models.Post.update({ startDate: new Date(Date.now() - 3 * DAY), endDate: new Date(Date.now() - 2 * DAY) }, { where: { id: postId } });
    const r = await alice.post('/post/' + postId + '/duplicate');
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const copy = r.body;
    assert.notStrictEqual(copy.id, postId);
    assert.deepStrictEqual([copy.title, copy.street, copy.description, copy.priceMin, copy.priceMax], ['Moving sale', '1 Main St', 'Everything goes', 1, 50]);
    assert.deepStrictEqual(copy.markdown && [copy.markdown.percent, copy.markdown.from, copy.markdown.lastDayOnly], [50, '13:00', true]);
    assert.strictEqual(copy.startDate, null);
    assert.strictEqual(copy.endDate, null);
    // Unsold items only, with their photos pointing at the copies.
    assert.deepStrictEqual(copy.items.map((i) => [i.name, i.priceCents, i.sold]), [['Oak dresser', 4000, false], ['Box of books', 500, false]]);
    const oldPhotos = await models.PostPhoto.findAll({ where: { postId }, order: [['position', 'ASC']] });
    const newPhotos = await models.PostPhoto.findAll({ where: { postId: copy.id }, order: [['position', 'ASC']] });
    assert.strictEqual(newPhotos.length, 2);
    assert.deepStrictEqual(copy.items.map((i) => i.photoId), newPhotos.map((p) => p.id));
    newPhotos.forEach((p, i) => {
      assert.ok(p.storageKey.startsWith('posts/' + copy.id + '/'));
      assert.notStrictEqual(p.storageKey, oldPhotos[i].storageKey);
      assert.ok(fs.readFileSync(path.join(dir, p.storageKey)).equals(fs.readFileSync(path.join(dir, oldPhotos[i].storageKey))));
    });
    // Deleting the copy leaves the original's files alone.
    assert.strictEqual((await alice.delete('/post/' + copy.id)).status, 204);
    oldPhotos.forEach((p) => assert.ok(fs.existsSync(path.join(dir, p.storageKey))));
  });

  it('only the owner can duplicate, and not a hidden sale', async () => {
    assert.strictEqual((await bob.post('/post/' + postId + '/duplicate')).status, 403);
    assert.strictEqual((await request(app).post('/post/' + postId + '/duplicate')).status, 401);
    await models.Post.update({ hidden: true }, { where: { id: postId } });
    assert.strictEqual((await alice.post('/post/' + postId + '/duplicate')).status, 403);
    assert.strictEqual(await models.Post.count(), 1);
  });

  it('writes a title and description from items and photos, without the street address', async () => {
    const r = await alice.post('/post/' + postId + '/describe').set('Accept-Language', 'es').send({});
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.title, 'Big family sale: tools, books and a dresser');
    assert.strictEqual(r.body.description, 'Lots of tools and books.\nAlso an oak dresser.');
    assert.strictEqual(r.body.keySource, 'site');
    const req = calls[0];
    assert.strictEqual(req.output_config.format.type, 'json_schema');
    assert.deepStrictEqual(req.output_config.format.schema, aiItems.DESCRIBE_SCHEMA);
    const blocks = req.messages[0].content;
    assert.strictEqual(blocks.filter((b) => b.type === 'image').length, 2);
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
    assert.ok(text.includes('Oak dresser ($40)'));
    assert.ok(!text.includes('Drill'), 'sold items are left out');
    assert.ok(text.includes('Spanish'));
    assert.ok(text.includes('Austin, TX'));
    for (const secret of ['1 Main St', 'alice@example.com', '78701']) assert.ok(!text.includes(secret), secret);
    // Nothing is saved: the seller decides.
    assert.strictEqual((await models.Post.findByPk(postId)).title, 'Moving sale');
  });

  it('describe: owner only, caps lengths, maps errors and shares the daily AI budget', async () => {
    assert.strictEqual((await bob.post('/post/' + postId + '/describe')).status, 403);
    reply = answer({ title: 'T'.repeat(200), description: 'D'.repeat(3000) });
    const long = await alice.post('/post/' + postId + '/describe');
    assert.deepStrictEqual([long.body.title.length, long.body.description.length], [80, 1200]);
    reply = answer({}, { stop_reason: 'refusal', content: [] });
    assert.strictEqual((await alice.post('/post/' + postId + '/describe')).body.error.code, 'ai_refused');
    reply = answer({ title: '  ', description: 'x' });
    assert.strictEqual((await alice.post('/post/' + postId + '/describe')).body.error.code, 'ai_failed');

    process.env.AI_ITEMS_PER_DAY = '2';
    await aiItems.resetBudgets();
    reply = answer({ title: 'Sale', description: 'Things.' });
    assert.strictEqual((await alice.post('/post/' + postId + '/describe')).status, 200);
    assert.strictEqual((await alice.post('/post/' + postId + '/items/suggest').send({})).status, 200, 'item drafts use the same budget');
    assert.strictEqual((await alice.post('/post/' + postId + '/describe')).status, 429);

    aiItems.setClient(null);
    assert.strictEqual((await alice.post('/post/' + postId + '/describe')).body.error.code, 'needs_key');
    const bad = await alice.post('/post/' + postId + '/describe').send({ oneTimeKey: 'nope' });
    assert.strictEqual(bad.status, 400);
    assert.ok(!JSON.stringify(bad.body).includes('nope'));
  });

  it('summarizes how the sale went, for the owner only', async () => {
    const day = new Date().toISOString().slice(0, 10);
    await models.PostViewDay.create({ postId, day, count: 12 });
    await models.PostScanDay.create({ postId, day, count: 3 });
    await models.SavedPost.create({ postId, userId: aliceId + 1 });
    const r = await alice.get('/post/' + postId + '/summary');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.items, { total: 3, sold: 1, unsold: 2, soldValueCents: 1500 });
    assert.deepStrictEqual([r.body.views, r.body.scans, r.body.shares, r.body.saves, r.body.conversations, r.body.holdsCompleted, r.body.ended], [12, 3, 0, 1, 0, 0, false]);
    assert.strictEqual((await bob.get('/post/' + postId + '/summary')).status, 403);
  });

  it('emails one summary after the sale ends, in the seller\'s language', async () => {
    mailer.setTransport(transport);
    await models.User.update({ locale: 'es' }, { where: { id: aliceId } });
    const now = new Date();
    // Not ended yet: nothing.
    await models.Post.update({ startDate: new Date(now - DAY), endDate: new Date(now.getTime() + DAY) }, { where: { id: postId } });
    assert.strictEqual(await sellerTools.processSummaries(now), 0);
    await models.Post.update({ endDate: new Date(now - 3600000) }, { where: { id: postId } });
    assert.strictEqual(await sellerTools.processSummaries(now), 1);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].to, 'alice@example.com');
    assert.strictEqual(sent[0].headers['Content-Language'], 'es');
    assert.ok(sent[0].text.includes('https://garage.example/dashboard/sales/' + postId), sent[0].text);
    assert.ok(sent[0].text.includes('https://garage.example/post/' + postId), 'leftovers link');
    assert.ok(sent[0].subject.includes('Moving sale'));
    // Only once.
    assert.strictEqual(await sellerTools.processSummaries(now), 0);
    assert.strictEqual(sent.length, 1);

    // A failed send is retried on the next pass; old and hidden sales never get one.
    const p2 = await alice.post('/post').send({ title: 'Second', city: 'Austin', zipCode: '78701' });
    await models.Post.update({ startDate: new Date(now - 2 * DAY), endDate: new Date(now - 3600000) }, { where: { id: p2.body.id } });
    const p3 = await alice.post('/post').send({ title: 'Ancient', city: 'Austin', zipCode: '78701' });
    await models.Post.update({ startDate: new Date(now - 10 * DAY), endDate: new Date(now - 9 * DAY) }, { where: { id: p3.body.id } });
    mailer.setTransport({ sendMail: async () => { throw Object.assign(new Error('smtp down'), { code: 'ECONNECTION' }); } });
    assert.strictEqual(await sellerTools.processSummaries(now), 0);
    assert.strictEqual((await models.Post.findByPk(p2.body.id)).summarySentAt, null);
    mailer.setTransport(transport);
    assert.strictEqual(await sellerTools.processSummaries(now), 1);
    assert.strictEqual(sent[1].subject.includes('Second'), true);
    assert.strictEqual((await models.Post.findByPk(p3.body.id)).summarySentAt, null);
  });
});
