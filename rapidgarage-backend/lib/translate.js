'use strict';
// Multi-language listings: optional machine translation of a sale's title,
// description and item names into the reader's language.
//
// Provider (optional, off by default): any LibreTranslate-compatible server
// (self-hosted LibreTranslate is free and needs no account):
//   TRANSLATE_URL        base URL, e.g. http://localhost:5000 (POST <url>/translate)
//   TRANSLATE_API_KEY    only if that server requires one
//   TRANSLATE_TIMEOUT_MS request timeout (default 8000)
//   TRANSLATE_PER_MINUTE translation requests per IP per minute (default 20)
// Without a provider, or when it fails, readers get the original text and the
// apps show which language it is written in. Results are cached per
// (source, target, text) in Translations, so each text is sent once.
const crypto = require('crypto');
const i18n = require('./i18n');

function models() { return require('../models'); }
function intEnv(name, dflt, min, max) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
}
const MAX_CHARS = 6000; // per listing request (title + description + item names)

let testProvider = null;
// Tests: setProvider(async (texts, source, target) => [translated...]) or null.
function setProvider(fn) { testProvider = fn; }

function baseUrl() {
  const raw = String(process.env.TRANSLATE_URL || '').trim();
  if (!raw) return null;
  try { const u = new URL(raw); return /^https?:$/.test(u.protocol) ? raw.replace(/\/+$/, '') : null; } catch (e) { return null; }
}
const configured = () => !!(testProvider || baseUrl());

// Our codes -> LibreTranslate codes.
const providerLang = (code) => (code === 'zh-CN' ? 'zh' : code);

async function libreTranslate(texts, source, target) {
  const url = baseUrl();
  const body = { q: texts, source: source ? providerLang(source) : 'auto', target: providerLang(target), format: 'text' };
  const key = String(process.env.TRANSLATE_API_KEY || '').trim();
  if (key) body.api_key = key;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), intEnv('TRANSLATE_TIMEOUT_MS', 8000, 500, 60000));
  try {
    const res = await fetch(url + '/translate', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) throw new Error('translate HTTP ' + res.status);
    const data = await res.json();
    const out = Array.isArray(data.translatedText) ? data.translatedText : [data.translatedText];
    if (out.length !== texts.length || out.some((x) => typeof x !== 'string')) throw new Error('translate: bad response');
    return out;
  } finally { clearTimeout(timer); }
}

const hashOf = (source, target, text) => crypto.createHash('sha256').update((source || 'auto') + '\u0000' + target + '\u0000' + text).digest('hex');

// texts -> translated texts (same order), or null when unavailable/failed.
async function translateTexts(texts, source, target) {
  if (!configured()) return null;
  const m = models();
  const uniq = Array.from(new Set(texts.filter((x) => typeof x === 'string' && x.trim())));
  const hashes = new Map(uniq.map((x) => [x, hashOf(source, target, x)]));
  const known = new Map();
  if (uniq.length) {
    const rows = await m.Translation.findAll({ where: { hash: Array.from(hashes.values()) }, attributes: ['hash', 'text'], raw: true });
    const byHash = new Map(rows.map((r) => [r.hash, r.text]));
    uniq.forEach((x) => { if (byHash.has(hashes.get(x))) known.set(x, byHash.get(hashes.get(x))); });
  }
  const missing = uniq.filter((x) => !known.has(x));
  if (missing.length) {
    let got;
    try { got = await (testProvider || libreTranslate)(missing, source, target); } catch (err) {
      console.warn('translate: provider failed (' + (err && err.message ? err.message : 'error') + '); showing originals');
      return null;
    }
    if (!Array.isArray(got) || got.length !== missing.length) return null;
    const rows = missing.map((x, i) => ({ hash: hashes.get(x), source: source || 'auto', target, text: String(got[i]) }));
    rows.forEach((r, i) => known.set(missing[i], r.text));
    await m.Translation.bulkCreate(rows, { ignoreDuplicates: true }).catch(() => {});
  }
  return texts.map((x) => (typeof x === 'string' && known.has(x) ? known.get(x) : x));
}

// The listing in `target`: { from, to, available, translated, reason?, title, description, items: [{ id, name }] }.
// reason: same (already in that language) | unavailable (no provider) | failed | too_long.
async function listing(post, target) {
  const from = i18n.normalize(post.language) || null;
  const items = (post.items || []).slice().sort((a, b) => a.position - b.position || a.id - b.id);
  const out = { from, to: target, available: configured(), translated: false, title: post.title, description: post.description || null,
    items: items.map((i) => ({ id: i.id, name: i.name })) };
  if (from === target) return Object.assign(out, { reason: 'same' });
  if (!out.available) return Object.assign(out, { reason: 'unavailable' });
  const texts = [post.title, post.description || ''].concat(items.map((i) => i.name));
  if (texts.reduce((n, x) => n + x.length, 0) > MAX_CHARS) return Object.assign(out, { reason: 'too_long' });
  const got = await translateTexts(texts, from, target);
  if (!got) return Object.assign(out, { reason: 'failed' });
  return Object.assign(out, { translated: true, title: got[0], description: post.description ? got[1] : null,
    items: items.map((i, k) => ({ id: i.id, name: got[2 + k] })) });
}

module.exports = { configured, setProvider, translateTexts, listing, providerLang, hashOf, MAX_CHARS };
