// Security headers (helmet) and the Content-Security-Policy.
//
// The app page gets a strict, nonce-based CSP, the variant Google recommends
// for the Maps JavaScript API: only scripts carrying this response's nonce run,
// and 'strict-dynamic' lets them load the Maps API and its helpers, so no
// Google host has to be listed in script-src. 'unsafe-eval' and blob: are in
// Google's sample policy because the Maps API needs them in some browsers.
// Styles allow 'unsafe-inline' because Maps (and React style props on SVG)
// insert inline styles; style injection cannot run code.
// Every other response (JSON, uploads, small server-rendered pages such as
// "sale not available") gets a policy that allows no scripts at all.
const helmet = require('helmet');
const runtime = require('./runtime');

const GOOGLE_IMG = ['https://*.googleapis.com', 'https://*.gstatic.com', '*.google.com', '*.googleusercontent.com'];
const GOOGLE_CONNECT = ['https://*.googleapis.com', '*.google.com', 'https://*.gstatic.com'];

const join = (d) => Object.entries(d).map(([k, v]) => (v.length ? k + ' ' + [...new Set(v)].join(' ') : k)).join('; ');

function pagePolicy(nonce, env) {
  const d = {
    'default-src': ["'self'"],
    'script-src': ["'nonce-" + nonce + "'", "'strict-dynamic'", 'https:', "'unsafe-eval'", 'blob:'],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'img-src': ["'self'", 'data:', 'blob:', ...GOOGLE_IMG],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    'connect-src': ["'self'", ...GOOGLE_CONNECT, 'data:', 'blob:'],
    'frame-src': ['*.google.com'],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  if (runtime.hsts(env)) d['upgrade-insecure-requests'] = [];
  return join(d);
}

const BASE_POLICY = join({
  'default-src': ["'none'"],
  'style-src': ["'unsafe-inline'"],
  'img-src': ["'self'", 'data:'],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
});

// The service worker runs under the CSP of its own response (not the page's).
// It fetches same-origin files (precache, network-first navigations) and
// passes cross-origin requests (Maps tiles) through.
const WORKER_POLICY = join({
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'connect-src': ["'self'", ...GOOGLE_CONNECT, ...GOOGLE_IMG],
  'img-src': ["'self'", 'data:', 'blob:', ...GOOGLE_IMG],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
});

const cspHeaderName = (env) => (runtime.isOn((env || process.env).CSP_REPORT_ONLY) ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy');

// The app uses the browser's location for "near me"; nothing needs camera,
// microphone or payments (photo picking uses a plain file input).
const PERMISSIONS_POLICY = 'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()';

function securityHeaders(env) {
  const e = env || process.env;
  const hsts = runtime.hsts(e);
  return [
    helmet({
      contentSecurityPolicy: false, // set below / per page
      crossOriginEmbedderPolicy: false, // would block Maps tiles and fonts
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      // Maps browser keys are usually restricted by HTTP referrer, so Google
      // must see our origin; "no-referrer" (helmet's default) breaks the map.
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      strictTransportSecurity: hsts ? { maxAge: 180 * 24 * 3600, includeSubDomains: false } : false,
    }),
    function baseHeaders(req, res, next) {
      res.setHeader(cspHeaderName(e), BASE_POLICY);
      res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
      next();
    },
  ];
}

function setWorkerPolicy(res, env) {
  res.setHeader(cspHeaderName(env), WORKER_POLICY);
}

function setPagePolicy(res, nonce, env) {
  res.setHeader(cspHeaderName(env), pagePolicy(nonce, env));
}

module.exports = { securityHeaders, setPagePolicy, setWorkerPolicy, pagePolicy, BASE_POLICY, WORKER_POLICY, cspHeaderName, PERMISSIONS_POLICY };
