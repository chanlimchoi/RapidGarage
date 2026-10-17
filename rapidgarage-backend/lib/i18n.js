'use strict';
// Server-side translations for the four UI languages.
//
// Two kinds of text:
//  * strings: keyed ("flyer.when", "mail.hi") for things the server renders
//    itself (flyer PDFs, alert emails, short-link pages). t(lang, key, vars).
//  * messages: API error/notice text, keyed by the English sentence the code
//    already sends ("Post not found."). translate(lang, english) looks it up;
//    sentences built from numbers or labels match a template in the catalog
//    ("Keep the note under {n} characters.") and their slots are translated
//    or number-formatted too. Code keeps writing plain English, and clients
//    that don't send a language get exactly what they got before.
//
// Catalogs (locales/*.json) are generated from the shared translation table.
// In tests every message passed through translate() is checked against all
// catalogs, so test/zz-i18n-coverage.test.js fails if one is untranslated.
const path = require('path');

const LOCALES = [
  { code: 'en', intl: 'en-US' },
  { code: 'es', intl: 'es-US' },
  { code: 'ko', intl: 'ko-KR' },
  { code: 'zh-CN', intl: 'zh-CN' },
];
const CODES = LOCALES.map((l) => l.code);
const CATALOGS = {};
CODES.forEach((c) => { CATALOGS[c] = require(path.join(__dirname, '..', 'locales', c + '.json')); });
const intlLocale = (lang) => (LOCALES.find((l) => l.code === lang) || LOCALES[0]).intl;

// "ko-KR" -> "ko", "zh-TW" -> "zh-CN", "es-419" -> "es"; unknown -> null.
function normalize(tag) {
  if (!tag || typeof tag !== 'string') return null;
  const t = tag.trim().toLowerCase().replace('_', '-');
  if (!t) return null;
  if (t === 'zh' || t.startsWith('zh-')) return 'zh-CN';
  const base = t.split('-')[0];
  return CODES.includes(base) ? base : null;
}

// Accept-Language: "ko-KR,ko;q=0.9,en;q=0.8" -> best supported code or null.
function fromAcceptLanguage(header) {
  if (!header || typeof header !== 'string') return null;
  const prefs = header.split(',').map((part, i) => {
    const [tag, ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return { tag, q: q ? Number(q.slice(2)) : 1, i };
  }).filter((p) => p.tag && p.tag !== '*' && p.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const p of prefs) { const c = normalize(p.tag); if (c) return c; }
  return null;
}

// The language for a request: what the client asks for (the web app sends its
// current UI language on every call), else the account's saved language.
function requestLang(req) {
  return fromAcceptLanguage(req && req.get ? req.get('Accept-Language') : null)
    || (req && req.user && normalize(req.user.locale))
    || 'en';
}

const formatNumber = (lang, n) => { try { return new Intl.NumberFormat(intlLocale(lang)).format(n); } catch (e) { return String(n); } };
const interpolate = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : String(s));

function pluralForm(lang, entry, n) {
  if (!entry || typeof entry !== 'object') return entry;
  let cat = 'other';
  try { cat = new Intl.PluralRules(intlLocale(lang)).select(n); } catch (e) { /* default */ }
  return entry[cat] !== undefined ? entry[cat] : entry.other;
}

// t('ko', 'mail.subjectMany', { count: 3 }); missing keys fall back to English, then the key.
function t(lang, key, vars) {
  const code = CODES.includes(lang) ? lang : 'en';
  let entry = CATALOGS[code].strings[key];
  let used = code;
  if (entry === undefined) { entry = CATALOGS.en.strings[key]; used = 'en'; }
  if (entry === undefined) return key;
  const n = vars && typeof vars.count === 'number' ? vars.count : 0;
  const v = vars && typeof vars.count === 'number' ? Object.assign({}, vars, { count: formatNumber(used, vars.count) }) : vars;
  return interpolate(pluralForm(used, entry, n), v);
}

// ---- messages -----------------------------------------------------------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TEMPLATES = Object.keys(CATALOGS.en.messages).filter((k) => /\{\w+\}/.test(k)).map((k) => {
  const names = [];
  const src = k.split(/(\{\w+\})/).map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    if (!m) return esc(part);
    names.push(m[1]);
    return '(.+?)';
  }).join('');
  return { key: k, re: new RegExp('^' + src + '$'), names };
});

const NUM_RE = /^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/;
function fill(lang, value) {
  if (NUM_RE.test(value)) return formatNumber(lang, Number(value.replace(/,/g, '')));
  const exact = CATALOGS[lang].messages[value];
  return exact !== undefined ? exact : value;
}

// Test mode: remember English messages that some catalog can't translate.
const misses = new Set();
const recording = process.env.NODE_ENV === 'test';

function find(english) {
  if (CATALOGS.en.messages[english] !== undefined) return { key: english, vars: null };
  for (const tpl of TEMPLATES) {
    const m = tpl.re.exec(english);
    if (m) { const vars = {}; tpl.names.forEach((n, i) => { vars[n] = m[i + 1]; }); return { key: tpl.key, vars }; }
  }
  return null;
}

function translate(lang, english) {
  if (typeof english !== 'string' || !english) return english;
  const hit = find(english);
  if (!hit) { if (recording) misses.add(english); return english; }
  if (recording) CODES.forEach((c) => { if (CATALOGS[c].messages[hit.key] === undefined) misses.add(c + ': ' + english); });
  if (lang === 'en' || !CODES.includes(lang)) return english;
  const out = CATALOGS[lang].messages[hit.key];
  if (out === undefined) return english;
  if (!hit.vars) return out;
  const vars = {};
  Object.keys(hit.vars).forEach((k) => { vars[k] = fill(lang, hit.vars[k]); });
  return interpolate(out, vars);
}

// Field errors ({ title: "Title is required.", "days.0": "..." }), translated in place.
function translateDetails(lang, details) {
  if (!details || typeof details !== 'object') return details;
  const out = Array.isArray(details) ? [] : {};
  Object.keys(details).forEach((k) => {
    const v = details[k];
    out[k] = typeof v === 'string' ? translate(lang, v) : (v && typeof v === 'object' ? translateDetails(lang, v) : v);
  });
  return out;
}

module.exports = {
  LOCALES, CODES, normalize, fromAcceptLanguage, requestLang, intlLocale, formatNumber, t, translate, translateDetails,
  _misses: misses, _catalogs: CATALOGS,
};
