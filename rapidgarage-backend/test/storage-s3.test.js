const assert = require('assert');
const request = require('supertest');
const sharp = require('sharp');
const app = require('../app');
const models = require('../models');
const S3Storage = require('../lib/storage/s3');
const { setStorage } = require('../lib/storage');
const runtime = require('../lib/runtime');

// An in-memory S3: records commands, stores bodies like a bucket would.
function fakeS3() {
  const objects = new Map();
  const calls = [];
  return {
    objects, calls,
    async send(cmd) {
      const name = cmd.constructor.name;
      const input = cmd.input;
      calls.push({ name, input });
      if (name === 'PutObjectCommand') { objects.set(input.Key, { body: Buffer.from(input.Body), type: input.ContentType, cache: input.CacheControl }); return {}; }
      if (name === 'DeleteObjectCommand') { objects.delete(input.Key); return {}; }
      if (name === 'HeadBucketCommand') return {};
      if (name === 'GetObjectCommand') {
        const o = objects.get(input.Key);
        if (!o) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
        return { Body: { transformToByteArray: async () => new Uint8Array(o.body) } };
      }
      throw new Error('unexpected ' + name);
    },
  };
}

describe('S3 photo storage', function () {
  this.timeout(30000);
  let s3, alice, postId;

  beforeEach(async () => {
    s3 = fakeS3();
    setStorage(new S3Storage({ bucket: 'photos', prefix: 'rg/', client: s3 }));
    await models.sequelize.sync({ force: true });
    alice = request.agent(app);
    await alice.post('/signup').send({ email: 'alice@example.com', password: 'correct-horse', firstName: 'A' });
    postId = (await alice.post('/post').send({ title: 'Sale', zipCode: '10001' })).body.id;
  });
  after(() => setStorage(null));

  it('stores uploads in the bucket (with a long cache) and serves them through /uploads', async () => {
    const img = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#3a6' } }).jpeg().toBuffer();
    const up = await alice.post('/post/' + postId + '/photos').attach('photos', img, 'a.jpg');
    assert.strictEqual(up.status, 201, JSON.stringify(up.body));
    const keys = Array.from(s3.objects.keys());
    assert.strictEqual(keys.length, 2, 'photo + thumbnail');
    assert.ok(keys.every((k) => k.startsWith('rg/') && k.endsWith('.webp')));
    const first = s3.objects.get(keys[0]);
    assert.strictEqual(first.type, 'image/webp');
    assert.ok(/immutable/.test(first.cache));
    const served = await request(app).get(up.body[0].url.replace(/^\/api/, '')).buffer(true).parse((res, cb) => { const b = []; res.on('data', (c) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
    assert.strictEqual(served.status, 200);
    assert.strictEqual((await sharp(served.body).metadata()).format, 'webp');

    // Deleting the post removes both objects.
    assert.strictEqual((await alice.delete('/post/' + postId)).status, 204);
    assert.strictEqual(s3.objects.size, 0);
  });

  it('answers 404 for missing or invalid keys without calling S3 for invalid ones', async () => {
    assert.strictEqual((await request(app).get('/uploads/posts/1/nope.webp')).status, 404);
    const before = s3.calls.length;
    assert.strictEqual((await request(app).get('/uploads/..%2F..%2Fetc%2Fpasswd')).status, 404);
    assert.strictEqual(s3.calls.length, before, 'invalid keys never reach the bucket');
  });

  it('checks configuration at startup', () => {
    const env = { NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40), PHOTO_STORAGE: 's3' };
    assert.ok(runtime.checkConfig(env).errors.some((m) => /S3_BUCKET/.test(m)));
    assert.ok(!runtime.checkConfig(Object.assign({ S3_BUCKET: 'b' }, env)).errors.some((m) => /S3/.test(m)));
    assert.ok(runtime.checkConfig(Object.assign({}, env, { PHOTO_STORAGE: 'ftp' })).errors.some((m) => /PHOTO_STORAGE/.test(m)));
    assert.throws(() => new S3Storage({}), /S3_BUCKET/);
  });
});
