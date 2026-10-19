// Pluggable photo storage: "local" (disk, default) or "s3" (lib/storage/s3.js:
// AWS S3, Cloudflare R2, Backblaze B2, MinIO). Both implement:
//   put(key, buffer, contentType) -> Promise
//   remove(key)                   -> Promise (missing keys are not an error)
//   read(key)                     -> Promise<Buffer>
const path = require('path');
const LocalStorage = require('./local');

let instance = null;

function getStorage() {
  if (instance) return instance;
  const driver = (process.env.PHOTO_STORAGE || 'local').toLowerCase();
  if (driver === 's3') instance = require('./s3').fromEnv(process.env);
  else if (driver === 'local') instance = new LocalStorage(uploadDir());
  else throw new Error('Unknown PHOTO_STORAGE driver: ' + driver);
  return instance;
}

function uploadDir() {
  return path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'));
}

// Base URL the browser uses for stored files. The Vite dev server proxies
// /api -> backend, so the default is /api/uploads.
function publicUrl(key) {
  const base = (process.env.PHOTO_PUBLIC_BASE || '/api/uploads').replace(/\/+$/, '');
  return base + '/' + key;
}

// Tests swap in a fresh instance (e.g. a temp dir).
function setStorage(s) { instance = s; }

module.exports = { getStorage, setStorage, uploadDir, publicUrl };
