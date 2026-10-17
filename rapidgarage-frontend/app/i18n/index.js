// Tiny i18n: flat catalogs ("nav.browse": "Browse"), {name} placeholders,
// plurals as { one, other } objects chosen with Intl.PluralRules (count).
// English is bundled; other catalogs are loaded on demand. The App re-mounts
// its routes when the language changes (components are classes and call t()).
import en from './locales/en.js';

export const LOCALES = [
  { code: 'en', name: 'English', intl: 'en-US' },
  { code: 'es', name: 'Español', intl: 'es-US' },
  { code: 'ko', name: '한국어', intl: 'ko-KR' },
  { code: 'zh-CN', name: '简体中文', intl: 'zh-CN' },
];
const CODES = LOCALES.map((l) => l.code);
const LOADERS = {
  es: () => import('./locales/es.js'),
  ko: () => import('./locales/ko.js'),
  'zh-CN': () => import('./locales/zh-CN.js'),
};
const STORAGE_KEY = 'rg-locale';

let current = 'en';
let catalog = en;
const listeners = new Set();

// "ko-KR" -> "ko", "zh-TW"/"zh-Hant" -> "zh-CN" (the only Chinese we have),
// "es-419" -> "es"; unknown -> null.
export function normalize(tag) {
  if (!tag) return null;
  const t = String(tag).trim().toLowerCase().replace('_', '-');
  if (!t) return null;
  if (t === 'zh' || t.startsWith('zh-')) return 'zh-CN';
  const base = t.split('-')[0];
  return CODES.includes(base) ? base : null;
}

// Saved choice, else the browser's preferred languages, else English.
export function detect(nav, storage) {
  const n = nav || (typeof navigator !== 'undefined' ? navigator : {});
  try {
    const saved = normalize((storage || window.localStorage).getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch (e) { /* storage blocked */ }
  const prefs = (n.languages && n.languages.length ? n.languages : [n.language]).filter(Boolean);
  for (const p of prefs) { const c = normalize(p); if (c) return c; }
  return 'en';
}

export const locale = () => current;
export const intlLocale = (code) => (LOCALES.find((l) => l.code === (code || current)) || LOCALES[0]).intl;

const interpolate = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : s);
const plural = (entry, vars, code) => {
  if (!entry || typeof entry !== 'object') return entry;
  const n = vars && typeof vars.count === 'number' ? vars.count : 0;
  let cat = 'other';
  try { cat = new Intl.PluralRules(intlLocale(code)).select(n); } catch (e) { /* default */ }
  return entry[cat] !== undefined ? entry[cat] : entry.other;
};

// t('post.days', { count: 3 }) -> "3 days"; missing keys fall back to English, then the key.
export function t(key, vars) {
  let entry = catalog[key];
  let code = current;
  if (entry === undefined) { entry = en[key]; code = 'en'; }
  if (entry === undefined) return key;
  const s = plural(entry, vars, code);
  const v = vars && typeof vars.count === 'number' ? Object.assign({}, vars, { count: formatNumber(vars.count, code) }) : vars;
  return interpolate(String(s), v);
}

export function formatNumber(n, code) {
  try { return new Intl.NumberFormat(intlLocale(code)).format(n); } catch (e) { return String(n); }
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function applyDocument(code) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = code;
  document.documentElement.setAttribute('data-locale', code);
}

// Load (if needed) and switch. persist=false for "apply the user's saved
// language" without overwriting this device's choice.
export async function setLocale(code, opts) {
  const c = normalize(code) || 'en';
  const next = c === 'en' ? en : Object.assign({}, en, (await LOADERS[c]()).default);
  const changed = c !== current;
  current = c;
  catalog = next;
  applyDocument(c);
  if (!opts || opts.persist !== false) {
    try { window.localStorage.setItem(STORAGE_KEY, c); } catch (e) { /* ignore */ }
  }
  if (changed) listeners.forEach((fn) => fn(c));
  return c;
}

export function init() {
  return setLocale(detect(), { persist: false }).catch(() => setLocale('en', { persist: false }));
}

// For tests.
export const _catalogs = { en };
