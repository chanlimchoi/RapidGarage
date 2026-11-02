const assert = require('assert');
const http = require('http');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const translate = require('../lib/translate');

const PW = 'correct-horse';

describe('multi-language listings', function () {
  this.timeout(30000);
  let seller, postId, calls;

  // Fake provider: "[ko] text", counting what was sent.
  const fake = async (texts, source, target) => { calls.push({ texts, source, target }); return texts.map((x) => '[' + target + '] ' + x); };

  beforeEach(async () => {
    delete process.env.TRANSLATE_URL; delete process.env.TRANSLATE_API_KEY;
    translate.setProvider(null);
    calls = [];
    await models.sequelize.sync({ force: true });
    seller = request.agent(app);
    assert.strictEqual((await seller.post('/signup').send({ email: 'min@example.com', password: PW, firstName: 'Minji', lastName: 'Kim', locale: 'ko' })).status, 201);
    const r = await seller.post('/post').send({ title: '이사 세일', description: '가구와 주방용품', street: '1 Main St', city: 'New York', state: 'NY', zipCode: '10036' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    postId = r.body.id;
    await seller.post('/post/' + postId + '/items/bulk').send({ items: [{ name: '책상', price: '20' }, { name: '램프', price: '5' }] });
  });
  after(() => { translate.setProvider(null); delete process.env.TRANSLATE_URL; delete process.env.TRANSLATE_API_KEY; });

  it('a listing is written in the seller\'s language by default; the seller can change it', async () => {
    assert.strictEqual((await request(app).get('/post/' + postId)).body.language, 'ko');
    const bad = await seller.put('/post/' + postId).send({ language: 'fr' });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.body.error.details.language, '언어 중 하나를 선택하세요.', 'in the seller\'s language');
    assert.strictEqual((await seller.put('/post/' + postId).send({ language: 'zh-CN' })).body.language, 'zh-CN');
    assert.strictEqual((await seller.put('/post/' + postId).send({ language: null })).body.language, null);
    const other = request.agent(app);
    await other.post('/signup').send({ email: 'ned@example.com', password: PW, firstName: 'Ned' });
    const p = await other.post('/post').send({ title: 'Yard sale', street: '2 Main St', city: 'New York', state: 'NY', zipCode: '10036', language: 'es' });
    assert.strictEqual(p.body.language, 'es');
    const q = await other.post('/post').send({ title: 'Yard sale', street: '2 Main St', city: 'New York', state: 'NY', zipCode: '10036' });
    assert.strictEqual(q.body.language, null, 'no saved language: not set');
  });

  it('without a provider: the original text, its language and the reason', async () => {
    assert.strictEqual((await request(app).get('/config')).body.translation, false);
    const r = await request(app).get('/post/' + postId + '/translation').set('Accept-Language', 'en-US');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body, { from: 'ko', to: 'en', available: false, translated: false, reason: 'unavailable', title: '이사 세일', description: '가구와 주방용품',
      items: r.body.items });
    assert.deepStrictEqual(r.body.items.map((i) => i.name), ['책상', '램프']);
    assert.strictEqual((await request(app).get('/post/' + postId + '/translation').query({ to: 'xx' })).status, 400);
  });

  it('with a provider: translates once, then serves from the cache; same language is untouched', async () => {
    translate.setProvider(fake);
    assert.strictEqual((await request(app).get('/config')).body.translation, true);
    const r = await request(app).get('/post/' + postId + '/translation').query({ to: 'es' });
    assert.deepStrictEqual([r.body.translated, r.body.from, r.body.to, r.body.title, r.body.description], [true, 'ko', 'es', '[es] 이사 세일', '[es] 가구와 주방용품']);
    assert.deepStrictEqual(r.body.items.map((i) => i.name), ['[es] 책상', '[es] 램프']);
    assert.deepStrictEqual(calls.map((c) => [c.source, c.target, c.texts.length]), [['ko', 'es', 4]]);
    await request(app).get('/post/' + postId + '/translation').query({ to: 'es' });
    assert.strictEqual(calls.length, 1, 'cached');
    // An edited item name is the only text sent again.
    const item = (await request(app).get('/post/' + postId)).body.items[0];
    await models.SaleItem.update({ name: '의자' }, { where: { id: item.id } });
    const e = await request(app).get('/post/' + postId + '/translation').query({ to: 'es' });
    assert.strictEqual(e.body.items[0].name, '[es] 의자');
    assert.deepStrictEqual(calls[1].texts, ['의자']);
    const same = await request(app).get('/post/' + postId + '/translation').query({ to: 'ko' });
    assert.deepStrictEqual([same.body.translated, same.body.reason, same.body.title], [false, 'same', '이사 세일']);
    // Unknown listing language: the provider detects it.
    await seller.put('/post/' + postId).send({ language: null });
    await request(app).get('/post/' + postId + '/translation').query({ to: 'zh-CN' });
    assert.deepStrictEqual([calls[2].source, calls[2].target], [null, 'zh-CN']);
  });

  it('a failing provider falls back to the original', async () => {
    translate.setProvider(async () => { throw new Error('down'); });
    const warn = console.warn; console.warn = () => {};
    try {
      const r = await request(app).get('/post/' + postId + '/translation').query({ to: 'en' });
      assert.deepStrictEqual([r.status, r.body.translated, r.body.reason, r.body.title], [200, false, 'failed', '이사 세일']);
    } finally { console.warn = warn; }
    assert.strictEqual(await models.Translation.count(), 0);
  });

  it('hidden sales stay hidden', async () => {
    translate.setProvider(fake);
    await models.Post.update({ hidden: true }, { where: { id: postId } });
    assert.strictEqual((await request(app).get('/post/' + postId + '/translation').query({ to: 'en' })).status, 404);
    assert.strictEqual(calls.length, 0);
  });

  it('talks to a LibreTranslate-compatible server (TRANSLATE_URL), with zh mapped and an optional key', async () => {
    const seen = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const b = JSON.parse(body);
        seen.push({ path: req.url, source: b.source, target: b.target, format: b.format, key: b.api_key });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ translatedText: b.q.map((x) => x.toUpperCase() + '!') }));
      });
    });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    try {
      process.env.TRANSLATE_URL = 'http://127.0.0.1:' + server.address().port + '/';
      process.env.TRANSLATE_API_KEY = 'test-only';
      await seller.put('/post/' + postId).send({ language: 'zh-CN', title: 'moving sale' });
      const r = await request(app).get('/post/' + postId + '/translation').query({ to: 'en' });
      assert.strictEqual(r.body.title, 'MOVING SALE!');
      assert.deepStrictEqual(seen, [{ path: '/translate', source: 'zh', target: 'en', format: 'text', key: 'test-only' }]);
      process.env.TRANSLATE_URL = 'ftp://nope';
      assert.strictEqual(translate.configured(), false);
    } finally { server.close(); }
  });
});
