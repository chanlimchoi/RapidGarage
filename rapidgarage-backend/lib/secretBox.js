// AES-256-GCM encryption for small secrets stored at rest (e.g. per-user Maps keys).
// The 32-byte key is derived from KEY_ENCRYPTION_SECRET; ciphertext format:
//   v1:<iv b64>:<auth tag b64>:<ciphertext b64>
const crypto = require('crypto');

function getKey() {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length < 16) return null;
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function isConfigured() {
  return getKey() !== null;
}

function encrypt(plaintext) {
  const key = getKey();
  if (!key) throw new Error('KEY_ENCRYPTION_SECRET is not configured');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

function decrypt(payload) {
  const key = getKey();
  if (!key) throw new Error('KEY_ENCRYPTION_SECRET is not configured');
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Unrecognized ciphertext format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, isConfigured };
