// Lighthouse-style installability check of a production build (default: build/).
//   npm run build && npm run check:pwa
// Exits 1 if any required check fails. Mirrors Chrome's install criteria
// (manifest fields, icons, service worker with a fetch handler) plus this
// app's own rule: the worker must never cache API or private data.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const INSTALL_DISPLAYS = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
const COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// PNG width/height from the IHDR chunk.
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const attr = (tag, name) => { const m = new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i').exec(tag); return m ? m[1] : null; };
const tags = (html, name) => html.match(new RegExp('<' + name + '\\b[^>]*>', 'gi')) || [];

export function checkPwa(dir) {
  const results = [];
  const check = (id, ok, detail, optional) => results.push({ id, ok: !!ok, detail, optional: !!optional });
  const file = (p) => path.join(dir, p.replace(/^\//, '').split('?')[0]);
  const exists = (p) => fs.existsSync(file(p));

  const htmlPath = path.join(dir, 'index.html');
  if (!fs.existsSync(htmlPath)) { check('index-html', false, 'No index.html in ' + dir + ' (run npm run build).'); return results; }
  const html = fs.readFileSync(htmlPath, 'utf8');

  const manifestTag = tags(html, 'link').find((t) => /rel\s*=\s*"manifest"/i.test(t));
  const href = manifestTag && attr(manifestTag, 'href');
  check('manifest-link', !!href, href ? 'index.html links ' + href : 'index.html has no <link rel="manifest">');
  let m = null;
  if (href && exists(href)) {
    try { m = JSON.parse(fs.readFileSync(file(href), 'utf8')); } catch (e) { m = null; }
  }
  check('manifest-parses', !!m, m ? 'Manifest is valid JSON' : 'Manifest missing or not valid JSON');
  if (m) {
    check('manifest-name', m.name && m.short_name, 'name "' + (m.name || '') + '", short_name "' + (m.short_name || '') + '"');
    check('short-name-length', !m.short_name || m.short_name.length <= 12, 'short_name fits under the icon (≤ 12 chars)', true);
    check('manifest-id', !!m.id, 'id: ' + (m.id || 'missing'), true);
    const scope = m.scope || '/';
    check('start-url', m.start_url && new URL(m.start_url, 'https://x/').pathname.startsWith(new URL(scope, 'https://x/').pathname), 'start_url ' + m.start_url + ' is inside scope ' + scope);
    const display = [m.display].concat(m.display_override || []);
    check('display', display.some((d) => INSTALL_DISPLAYS.indexOf(d) >= 0), 'display: ' + display.filter(Boolean).join(', '));
    check('theme-color', COLOR_RE.test(m.theme_color || ''), 'theme_color ' + (m.theme_color || 'missing'));
    check('background-color', COLOR_RE.test(m.background_color || ''), 'background_color ' + (m.background_color || 'missing'));
    const icons = Array.isArray(m.icons) ? m.icons : [];
    const real = icons.filter((i) => i.type === 'image/png' && exists(i.src)).map((i) => {
      const size = pngSize(file(i.src));
      const [w, h] = String(i.sizes || '').split('x').map(Number);
      return Object.assign({}, i, { size, declaredOk: !!size && size.w === w && size.h === h });
    });
    const has = (n, purpose) => real.some((i) => i.declaredOk && i.size.w >= n && (i.purpose || 'any').split(' ').indexOf(purpose) >= 0);
    check('icon-192', has(192, 'any'), 'A 192×192+ PNG icon (purpose any)');
    check('icon-512', has(512, 'any'), 'A 512×512+ PNG icon (purpose any), used for the splash screen');
    check('icon-maskable', has(192, 'maskable'), 'A maskable icon (adaptive Android icons)', true);
    const wrong = real.filter((i) => !i.declaredOk);
    check('icon-sizes-match', !wrong.length, wrong.length ? 'Declared sizes differ from the files: ' + wrong.map((i) => i.src).join(', ') : 'Icon files match their declared sizes');
    const missing = icons.filter((i) => !exists(i.src)).map((i) => i.src);
    check('icon-files', !missing.length, missing.length ? 'Missing icon files: ' + missing.join(', ') : 'All ' + icons.length + ' icon files exist');
  }

  const metas = tags(html, 'meta');
  const viewport = metas.find((t) => /name\s*=\s*"viewport"/i.test(t));
  check('viewport', viewport && /width=device-width/.test(attr(viewport, 'content') || ''), 'Has a mobile viewport meta tag');
  check('meta-theme-color', metas.some((t) => /name\s*=\s*"theme-color"/i.test(t)), 'Has <meta name="theme-color"> (address bar color)');
  const apple = tags(html, 'link').find((t) => /rel\s*=\s*"apple-touch-icon"/i.test(t));
  const appleSize = apple && exists(attr(apple, 'href')) ? pngSize(file(attr(apple, 'href'))) : null;
  check('apple-touch-icon', appleSize && appleSize.w >= 180, 'apple-touch-icon (iOS home screen) ' + (appleSize ? appleSize.w + 'px' : 'missing'), true);

  // Service worker.
  const swPath = path.join(dir, 'sw.js');
  const sw = fs.existsSync(swPath) ? fs.readFileSync(swPath, 'utf8') : '';
  check('sw-exists', !!sw, sw ? 'sw.js is in the build' : 'No sw.js in the build');
  check('sw-fetch-handler', /addEventListener\(\s*['"]fetch['"]/.test(sw), 'sw.js has a fetch handler');
  const pre = /const PRECACHE = (\[[\s\S]*?\]);/.exec(sw);
  let list = [];
  try { list = pre ? JSON.parse(pre[1]) : []; } catch (e) { list = []; }
  check('sw-precache-shell', list.indexOf('/index.html') >= 0 && list.some((p) => /\.js$/.test(p)), 'Precaches the app shell (' + list.length + ' files)');
  const gone = list.filter((p) => !exists(p));
  check('sw-precache-files', !gone.length, gone.length ? 'Precached files missing from the build: ' + gone.join(', ') : 'Every precached file exists');
  const bad = list.filter((p) => /^\/(api|uploads|auth)(\/|$)/.test(p) || /\.map$/.test(p));
  check('sw-no-private-precache', !bad.length, bad.length ? 'Precache includes data/private paths: ' + bad.join(', ') : 'Precache holds no API, upload or auth paths');
  check('sw-never-cache-api', /NEVER_CACHE\s*=\s*\[[^\]]*\\\/api/.test(sw), 'sw.js bypasses /api/* (never cached)');
  check('sw-no-runtime-put', !/cache\.put\(|\.put\(\s*(event\.)?req/.test(sw), 'sw.js never stores responses at runtime');

  // Registration in the bundle.
  const assets = path.join(dir, 'assets');
  const js = fs.existsSync(assets) ? fs.readdirSync(assets).filter((f) => /\.js$/.test(f)).map((f) => fs.readFileSync(path.join(assets, f), 'utf8')).join('\n') : '';
  check('sw-registered', /serviceWorker\.register\(\s*['"`]\/sw\.js['"`]/.test(js), 'The app registers /sw.js');
  return results;
}

export function report(results, log) {
  const out = log || console.log;
  results.forEach((r) => out((r.ok ? '  ✓ ' : r.optional ? '  ! ' : '  ✗ ') + r.id.padEnd(24) + r.detail));
  const failed = results.filter((r) => !r.ok && !r.optional);
  const warned = results.filter((r) => !r.ok && r.optional);
  out('\n' + (failed.length ? 'NOT installable: ' + failed.length + ' required check(s) failed' : 'Installable: all ' + results.filter((r) => !r.optional).length + ' required checks passed') +
    (warned.length ? ' (' + warned.length + ' recommendation(s) not met)' : ''));
  return failed.length === 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dir = path.resolve(process.argv[2] || 'build');
  console.log('PWA installability check: ' + dir + '\n');
  process.exit(report(checkPwa(dir)) ? 0 : 1);
}
