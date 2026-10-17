'use strict';
// Short links for printed QR codes: /s/<code> -> /post/<id>.
// Codes are 8 random characters from a 31-letter alphabet without look-alikes
// (no 0/o, 1/l/i): 31^8 ≈ 8.5e11 combinations, independent of the post id, so
// they can't be guessed from (or used to walk) post ids.
const crypto = require('crypto');

const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const LENGTH = 8;
const CODE_RE = new RegExp('^[' + ALPHABET + ']{' + LENGTH + '}$');

function newCode() {
  // 256 % 31 != 0, so reject the top bytes to keep the draw uniform.
  const out = [];
  while (out.length < LENGTH) {
    for (const b of crypto.randomBytes(LENGTH * 2)) {
      if (b < 248 && out.length < LENGTH) out.push(ALPHABET[b % 31]);
    }
  }
  return out.join('');
}

// Accepts any case (people sometimes type the printed URL); null if malformed.
function normalize(raw) {
  const c = String(raw || '').trim().toLowerCase();
  return CODE_RE.test(c) ? c : null;
}

function baseUrl() {
  return String(process.env.APP_BASE_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:3000').trim().replace(/\/+$/, '');
}

const shortUrl = (code) => baseUrl() + '/s/' + code;
const postUrl = (id) => baseUrl() + '/post/' + id;

// Give an older post a code if it has none (retries on the rare collision).
async function ensureCode(post) {
  if (post.shortCode) return post.shortCode;
  for (let i = 0; i < 5; i++) {
    try {
      await post.update({ shortCode: newCode() }, { silent: true });
      return post.shortCode;
    } catch (err) {
      if (!err || err.name !== 'SequelizeUniqueConstraintError') throw err;
    }
  }
  throw new Error('Could not allocate a short code');
}

module.exports = { ALPHABET, LENGTH, newCode, normalize, baseUrl, shortUrl, postUrl, ensureCode };
