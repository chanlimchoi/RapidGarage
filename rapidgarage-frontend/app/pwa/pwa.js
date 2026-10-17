// Install prompt + service-worker state shared by the PWA components.
// Call init() once, as early as possible (beforeinstallprompt fires early).
const DISMISS_KEY = 'rg-install-dismissed';
const DISMISS_DAYS = 30;

const state = { deferred: null, installed: false, updateReady: false, offline: false, registration: null };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(state));

export function subscribe(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

// iPhone/iPad Safari: no beforeinstallprompt; installing is Share → Add to Home Screen.
export function isIosSafari() {
  const ua = window.navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function canPrompt() { return !!state.deferred && !isStandalone(); }

export function dismissedRecently() {
  try {
    const t = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
    return t > 0 && Date.now() - t < DISMISS_DAYS * 86400000;
  } catch (e) { return false; }
}

export function dismiss() {
  try { window.localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) { /* private mode */ }
  emit();
}

// Resolves to 'accepted' | 'dismissed' | 'unavailable'.
export function promptInstall() {
  const ev = state.deferred;
  if (!ev) return Promise.resolve('unavailable');
  state.deferred = null; // a prompt event can only be used once
  emit();
  ev.prompt();
  return ev.userChoice.then((c) => {
    if (c && c.outcome === 'dismissed') dismiss();
    return c ? c.outcome : 'dismissed';
  }).catch(() => 'dismissed');
}

export function applyUpdate() {
  const w = state.registration && state.registration.waiting;
  if (!w) { window.location.reload(); return; }
  w.postMessage({ type: 'SKIP_WAITING' });
}

function watchUpdates(reg) {
  state.registration = reg;
  const ready = () => { if (reg.waiting && navigator.serviceWorker.controller) { state.updateReady = true; emit(); } };
  ready();
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') ready(); });
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !state.updateReady) return;
    reloading = true;
    window.location.reload();
  });
}

export function init({ register }) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own button instead of the mini-infobar
    state.deferred = e;
    emit();
  });
  window.addEventListener('appinstalled', () => { state.installed = true; state.deferred = null; emit(); });
  const net = () => { state.offline = navigator.onLine === false; emit(); };
  window.addEventListener('online', net);
  window.addEventListener('offline', net);
  net();
  if (register && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(watchUpdates).catch((err) => {
        console.warn('Service worker registration failed:', err && err.message);
      });
    });
  }
}
