// Link-preview tags for the Vite servers (vite preview / vite dev).
//
// In production the backend serves the built app (SERVE_FRONTEND_DIR, Docker)
// and writes Open Graph / Twitter tags into every page itself
// (rapidgarage-backend/lib/frontend.js). When the app is served by
// `vite preview` instead (or `vite` in development), this plugin does the
// same: for each page navigation it asks the backend for the tags
// (GET <BACKEND_URL>/share/head?path=…) and puts them into index.html.
// If the backend is slow or down the page is served with the build's static
// fallback tags, so the app always loads.
import fs from 'node:fs';
import path from 'node:path';

const TIMEOUT_MS = 1500;
const HEAD_RE = /<!--\s*rg:head\s*-->[\s\S]*?<!--\s*\/rg:head\s*-->/;

// A page navigation (not an asset, API call, QR short link or Vite internal).
export function isPage(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const p = (req.url || '/').split('?')[0];
  if (/^\/(api|s|@|node_modules|__)(\/|$)/.test(p) || /^\/@/.test(p)) return false;
  if (path.posix.extname(p)) return false;
  const accept = String(req.headers.accept || '*/*');
  return /text\/html|\*\/\*/.test(accept);
}

export function inject(html, out) {
  if (!out || !out.head) return html;
  let s = HEAD_RE.test(html)
    ? html.replace(HEAD_RE, () => '<!-- rg:head -->\n    ' + out.head + '\n    <!-- /rg:head -->')
    : html.replace(/<\/head>/i, () => '    ' + out.head + '\n  </head>');
  if (out.lang) s = s.replace(/<html([^>]*?)\slang="[^"]*"/i, (all, pre) => '<html' + pre + ' lang="' + String(out.lang).replace(/[^\w-]/g, '') + '"');
  return s;
}

async function fetchHead(backend, req) {
  const u = new URL(req.url || '/', 'http://x');
  const q = new URLSearchParams({ path: u.pathname });
  ['lang', 'fb_locale'].forEach((k) => { if (u.searchParams.get(k)) q.set(k, u.searchParams.get(k)); });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(backend.replace(/\/+$/, '') + '/share/head?' + q, { headers: { 'Accept-Language': req.headers['accept-language'] || '' }, signal: ctl.signal });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; } finally { clearTimeout(timer); }
}

export default function shareMeta(options) {
  const backend = (options && options.backend) || 'http://localhost:8000';
  const send = (res, html) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Vary', 'Accept-Language');
    res.end(html);
  };
  return {
    name: 'rapidgarage-share-meta',
    configurePreviewServer(server) {
      const file = path.resolve(server.config.root, server.config.build.outDir, 'index.html');
      server.middlewares.use(async (req, res, next) => {
        if (!isPage(req) || !fs.existsSync(file)) return next();
        try { send(res, inject(fs.readFileSync(file, 'utf8'), await fetchHead(backend, req))); } catch (e) { next(); }
      });
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!isPage(req)) return next();
        try {
          const raw = fs.readFileSync(path.resolve(server.config.root, 'index.html'), 'utf8');
          send(res, inject(await server.transformIndexHtml(req.url, raw), await fetchHead(backend, req)));
        } catch (e) { next(); }
      });
    },
  };
}
