// Crash reports: when the server has error tracking on (/config errorReporting),
// uncaught errors, unhandled promise rejections and React render errors are
// sent to POST /api/client-errors (backend controllers/clientErrors.js).
// Off until enable() is called, so nothing is sent otherwise.
//
// Sent: the kind, the error message and stack, and the page path (no query
// string or hash). Each distinct error is sent once per page load, at most
// MAX_PER_PAGE in total. The server scrubs and rate-limits again.
const MAX_PER_PAGE = 5;
const KINDS = ['error', 'rejection', 'render'];

let on = false;
let sent = 0;
const seen = new Set();
let transport = null; // tests: setTransport((body) => ...)

function send(body) {
  if (transport) return transport(body);
  return fetch('/api/client-errors', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
}

const text = (v, max) => String(v === undefined || v === null ? '' : v).slice(0, max);

// err: an Error or anything thrown. Returns true when a report went out.
export function report(kind, err, extra) {
  if (!on || !KINDS.includes(kind) || sent >= MAX_PER_PAGE) return false;
  const message = text(err && err.message ? err.message : err, 1000).trim();
  if (!message) return false;
  const key = kind + '|' + message;
  if (seen.has(key)) return false;
  seen.add(key);
  sent++;
  const stack = text(err && err.stack, 6000) + (extra && extra.componentStack ? '\n' + text(extra.componentStack, 2000) : '');
  const path = typeof window !== 'undefined' && window.location ? window.location.pathname : '';
  send({ kind, message, stack: stack || undefined, path });
  return true;
}

function onError(e) {
  // Script errors from other origins carry no detail; skip them.
  if (!e || (!e.error && (!e.message || e.message === 'Script error.'))) return;
  report('error', e.error || e.message);
}
function onRejection(e) { report('rejection', e && e.reason); }

export function enable() {
  if (on || typeof window === 'undefined') return;
  on = true;
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
}

export function disable() {
  on = false;
  if (typeof window !== 'undefined') {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  }
}

// Tests.
export function setTransport(fn) { transport = fn || null; }
export function reset() { disable(); sent = 0; seen.clear(); }
export const isEnabled = () => on;
