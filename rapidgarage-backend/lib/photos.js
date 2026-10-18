// Upload validation and image processing for post photos.
const crypto = require('crypto');
const sharp = require('sharp');

const MAX_PHOTOS_PER_POST = 5;
// Photo descriptions (alt text): short, one line.
const ALT_MAX = 250;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const FULL_MAX_PX = 1600;
const THUMB_PX = 400;

// Identify the real format from magic bytes; the filename/extension and the
// client's Content-Type are never trusted.
function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// Decode, auto-rotate per EXIF orientation, resize, and re-encode as WebP.
// sharp drops all metadata (EXIF, GPS, XMP, ICC) unless asked to keep it.
async function processImage(buf) {
  const type = sniffImageType(buf);
  if (!type) { const e = new Error('unsupported_type'); e.code = 'unsupported_type'; throw e; }
  let meta;
  try {
    meta = await sharp(buf, { limitInputPixels: 50e6 }).metadata();
  } catch (_) {
    const e = new Error('corrupt_image'); e.code = 'corrupt_image'; throw e;
  }
  if (meta.format !== type) { const e = new Error('unsupported_type'); e.code = 'unsupported_type'; throw e; }
  const base = sharp(buf, { limitInputPixels: 50e6 }).rotate();
  const full = await base.clone()
    .resize({ width: FULL_MAX_PX, height: FULL_MAX_PX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await base.clone()
    .resize({ width: THUMB_PX, height: THUMB_PX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();
  return { full: full.data, width: full.info.width, height: full.info.height, thumb };
}

function newKeys(postId) {
  const id = crypto.randomBytes(12).toString('hex');
  return { storageKey: `posts/${postId}/${id}.webp`, thumbKey: `posts/${postId}/${id}-thumb.webp` };
}

// -> { value } (null clears it) or { error }. Line breaks and control
// characters become spaces; runs of spaces collapse.
function parseAlt(raw) {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== 'string') return { error: 'Photo description must be text.' };
  // eslint-disable-next-line no-control-regex
  const v = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (v.length > ALT_MAX) return { error: 'Keep it under ' + ALT_MAX + ' characters.' };
  return { value: v || null };
}

module.exports = { MAX_PHOTOS_PER_POST, ALT_MAX, parseAlt, MAX_FILE_BYTES, FULL_MAX_PX, THUMB_PX, sniffImageType, processImage, newKeys };
