// Service-worker routing rules, kept free of browser globals so they can be
// unit-tested in Node (test/pwa.test.js) and inlined into sw.js at build time.
//
// The worker caches the APP SHELL ONLY: the built index.html, JS/CSS/font
// bundles, icons and manifest, listed at build time. It never stores API
// responses, uploaded photos or anything else at runtime.

// Paths the worker must never answer from (or put in) a cache.
const NEVER_CACHE = [/^\/api(\/|$)/, /^\/uploads(\/|$)/, /^\/auth(\/|$)/, /^\/sw\.js$/];

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
// build dir ("assets/index-abc.js"). Source maps and anything not needed to
// boot the app are left out.
function shellFiles(files) {
  const keep = (f) => (
    f === 'index.html'
    || f === 'manifest.webmanifest'
    || /^icons\/.+\.(png|svg)$/.test(f)
    || /^favicon\.ico$/.test(f)
    || (/^assets\/.+\.(js|css|woff2)$/.test(f))
  );
  return files.filter(keep).sort().map((f) => '/' + f);
}

// Cache names are versioned by the shell's content; old ones are deleted.
const CACHE_PREFIX = 'rg-shell-';

export { NEVER_CACHE, strategyFor, shellFiles, CACHE_PREFIX };
