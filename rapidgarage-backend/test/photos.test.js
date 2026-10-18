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

const PW = 'correct-horse';

function makeImage(format, width, height, opts) {
  let img = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } });
  if (opts && opts.exif) img = img.withExif({ IFD0: { Make: 'SecretCam', Copyright: 'Private' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '40/1 44/1 0/1' } });
  return img[format]().toBuffer();
}

describe('post photos', function () {
  this.timeout(20000);
  let dir, alice, bob, admin, postId;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-photos-'));
    setStorage(new LocalStorage(dir));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  beforeEach(async () => {
    fs.rmSync(path.join(dir, 'posts'), { recursive: true, force: true });
    await models.sequelize.sync({ force: true });
    alice = request.agent(app); bob = request.agent(app); admin = request.agent(app);
    await alice.post('/signup').send({ email: 'alice@example.com', password: PW, firstName: 'A' });
    await bob.post('/signup').send({ email: 'bob@example.com', password: PW, firstName: 'B' });
    await admin.post('/signup').send({ email: 'admin@example.com', password: PW, firstName: 'C' });
    await models.User.update({ role: 'admin' }, { where: { email: 'admin@example.com' } });
    const p = await alice.post('/post').send({ title: 'Sale', street: '1 Main St', city: 'NYC', zipCode: '10001', description: 'stuff' });
    assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    postId = p.body.id;
  });

  const upload = (agent, files) => {
    let r = agent.post(`/post/${postId}/photos`);
    files.forEach(([buf, name]) => { r = r.attach('photos', buf, name); });
    return r;
  };

  it('accepts JPEG, PNG and WebP and returns photo URLs', async () => {
    const res = await upload(alice, [[await makeImage('jpeg', 50, 40), 'a.jpg'], [await makeImage('png', 50, 40), 'b.png'], [await makeImage('webp', 50, 40), 'c.webp']]);
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.length, 3);
    assert.ok(/^\/api\/uploads\/posts\/\d+\/[0-9a-f]+\.webp$/.test(res.body[0].url));
    assert.ok(!('storageKey' in res.body[0]));
    const post = await request(app).get(`/post/${postId}`);
    assert.strictEqual(post.body.photos.length, 3);
    assert.deepStrictEqual(post.body.photos.map((p) => p.url), res.body.map((p) => p.url));
    assert.ok(!JSON.stringify(post.body).includes('storageKey'));
    const list = await request(app).get('/allPosts');
    assert.strictEqual(list.body[0].photos.length, 3);
    assert.ok(list.body[0].photos[0].thumbUrl.endsWith('-thumb.webp'));
    assert.ok(!JSON.stringify(list.body).includes('storageKey'));
  });

  it('checks file contents, not the extension', async () => {
    const res = await upload(alice, [[Buffer.from('GIF89a not really an image at all'), 'evil.jpg']]);
    assert.strictEqual(res.status, 415);
    assert.strictEqual(res.body.error.code, 'unsupported_type');
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).gif().toBuffer();
    assert.strictEqual((await upload(alice, [[gif, 'x.png']])).status, 415);
    const truncated = (await makeImage('png', 10, 10)).slice(0, 20);
    assert.strictEqual((await upload(alice, [[truncated, 't.png']])).status, 400);
    assert.strictEqual(await models.PostPhoto.count(), 0);
  });

  it('rejects files over 8 MB', async () => {
    const big = Buffer.concat([await makeImage('jpeg', 10, 10), Buffer.alloc(8 * 1024 * 1024 + 1)]);
    const res = await upload(alice, [[big, 'big.jpg']]);
    assert.strictEqual(res.status, 413);
    assert.strictEqual(res.body.error.code, 'file_too_large');
  });

  it('allows at most 5 photos per post', async () => {
    const img = await makeImage('jpeg', 20, 20);
    assert.strictEqual((await upload(alice, [1, 2, 3, 4].map((i) => [img, i + '.jpg']))).status, 201);
    const res = await upload(alice, [[img, '5.jpg'], [img, '6.jpg']]);
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await upload(alice, [[img, '5.jpg']])).status, 201);
    assert.strictEqual(await models.PostPhoto.count(), 5);
    assert.strictEqual((await upload(alice, [1, 2, 3, 4, 5, 6].map((i) => [img, i + '.jpg']))).status, 400);
  });

  it('only the owner or an admin can add or delete photos', async () => {
    const img = await makeImage('jpeg', 20, 20);
    assert.strictEqual((await upload(request(app), [[img, 'a.jpg']])).status, 401);
    assert.strictEqual((await upload(bob, [[img, 'a.jpg']])).status, 403);
    const own = await upload(alice, [[img, 'a.jpg']]);
    assert.strictEqual(own.status, 201);
    const byAdmin = await upload(admin, [[img, 'b.jpg']]);
    assert.strictEqual(byAdmin.status, 201);
    assert.strictEqual((await bob.delete(`/post/${postId}/photos/${own.body[0].id}`)).status, 403);
    assert.strictEqual((await admin.delete(`/post/${postId}/photos/${own.body[0].id}`)).status, 204);
    assert.strictEqual((await alice.delete(`/post/${postId}/photos/${byAdmin.body[0].id}`)).status, 204);
    assert.strictEqual((await alice.delete(`/post/${postId}/photos/999`)).status, 404);
    assert.strictEqual(fs.readdirSync(path.join(dir, 'posts', String(postId))).length, 0);
  });

  it('resizes to 1600px max plus a 400px thumbnail, as WebP without EXIF/GPS', async () => {
    const src = await makeImage('jpeg', 3200, 1800, { exif: true });
    const srcMeta = await sharp(src).metadata();
    assert.ok(srcMeta.exif, 'fixture should carry EXIF');
    const res = await upload(alice, [[src, 'big.jpg']]);
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body[0].width, 1600);
    assert.strictEqual(res.body[0].height, 900);
    const fullRes = await request(app).get(res.body[0].url.replace('/api', ''));
    assert.strictEqual(fullRes.status, 200);
    assert.strictEqual(fullRes.headers['content-type'], 'image/webp');
    assert.strictEqual(fullRes.headers['x-content-type-options'], 'nosniff');
    const full = await sharp(fullRes.body).metadata();
    assert.strictEqual(full.format, 'webp');
    assert.strictEqual(full.width, 1600);
    assert.ok(!full.exif && !full.xmp && !full.icc, 'metadata must be stripped');
    assert.ok(!fullRes.body.includes(Buffer.from('SecretCam')));
    const thumbRes = await request(app).get(res.body[0].thumbUrl.replace('/api', ''));
    const thumb = await sharp(thumbRes.body).metadata();
    assert.strictEqual(thumb.width, 400);
    assert.strictEqual(thumb.format, 'webp');
    assert.ok(!thumb.exif);
  });

  it('does not upscale small images', async () => {
    const res = await upload(alice, [[await makeImage('png', 300, 200), 's.png']]);
    assert.strictEqual(res.body[0].width, 300);
  });

  it('serves uploads read-only', async () => {
    const res = await upload(alice, [[await makeImage('jpeg', 20, 20), 'a.jpg']]);
    const p = res.body[0].url.replace('/api', '');
    assert.strictEqual((await request(app).put(p).send('x')).status, 405);
    assert.strictEqual((await request(app).delete(p)).status, 405);
    assert.strictEqual((await request(app).get('/uploads/posts/')).status, 404);
    assert.strictEqual((await request(app).get('/uploads/../package.json')).status, 404);
  });

  it('deleting a post removes its photos and files', async () => {
    const img = await makeImage('jpeg', 20, 20);
    await upload(alice, [[img, 'a.jpg'], [img, 'b.jpg']]);
    assert.strictEqual(fs.readdirSync(path.join(dir, 'posts', String(postId))).length, 4);
    assert.strictEqual((await alice.delete(`/post/${postId}`)).status, 204);
    assert.strictEqual(await models.PostPhoto.count(), 0);
    assert.strictEqual(fs.readdirSync(path.join(dir, 'posts', String(postId))).length, 0);
  });

  it('admin deleting a post also removes its photos', async () => {
    await upload(alice, [[await makeImage('jpeg', 20, 20), 'a.jpg']]);
    assert.strictEqual((await admin.delete(`/post/${postId}`)).status, 204);
    assert.strictEqual(await models.PostPhoto.count(), 0);
  });

  it('lets the seller describe each photo (alt text); others cannot', async () => {
    const up = await upload(alice, [[await makeImage('png', 50, 40), 'a.png'], [await makeImage('png', 50, 40), 'b.png']]);
    const [a, b] = up.body;
    assert.strictEqual(a.alt, null);
    const ok = await alice.put(`/post/${postId}/photos/${a.id}`).send({ alt: '  Green velvet couch,\n three seats  ' });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.alt, 'Green velvet couch, three seats');
    const post = await request(app).get(`/post/${postId}`);
    assert.deepStrictEqual(post.body.photos.map((p) => p.alt), ['Green velvet couch, three seats', null]);
    // Validation, ownership, wrong post
    assert.strictEqual((await alice.put(`/post/${postId}/photos/${a.id}`).send({ alt: 5 })).status, 400);
    const long = await alice.put(`/post/${postId}/photos/${a.id}`).send({ alt: 'x'.repeat(251) });
    assert.strictEqual(long.status, 400);
    assert.strictEqual(long.body.error.details.alt, 'Keep it under 250 characters.');
    assert.strictEqual((await bob.put(`/post/${postId}/photos/${a.id}`).send({ alt: 'mine now' })).status, 403);
    assert.strictEqual((await request(app).put(`/post/${postId}/photos/${a.id}`).send({ alt: 'anon' })).status, 401);
    assert.strictEqual((await alice.put(`/post/${postId}/photos/999999`).send({ alt: 'nope' })).status, 404);
    assert.strictEqual((await admin.put(`/post/${postId}/photos/${b.id}`).send({ alt: 'Admin fixed it' })).status, 200);
    // Clearing goes back to the default
    const cleared = await alice.put(`/post/${postId}/photos/${a.id}`).send({ alt: '   ' });
    assert.strictEqual(cleared.body.alt, null);
  });
});
