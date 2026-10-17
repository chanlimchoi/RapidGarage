// Serve the built frontend (rapidgarage-frontend/build) from this process, so
// one container/port runs the whole app. Only used when SERVE_FRONTEND_DIR is
// set; in development Vite serves the frontend and proxies /api here.
//
//   /                      index.html with a fresh CSP nonce (no-cache)
//   /sw.js                 service worker, never cached by HTTP caches
//   /manifest.webmanifest  application/manifest+json, revalidated
//   /assets/*              content-hashed files, cached for a year
//   other GET (no ext.)    SPA fallback -> index.html (client-side routes)
//   missing files          plain 404 (never index.html, so a stale chunk
//                          request cannot be answered with HTML)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const security = require('./security');

// vite.config.js sets html.cspNonce to this placeholder, so the build marks
// every <script>/<link> (plus a <meta property="csp-nonce"> that Vite's
// preload helper reads) with it; each response replaces it with a new nonce.
const NONCE_PLACEHOLDER = '__RG_CSP_NONCE__';

const ONE_YEAR = 'public, max-age=31536000, immutable';

function loadIndex(dir) {
  const file = path.join(dir, 'index.html');
  if (!fs.existsSync(file)) throw new Error('SERVE_FRONTEND_DIR has no index.html (build the frontend first): ' + dir);
  const parts = fs.readFileSync(file, 'utf8').split(NONCE_PLACEHOLDER);
  if (parts.length < 2) throw new Error('index.html in ' + dir + ' has no CSP nonce placeholder; rebuild the frontend with the current vite.config.js');
  return parts;
}

function staticHeaders(dir, env) {
  return (res, file) => {
    const rel = path.relative(dir, file).split(path.sep).join('/');
    if (rel === 'sw.js') {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Service-Worker-Allowed', '/');
      // The global "no scripts, no fetches" policy would stop the worker from
      // precaching, and the browser would silently drop the registration.
      security.setWorkerPolicy(res, env);
    } else if (rel === 'manifest.webmanifest') {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
    } else if (rel.startsWith('assets/')) {
      res.setHeader('Cache-Control', ONE_YEAR);
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  };
}

function mountFrontend(app, dir, env) {
  const parts = loadIndex(dir);

  function sendIndex(req, res) {
    const nonce = crypto.randomBytes(16).toString('base64');
    security.setPagePolicy(res, nonce, env);
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html');
    res.send(parts.join(nonce));
  }

  app.get(['/', '/index.html'], sendIndex);
  app.use(express.static(dir, { index: false, redirect: false, fallthrough: true, setHeaders: staticHeaders(dir, env) }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    if (path.posix.extname(req.path)) return next(); // a file that does not exist
    if (!req.accepts('html')) return next();
    sendIndex(req, res);
  });
  return { sendIndex };
}

module.exports = { mountFrontend, NONCE_PLACEHOLDER, loadIndex };
