// One-time move of existing photos from local disk to the S3 bucket:
//   ( set -a; . ./.env; set +a; node scripts/copy-uploads-to-s3.js [--dry-run] )
// Reads UPLOAD_DIR (default ./uploads) and writes every *.webp under the same
// key with the S3_* settings. Existing objects are overwritten with the same
// bytes, so it is safe to run again. Switch PHOTO_STORAGE=s3 afterwards.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const S3Storage = require('../lib/storage/s3');
const { uploadDir } = require('../lib/storage');

const dry = process.argv.includes('--dry-run');
function walk(dir, base) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const rel = base ? base + '/' + d.name : d.name;
    if (d.isDirectory()) return walk(path.join(dir, d.name), rel);
    return d.name.endsWith('.webp') ? [rel] : [];
  });
}

(async () => {
  const dir = uploadDir();
  const keys = walk(dir, '');
  console.log((dry ? '[dry run] ' : '') + keys.length + ' photo file(s) in ' + dir);
  if (dry || !keys.length) return;
  const s3 = S3Storage.fromEnv(process.env);
  await s3.check();
  let done = 0;
  for (const key of keys) {
    await s3.put(key, fs.readFileSync(path.join(dir, key)), 'image/webp');
    if (++done % 100 === 0) console.log(done + ' / ' + keys.length);
  }
  console.log('Copied ' + done + ' file(s) to s3://' + s3.bucket + '/' + s3.prefix);
})().catch((err) => { console.error('Copy failed:', err && (err.name || err.message)); process.exit(1); });
