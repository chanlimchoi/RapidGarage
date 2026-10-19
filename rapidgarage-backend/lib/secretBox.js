// AES-256-GCM encryption for small secrets stored at rest (per-user Maps and
// AI keys). Keys come from KEY_ENCRYPTION_SECRET.
//
//   v1:<iv>:<tag>:<ct>   key = sha256(secret); no context (Maps keys, as before)
//   v2:<iv>:<tag>:<ct>   key = HKDF-SHA256(secret, purpose); the context string
//                        (e.g. "ai-key:user:42") is authenticated as AAD, so a
//                        ciphertext only decrypts for the same purpose and row.
//                        Copying one user's value onto another user (SQL
//                        injection, a bad restore) yields an error, not a key.
const crypto = require('crypto');

function secret() {
  const s = process.env.KEY_ENCRYPTION_SECRET;
  return s && s.length >= 16 ? s : null;
}

function getKey() {
  const s = secret();
  return s ? crypto.createHash('sha256').update(s, 'utf8').digest() : null;
}

// A separate 32-byte key per purpose ("ai-key", ...), derived with HKDF.
function purposeKey(purpose) {
  const s = secret();
  if (!s) return null;
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(s, 'utf8'), Buffer.from('rapidgarage-secretbox-v2'), Buffer.from(String(purpose)), 32));
}

function isConfigured() {
  return secret() !== null;
}

const purposeOf = (context) => String(context).split(':')[0];

// encrypt(text) -> v1 (unchanged format); encrypt(text, context) -> v2.
function encrypt(plaintext, context) {
  const key = context ? purposeKey(purposeOf(context)) : getKey();
  if (!key) throw new Error('KEY_ENCRYPTION_SECRET is not configured');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (context) cipher.setAAD(Buffer.from(String(context), 'utf8'));
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [context ? 'v2' : 'v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

// v2 values need the same context they were written with.
function decrypt(payload, context) {
  const parts = String(payload).split(':');
  if (parts.length !== 4 || (parts[0] !== 'v1' && parts[0] !== 'v2')) throw new Error('Unrecognized ciphertext format');
  if (parts[0] === 'v2' && !context) throw new Error('This secret needs its context to decrypt');
  const key = parts[0] === 'v2' ? purposeKey(purposeOf(context)) : getKey();
  if (!key) throw new Error('KEY_ENCRYPTION_SECRET is not configured');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'));
  if (parts[0] === 'v2') decipher.setAAD(Buffer.from(String(context), 'utf8'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, isConfigured };
