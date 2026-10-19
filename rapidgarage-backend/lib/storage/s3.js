// S3-compatible photo storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO...).
// Same put/remove/read contract as LocalStorage, so nothing else changes:
// photos are still served through /api/uploads unless PHOTO_PUBLIC_BASE
// points at a CDN or public bucket URL.
//
//   PHOTO_STORAGE=s3
//   S3_BUCKET=rapidgarage-photos       required
//   S3_REGION=us-east-1                ("auto" for R2)
//   S3_ENDPOINT=https://<acct>.r2.cloudflarestorage.com   (non-AWS only)
//   S3_FORCE_PATH_STYLE=true           (MinIO)
//   S3_PREFIX=photos/                  optional key prefix
//   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY   else the default AWS chain
//                                      (env, instance role, ...)
const KEY_RE = /^[a-z0-9][a-z0-9/_-]*\.webp$/;

class S3Storage {
  // options: { bucket, prefix, client } (client: an S3Client; tests pass a fake)
  constructor(options) {
    if (!options || !options.bucket) throw new Error('S3_BUCKET is required for PHOTO_STORAGE=s3');
    this.bucket = options.bucket;
    this.prefix = options.prefix || '';
    this.client = options.client;
    this.sdk = require('@aws-sdk/client-s3');
  }

  static fromEnv(env) {
    const e = env || process.env;
    const { S3Client } = require('@aws-sdk/client-s3');
    const cfg = { region: String(e.S3_REGION || 'us-east-1').trim() };
    if (e.S3_ENDPOINT) cfg.endpoint = String(e.S3_ENDPOINT).trim();
    if (/^(1|true|yes|on)$/i.test(String(e.S3_FORCE_PATH_STYLE || ''))) cfg.forcePathStyle = true;
    if (e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY) cfg.credentials = { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY };
    return new S3Storage({ bucket: String(e.S3_BUCKET || '').trim(), prefix: String(e.S3_PREFIX || '').trim(), client: new S3Client(cfg) });
  }

  objectKey(key) {
    if (!KEY_RE.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    return this.prefix + key;
  }

  async put(key, buffer, contentType) {
    await this.client.send(new this.sdk.PutObjectCommand({
      Bucket: this.bucket, Key: this.objectKey(key), Body: buffer,
      ContentType: contentType || 'image/webp',
      // Keys are content-addressed per upload: safe to cache for a long time.
      CacheControl: 'public, max-age=2592000, immutable',
    }));
  }

  async remove(key) {
    // S3 deletes are idempotent: a missing key is not an error.
    await this.client.send(new this.sdk.DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
  }

  // Resolves to a Buffer; a missing object rejects with code 'ENOENT' like the
  // local driver, so /api/uploads answers 404.
  read(key) {
    // An invalid key throws right away (like LocalStorage), so /api/uploads answers 404.
    return this.fetch(this.objectKey(key));
  }

  async fetch(objectKey) {
    try {
      const out = await this.client.send(new this.sdk.GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return Buffer.from(await out.Body.transformToByteArray());
    } catch (err) {
      if (err && (err.name === 'NoSuchKey' || err.name === 'NotFound' || (err.$metadata && err.$metadata.httpStatusCode === 404))) {
        throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
      }
      throw err;
    }
  }

  // Startup check: the bucket exists and the credentials can reach it.
  async check() {
    await this.client.send(new this.sdk.HeadBucketCommand({ Bucket: this.bucket }));
  }
}

module.exports = S3Storage;
