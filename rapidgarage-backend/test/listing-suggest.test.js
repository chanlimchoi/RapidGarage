const assert = require('assert');
const request = require('supertest');
const sharp = require('sharp');
const app = require('../app');
const models = require('../models');
const suggest = require('../lib/listingSuggest');

const PW = 'correct-horse';
const ENV = ['VISION_API_BASE_URL', 'VISION_API_KEY', 'VISION_MODEL', 'VISION_PER_DAY', 'VISION_TIMEOUT_MS'];
const image = () => sharp({ create: { width: 60, height: 40, channels: 3, background: '#3a6' } })
  .withMetadata({ exif: { IFD0: { Copyright: 'secret-owner' } } }).jpeg().toBuffer();

describe('photo-to-listing suggestions', function () {
  this.timeout(30000);
  let alice, calls, reply;

  const ok = (content) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });
  const ask = (agent, opts) => {
    let r = agent.post('/post/suggest');
    if (opts && opts.hint !== undefined) r = r.field('hint', opts.hint);
    if (opts && opts.photo) r = r.attach('photo', opts.photo, opts.name || 'IMG_2041.jpg');
    return r;
  };
  const post = (agent, body) => agent.post('/post').send(Object.assign({ title: 'Sale', street: '1 Main St', city: 'NYC', zipCode: '10001' }, body));

  beforeEach(async () => {
    ENV.forEach((k) => delete process.env[k]);
    calls = [];
    reply = () => ok('{"title":"Mid-century oak dresser","category":"furniture","price_min":40,"price_max":120}');
    suggest.setFetch(async (url, init) => { calls.push({ url, init }); return reply(); });
    suggest.resetBudgets();
    await models.sequelize.sync({ force: true });
    alice = request.agent(app);
    await alice.post('/signup').send({ email: 'alice@example.com', password: PW, firstName: 'Alice', lastName: 'Smith' });
  });
  after(() => { suggest.setFetch(null); ENV.forEach((k) => delete process.env[k]); });

  it('needs a login', async () => {
    const r = await request(app).post('/post/suggest').field('hint', 'sofa');
    assert.strictEqual(r.status, 401);
  });

  it('without a provider: guesses the category from words and uses typical prices (no outside calls)', async () => {
    const r = await ask(alice, { hint: 'comfy sofa and chairs', photo: await image() });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.source, 'similar');
    assert.strictEqual(r.body.category, 'furniture');
    assert.strictEqual(r.body.basis, 'typical');
    assert.deepStrictEqual([r.body.priceMin, r.body.priceMax], suggest.TYPICAL.furniture);
    assert.strictEqual(r.body.title, 'Comfy sofa and chairs');
    assert.strictEqual(calls.length, 0);
    // Nothing was created.
    assert.strictEqual(await models.Post.count(), 0);
  });

  it('uses medians of similar recent sales, and localizes the generic title', async () => {
    const bob = request.agent(app);
    await bob.post('/signup').send({ email: 'bob@example.com', password: PW, firstName: 'Bob' });
    for (const [a, b] of [[5, 50], [10, 100], [20, 200], [1, 10]]) {
      const p = await post(bob, { category: 'tools', priceMin: a, priceMax: b });
      assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    }
    await post(bob, { category: 'books', priceMin: 1, priceMax: 2 });
    const r = await ask(alice, { photo: await image(), name: 'cordless-drill.jpg' }).set('Accept-Language', 'es');
    assert.strictEqual(r.body.category, 'tools');
    assert.strictEqual(r.body.basis, 'similar');
    assert.strictEqual(r.body.similarCount, 4);
    assert.deepStrictEqual([r.body.priceMin, r.body.priceMax], [8, 75]);
    assert.strictEqual(r.body.title, 'Venta de herramientas');
  });

  it('falls back to the seller\'s last category and ignores camera file names', async () => {
    await post(alice, { category: 'kitchen' });
    const r = await ask(alice, { photo: await image(), name: 'IMG_2041.jpg' });
    assert.strictEqual(r.body.category, 'kitchen');
    assert.strictEqual(suggest.fileWords('PXL_20261030_123456.jpg'), '');
    assert.strictEqual(suggest.fileWords('red-bike_helmet.jpeg').trim(), 'red bike helmet');
    assert.strictEqual(suggest.guessCategory('that old thing'), null, '"hat" inside "that" is not clothing');
    assert.strictEqual(suggest.guessCategory('아기 유모차'), 'kids');
  });

  it('with a provider: sends one small metadata-free JPEG and a fixed prompt, returns cleaned values', async () => {
    process.env.VISION_API_BASE_URL = 'https://vision.example.test/v1/';
    process.env.VISION_MODEL = 'some-vision-model';
    process.env.VISION_API_KEY = 'sk-test-123';
    const conf = await alice.get('/config');
    assert.strictEqual(conf.body.listingSuggestAi, true);
    const r = await ask(alice, { hint: 'my stuff at 12 Elm St', photo: await image() });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body, { source: 'ai', title: 'Mid-century oak dresser', category: 'furniture', priceMin: 40, priceMax: 120 });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://vision.example.test/v1/chat/completions');
    assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer sk-test-123');
    const body = JSON.parse(calls[0].init.body);
    assert.strictEqual(body.model, 'some-vision-model');
    const parts = body.messages[0].content;
    const text = parts.find((p) => p.type === 'text').text;
    assert.ok(!/Elm|alice|Smith/i.test(text), 'nothing the seller typed or who they are is sent');
    const img = Buffer.from(parts.find((p) => p.type === 'image_url').image_url.url.split(',')[1], 'base64');
    const meta = await sharp(img).metadata();
    assert.strictEqual(meta.format, 'jpeg');
    assert.strictEqual(meta.exif, undefined, 'EXIF is stripped');
    // Nothing is stored.
    assert.strictEqual(await models.Post.count(), 0);
    assert.strictEqual(await models.PostPhoto.count(), 0);
  });

  it('cleans odd provider output (fences, swapped prices, unknown category) and fills gaps from similar sales', async () => {
    process.env.VISION_API_BASE_URL = 'http://localhost:11434/v1';
    process.env.VISION_MODEL = 'llava';
    reply = () => ok('Sure!\n```json\n{"title":"  \\"Kids bike\\" ","category":"vehicles","price_min":"$60","price_max":15}\n```');
    const r = await ask(alice, { photo: await image() });
    assert.strictEqual(r.body.source, 'ai');
    assert.strictEqual(r.body.title, 'Kids bike');
    assert.strictEqual(r.body.category, 'kids');
    assert.deepStrictEqual([r.body.priceMin, r.body.priceMax], [15, 60]);
    assert.strictEqual(calls[0].init.headers.Authorization, undefined, 'no key, no header (local providers)');
  });

  it('fails safe: provider errors, timeouts and the daily cap fall back to similar sales', async () => {
    process.env.VISION_API_BASE_URL = 'https://vision.example.test/v1';
    process.env.VISION_MODEL = 'm';
    process.env.VISION_PER_DAY = '1';
    reply = () => ({ ok: false, status: 500, json: async () => ({}) });
    const r1 = await ask(alice, { hint: 'guitar', photo: await image() });
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r1.body.source, 'similar');
    assert.strictEqual(r1.body.aiFailed, true);
    assert.strictEqual(r1.body.category, 'music');
    reply = () => ok('{"title":"x"}');
    const r2 = await ask(alice, { hint: 'guitar', photo: await image() });
    assert.strictEqual(r2.body.source, 'similar', 'over the cap: no call');
    assert.strictEqual(calls.length, 1);
    suggest.setFetch(async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); });
    suggest.resetBudgets();
    const r3 = await ask(alice, { hint: 'guitar', photo: await image() });
    assert.strictEqual(r3.body.source, 'similar');
  });

  it('rejects files that are not images', async () => {
    const r = await ask(alice, { photo: Buffer.from('not an image'), name: 'x.jpg' });
    assert.strictEqual(r.status, 415);
  });

  it('saves the chosen category on the sale and validates it', async () => {
    const bad = await post(alice, { category: 'cars' });
    assert.strictEqual(bad.status, 400);
    assert.ok(bad.body.details && bad.body.details.category || JSON.stringify(bad.body).indexOf('category') >= 0, JSON.stringify(bad.body));
    const p = await post(alice, { category: 'toys' });
    assert.strictEqual(p.body.category, 'toys');
    const u = await alice.put('/post/' + p.body.id).send({ category: null });
    assert.strictEqual(u.status, 200, JSON.stringify(u.body));
    assert.strictEqual(u.body.category, null);
  });
});
