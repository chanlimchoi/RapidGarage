// Loads the Google Maps JavaScript API once. The optional build-time fallback
// key comes from VITE_GOOGLE_MAPS_API_KEY (see .env.example). Never hard-code a key here.
import { apiFetch } from '../api';

// Build-time key: last-resort fallback for static deployments.
export const BUILD_MAPS_API_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();

// Ask the server which key to use: the logged-in user's own key, else the
// server-wide key. Resolves to { key, source } or rejects with 'no_key'.
export function resolveMapsKey() {
  return apiFetch('/maps/key')
    .then(({ ok, data }) => {
      if (ok && data && data.key) return { key: data.key, source: data.source };
      if (BUILD_MAPS_API_KEY) return { key: BUILD_MAPS_API_KEY, source: 'build' };
      throw new Error('no_key');
    }, () => {
      if (BUILD_MAPS_API_KEY) return { key: BUILD_MAPS_API_KEY, source: 'build' };
      throw new Error('no_key');
    });
}

// The Maps script can only be loaded once per page, with one key.
let loadedKey = null;
export function loadedMapsKey() {
  return loadedKey;
}

let loadPromise = null;
let authFailed = false;
const authListeners = [];

export function onAuthFailure(fn) {
  if (authFailed) fn();
  else authListeners.push(fn);
}

export function loadGoogleMaps(key) {
  if (!key) return Promise.reject(new Error('no_key'));
  if (loadedKey && loadedKey !== key) return Promise.reject(new Error('key_changed'));
  if (window.google && window.google.maps && window.google.maps.Map) return Promise.resolve(window.google.maps);
  if (loadPromise) return loadPromise;

  // Google calls this global when the key is invalid or not allowed for this site.
  window.gm_authFailure = () => {
    authFailed = true;
    authListeners.splice(0).forEach((fn) => fn());
  };

  loadedKey = key;
  loadPromise = new Promise((resolve, reject) => {
    const cb = '__rapidGarageMapsReady';
    window[cb] = () => {
      delete window[cb];
      resolve(window.google.maps);
    };
    const script = document.createElement('script');
    script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) +
      '&v=weekly&loading=async&callback=' + cb;
    script.async = true;
    script.onerror = () => {
      loadPromise = null;
      loadedKey = null;
      reject(new Error('load_failed'));
    };
    document.head.appendChild(script);
  });
  return loadPromise;
}

// Geocode a post's address, caching results for the browser session so we
// don't re-bill the Geocoding API on every page view.
const CACHE_KEY = 'rg-geocode-v1';
function readCache() {
  try { return JSON.parse(sessionStorage.getItem(CACHE_KEY)) || {}; } catch (e) { return {}; }
}
function writeCache(cache) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* storage full or disabled */ }
}

export function addressOf(post) {
  return [post.street, post.city, post.state, post.zipCode].filter(Boolean).join(', ');
}

export function geocode(maps, geocoder, address) {
  const cache = readCache();
  if (Object.prototype.hasOwnProperty.call(cache, address)) return Promise.resolve(cache[address]);
  return new Promise((resolve) => {
    geocoder.geocode({ address, region: 'us' }, (results, status) => {
      let loc = null;
      if (status === 'OK' && results && results[0]) {
        const l = results[0].geometry.location;
        loc = { lat: l.lat(), lng: l.lng() };
      }
      // Cache misses too (ZERO_RESULTS), but not transient errors.
      if (status === 'OK' || status === 'ZERO_RESULTS') {
        const c = readCache();
        c[address] = loc;
        writeCache(c);
      }
      resolve(loc);
    });
  });
}
