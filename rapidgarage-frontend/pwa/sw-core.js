// Service-worker routing rules, kept free of browser globals so they can be
// unit-tested in Node (test/pwa.test.js) and inlined into sw.js at build time.
//
// The worker caches the APP SHELL ONLY: the built index.html, JS/CSS/font
// bundles, icons and manifest, listed at build time. It never stores API
// responses, uploaded photos or anything else at runtime.

// Paths the worker must never answer from (or put in) a cache.
// /s/<code> is the QR short link: the server counts the scan and redirects,
// so it must always reach the network (never the offline shell).
const NEVER_CACHE = [/^\/api(\/|$)/, /^\/uploads(\/|$)/, /^\/auth(\/|$)/, /^\/sw\.js$/, /^\/s\/[^/]+\/?$/];

// req: { method, url, mode, headers? }  ctx: { origin, precache: Set<path> }
// -> 'bypass'      let the browser handle it (no cache involved)
//    'navigate'    network first; offline: the cached shell (index.html)
//    'shell'       a precached shell file: cache first, network fallback
function strategyFor(req, ctx) {
  if (req.method !== 'GET') return 'bypass';
  let u;
  try { u = new URL(req.url); } catch (e) { return 'bypass'; }
  if (u.origin !== ctx.origin) return 'bypass';
  if (NEVER_CACHE.some((re) => re.test(u.pathname))) return 'bypass';
  if (req.mode === 'navigate') return 'navigate';
  if (ctx.precache.has(u.pathname)) return 'shell';
  return 'bypass';
}

// Which built files make up the shell. `files` are paths relative to the
// build dir ("assets/index-abc.js"). Source maps are always left out.
//
// The shell is the BOOT GRAPH, not every asset: the entry, its statically
// imported chunks, the CSS and the fonts the CSS pulls in. Vite writes that
// graph into index.html as <script>, <link rel="modulepreload"> and
// <link rel="stylesheet"> tags, so `html` names each boot file exactly.
//
// Everything else -- the lazy route chunks (Admin, Messages, Settings, ...)
// and the non-English catalogs (es, ko, zh-CN) -- is fetched on demand by the
// browser, which handles those requests normally, and is deliberately NOT
// precached. Precaching them would download pages and languages the user may
// never open (1531 kB -> 870 kB here, 81 files -> 27).
//
// `html` and `css` are the built index.html and its stylesheet. When they are
// missing (older callers, tests) the function falls back to the previous
// all-assets rule.
function shellFiles(files, html, css) {
  const base = (f) => (
    f === 'index.html'
    || f === 'manifest.webmanifest'
    || /^icons\/.+\.(png|svg)$/.test(f)
    || /^favicon\.ico$/.test(f)
  );
  if (typeof html !== 'string') {
    // Fallback: no HTML to read the boot graph from, so keep every CSS/JS/font.
    return files.filter((f) => base(f) || /^assets\/.+\.(js|css|woff2)$/.test(f)).sort().map((f) => '/' + f);
  }
  // Files index.html references (entry, preloaded chunks, stylesheet, icons).
  const boot = new Set();
  for (const m of String(html).matchAll(/(?:src|href)="(\/?[^"]+)"/g)) {
    boot.add(m[1].replace(/^\//, '').split('?')[0]);
  }
  // Fonts the stylesheet's @font-face rules pull in. They are part of the boot
  // graph (the CSS loads them on first paint), so they stay precached even
  // though the browser fetches them lazily.
  for (const m of String(css || '').matchAll(/url\(\s*['"]?(\/\/[^'")]+|\/[^'")]+)['"]?\s*\)/g)) {
    boot.add(m[1].replace(/^\//, '').split('?')[0]);
  }
  return files.filter((f) => base(f) || boot.has(f)).sort().map((f) => '/' + f);
}

// Cache names are versioned by the shell's content; old ones are deleted.
const CACHE_PREFIX = 'rg-shell-';

export { NEVER_CACHE, strategyFor, shellFiles, CACHE_PREFIX };
