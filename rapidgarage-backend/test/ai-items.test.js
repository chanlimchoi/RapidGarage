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

const PW = 'correct-horse';
const ENV = ['ANTHROPIC_API_KEY', 'AI_ITEMS_PER_DAY', 'AI_ITEMS_MODEL', 'AI_ITEMS_EFFORT', 'ENABLE_AI_ITEMS'];

describe('drafting items from photos (Claude)', function () {
  this.timeout(30000);
  let dir, alice, bob, postId, calls, reply;

  // Stands in for the Anthropic client: records requests, returns `reply`.
  const fake = { beta: { messages: { create: async (req) => { calls.push(req); return typeof reply === 'function' ? reply(req) : reply; } } } };
  const answer = (obj, extra) => Object.assign({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(obj) }] }, extra);
  const image = () => sharp({ create: { width: 60, height: 40, channels: 3, background: '#a33' } }).jpeg().toBuffer();
  const suggest = (agent, body) => agent.post('/post/' + postId + '/items/suggest').send(body || {});

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-ai-'));
    setStorage(new LocalStorage(dir));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    aiItems.setClient(null);
    ENV.forEach((k) => delete process.env[k]);
  });

  beforeEach(async () => {
    ENV.forEach((k) => delete process.env[k]);
    calls = [];
    reply = answer({ items: [{ name: 'Oak dresser', price_cents: 4000, photo: 1 }, { name: 'Box of books', price_cents: -1, photo: 2 }] });
    aiItems.setClient(fake);
    aiItems.resetBudgets();
    await models.sequelize.sync({ force: true });
    alice = request.agent(app);
    bob = request.agent(app);
    await alice.post('/signup').send({ email: 'alice@example.com', password: PW, firstName: 'A' });
    await bob.post('/signup').send({ email: 'bob@example.com', password: PW, firstName: 'B' });
    const p = await alice.post('/post').send({ title: 'Sale', street: '1 Main St', city: 'NYC', zipCode: '10001' });
    postId = p.body.id;
    const up = await alice.post('/post/' + postId + '/photos').attach('photos', await image(), 'a.jpg').attach('photos', await image(), 'b.jpg');
    assert.strictEqual(up.status, 201, JSON.stringify(up.body));
  });

  it('sends the photos with a structured-output request and returns cleaned suggestions', async () => {
    const r = await suggest(alice);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const photos = (await models.PostPhoto.findAll({ where: { postId }, order: [['position', 'ASC']] })).map((p) => p.id);
    assert.deepStrictEqual(r.body.suggestions, [
      { name: 'Oak dresser', priceCents: 4000, photoId: photos[0] },
      { name: 'Box of books', priceCents: null, photoId: photos[1] },
    ]);
    assert.strictEqual(r.body.room, 100);
    assert.strictEqual(r.body.photosUsed, 2);

    const req = calls[0];
    assert.strictEqual(req.model, 'claude-opus-5-5');
    assert.deepStrictEqual(req.output_config.format.type, 'json_schema');
    assert.strictEqual(req.output_config.effort, 'medium');
    assert.strictEqual(req.fallbacks, 'default');
    assert.deepStrictEqual(req.betas, ['server-side-fallback-2026-07-01']);
    assert.strictEqual(req.thinking, undefined, 'Opus 5.5 always thinks; disabling it is a 400');
    const blocks = req.messages[0].content;
    const imgs = blocks.filter((b) => b.type === 'image');
    assert.strictEqual(imgs.length, 2);
    assert.strictEqual(imgs[0].source.media_type, 'image/webp');
    assert.ok(imgs[0].source.data.length > 50);
    // Nothing personal is sent: no title, address, name or email.
    const text = JSON.stringify(blocks.filter((b) => b.type === 'text'));
    for (const secret of ['1 Main St', 'alice@example.com', 'NYC']) assert.ok(!text.includes(secret), secret);
    assert.strictEqual(await models.SaleItem.count(), 0, 'nothing is saved');
  });

  it('asks for names in the seller\'s language and uses only chosen photos', async () => {
    const photos = (await models.PostPhoto.findAll({ where: { postId }, order: [['position', 'ASC']] })).map((p) => p.id);
    const r = await suggest(alice, { photoIds: [photos[1]] }).set('Accept-Language', 'ko');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(calls[0].messages[0].content.filter((b) => b.type === 'image').length, 1);
    assert.ok(/written in Korean/.test(calls[0].messages[0].content.slice(-1)[0].text));
    assert.strictEqual(r.body.suggestions[0].photoId, photos[1]);
  });

  it('cleans the model output: trims, dedupes, caps names and drops bad prices', () => {
    const out = aiItems.sanitize([
      { name: '  Lamp  ', price_cents: 500, photo: 1 },
      { name: 'lamp', price_cents: 600, photo: 1 },
      { name: 'x'.repeat(200), price_cents: 1.5, photo: 9 },
      { name: '', price_cents: 1, photo: 1 },
      { price_cents: 1 },
    ], [7]);
    assert.deepStrictEqual(out.map((s) => [s.name.length, s.priceCents, s.photoId]), [[4, 500, 7], [80, null, null]]);
  });

  it('is only for the seller, needs photos, and is off without a key or when switched off', async () => {
    assert.strictEqual((await suggest(bob)).status, 403);
    assert.strictEqual((await request(app).post('/post/' + postId + '/items/suggest')).status, 401);

    const p2 = await alice.post('/post').send({ title: 'No photos', zipCode: '10001' });
    assert.strictEqual((await alice.post('/post/' + p2.body.id + '/items/suggest').send({})).status, 400);
    assert.strictEqual((await suggest(alice, { photoIds: ['x'] })).status, 400);

    aiItems.setClient(null);
    assert.strictEqual((await request(app).get('/config')).body.aiItems, false);
    assert.strictEqual((await suggest(alice)).status, 404);
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    assert.strictEqual((await request(app).get('/config')).body.aiItems, true);
    await setSetting('aiItems', false);
    assert.strictEqual((await request(app).get('/config')).body.aiItems, false);
    assert.strictEqual((await suggest(alice)).status, 404);
  });

  it('limits drafts per seller per day, and failures don\'t count', async () => {
    process.env.AI_ITEMS_PER_DAY = '2';
    reply = () => { throw Object.assign(new Error('down'), { status: 500 }); };
    assert.strictEqual((await suggest(alice)).status, 503);
    reply = answer({ items: [] });
    assert.strictEqual((await suggest(alice)).status, 200);
    assert.strictEqual((await suggest(alice)).status, 200);
    const r = await suggest(alice);
    assert.strictEqual(r.status, 429);
    assert.strictEqual(r.body.error.code, 'rate_limited');
  });

  it('maps refusals, truncation, bad JSON and API errors to clear answers', async () => {
    const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
    reply = answer({}, { stop_reason: 'refusal', content: [] });
    assert.strictEqual((await suggest(alice)).body.error.code, 'ai_refused');
    reply = answer({}, { stop_reason: 'max_tokens' });
    assert.strictEqual((await suggest(alice)).body.error.code, 'ai_failed');
    reply = { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] };
    assert.strictEqual((await suggest(alice)).body.error.code, 'ai_failed');
    reply = () => { throw new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } }, 'slow', new Headers()); };
    const busy = await suggest(alice);
    assert.strictEqual(busy.status, 503);
    assert.strictEqual(busy.body.error.code, 'ai_busy');
  });

  it('adds the kept drafts in one bulk request', async () => {
    const r = await alice.post('/post/' + postId + '/items/bulk').send({ items: [{ name: 'Oak dresser', price: '40' }, { name: 'Lamp', price: null }] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.items.map((i) => [i.name, i.priceCents, i.position]), [['Oak dresser', 4000, 0], ['Lamp', null, 1]]);
    const bad = await alice.post('/post/' + postId + '/items/bulk').send({ items: [{ name: 'Ok' }, { name: '' }] });
    assert.strictEqual(bad.status, 400);
    assert.ok(bad.body.error.details['1.name']);
    assert.strictEqual(await models.SaleItem.count(), 2, 'all or nothing');
    assert.strictEqual((await bob.post('/post/' + postId + '/items/bulk').send({ items: [{ name: 'x' }] })).status, 403);
    assert.strictEqual((await alice.post('/post/' + postId + '/items/bulk').send({ items: [] })).status, 400);
  });
});
