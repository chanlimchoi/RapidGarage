// node --test test/  -- translation catalogs are complete and every key the
// UI uses exists. Keys are always literal strings in the source (never built
// by concatenation), so scanning for them finds every use.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import en from '../app/i18n/locales/en.js';
import es from '../app/i18n/locales/es.js';
import ko from '../app/i18n/locales/ko.js';
import zh from '../app/i18n/locales/zh-CN.js';
import * as i18n from '../app/i18n/index.js';

const CATALOGS = { en, es, ko, 'zh-CN': zh };
const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const forms = (v) => (typeof v === 'object' ? Object.values(v) : [v]);

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return p.endsWith(path.join('i18n', 'locales')) ? [] : sourceFiles(p);
    return /\.(js|jsx)$/.test(d.name) ? [p] : [];
  });
}

describe('i18n catalogs', () => {
  test('the four languages are offered', () => {
    assert.deepEqual(i18n.LOCALES.map((l) => l.code).sort(), ['en', 'es', 'ko', 'zh-CN']);
  });

  for (const [code, cat] of Object.entries(CATALOGS)) {
    if (code === 'en') continue;
    test(code + ' has exactly the English keys (none missing, none stray)', () => {
      const missing = Object.keys(en).filter((k) => !(k in cat));
      const extra = Object.keys(cat).filter((k) => !(k in en));
      assert.deepEqual(missing, [], 'missing in ' + code);
      assert.deepEqual(extra, [], 'not in English: ' + code);
    });

    test(code + ' keeps every placeholder and plural shape', () => {
      for (const [k, v] of Object.entries(en)) {
        const tv = cat[k];
        assert.equal(typeof tv === 'object', typeof v === 'object', k + ' plural shape');
        if (typeof v === 'object') {
          assert.ok(typeof tv.other === 'string', k + ' needs an "other" form');
          // Every plural category the language uses must be present.
          const need = new Intl.PluralRules(i18n.intlLocale(code)).resolvedOptions().pluralCategories
            .filter((c) => ['one', 'other'].includes(c));
          for (const c of need) assert.ok(typeof tv[c] === 'string', k + ' needs "' + c + '" in ' + code);
        }
        const want = [...new Set(forms(v).flatMap(holes))].filter((h) => h !== 'count');
        for (const f of forms(tv)) {
          const got = holes(f).filter((h) => h !== 'count');
          for (const h of got) assert.ok(want.includes(h), k + ' (' + code + ') has unknown {' + h + '}');
          for (const h of want) assert.ok(got.includes(h), k + ' (' + code + ') drops {' + h + '}');
        }
        assert.ok(forms(tv).every((f) => String(f).trim() !== '' || String(forms(v)[0]).trim() === ''), k + ' is empty in ' + code);
      }
    });
  }

  test('English plurals have one and other', () => {
    for (const [k, v] of Object.entries(en)) if (typeof v === 'object') assert.ok(v.one && v.other, k);
  });
});

describe('keys used by the UI', () => {
  const namespaces = new Set(Object.keys(en).map((k) => k.split('.')[0]));
  const files = sourceFiles(APP);
  const used = new Map();
  for (const f of files) {
    // Comments may mention keys as examples; only code counts.
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const m of src.matchAll(/(['"])([a-zA-Z]+)\.([A-Za-z0-9_.]+)\1/g)) {
      if (!namespaces.has(m[2])) continue;
      const key = m[2] + '.' + m[3];
      if (/\.(js|jsx|css|svg|png|pdf|json|html)$/.test(key)) continue;
      if (!used.has(key)) used.set(key, path.relative(APP, f));
    }
  }

  test('finds the keys (sanity)', () => {
    assert.ok(used.size > 500, 'only found ' + used.size);
  });

  test('every key used in the source exists in the catalog', () => {
    const missing = [...used].filter(([k]) => !(k in en)).map(([k, f]) => k + ' (' + f + ')');
    assert.deepEqual(missing, []);
  });

  test('no t() call takes a non-literal key built from strings', () => {
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      assert.doesNotMatch(src, /\b(t|tIn|tx|tl)\([^()]*?['"]\s*\+/, path.relative(APP, f));
    }
  });
});

describe('runtime', () => {
  test('normalize maps browser tags to our languages', () => {
    assert.equal(i18n.normalize('ko-KR'), 'ko');
    assert.equal(i18n.normalize('es-419'), 'es');
    assert.equal(i18n.normalize('zh-TW'), 'zh-CN');
    assert.equal(i18n.normalize('fr-FR'), null);
  });

  test('detect prefers the saved choice, then the browser', () => {
    const store = (v) => ({ getItem: () => v });
    assert.equal(i18n.detect({ languages: ['ko-KR', 'en'] }, store(null)), 'ko');
    assert.equal(i18n.detect({ languages: ['fr', 'es-MX'] }, store(null)), 'es');
    assert.equal(i18n.detect({ languages: ['ko'] }, store('zh-CN')), 'zh-CN');
    assert.equal(i18n.detect({ languages: ['fr'] }, store(null)), 'en');
  });

  test('plurals and numbers follow the language', async () => {
    const key = Object.keys(en).find((k) => typeof en[k] === 'object' && en[k].one.includes('{count}'));
    assert.ok(i18n.tIn('en', key, { count: 1 }).includes('1'));
    await i18n.loadCatalog('es');
    assert.notEqual(i18n.tIn('es', key, { count: 1 }), i18n.tIn('es', key, { count: 2 }).replace('2', '1'));
    assert.equal(i18n.formatNumber(12345.5, 'es'), new Intl.NumberFormat('es-US').format(12345.5));
    assert.equal(i18n.formatNumber(1234, 'ko'), '1,234');
  });

  test('missing keys fall back to English, then the key', async () => {
    await i18n.loadCatalog('ko');
    assert.equal(i18n.tIn('ko', 'nav.browse'), ko['nav.browse']);
    assert.equal(i18n.tIn('ko', 'no.such.key'), 'no.such.key');
  });
});
