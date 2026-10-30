// Recently viewed sales the service worker keeps for offline use (pwa/sw-core.js).
// Signing out forgets them: they can carry per-viewer marks (e.g. "I took this").
import { RECENT_CACHE, RECENT_PHOTO_CACHE } from '../../pwa/sw-core.js';

export function clearRecentSales() {
  try {
    if (typeof caches !== 'undefined') { caches.delete(RECENT_CACHE).catch(() => {}); caches.delete(RECENT_PHOTO_CACHE).catch(() => {}); }
  } catch (e) { /* no Cache API */ }
  try {
    const sw = typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller;
    if (sw) sw.postMessage({ type: 'CLEAR_RECENT' });
  } catch (e) { /* no worker */ }
}
