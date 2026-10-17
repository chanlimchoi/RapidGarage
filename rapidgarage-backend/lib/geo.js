// Distance math, geocoding (Google Geocoding API) and geocoding rate limits.
const models = require('../models');
const secretBox = require('./secretBox');
const { userMapsKeysEnabled } = require('./features');

const EARTH_RADIUS_MI = 3958.7613;
const MILES_PER_DEG_LAT = 69.0;
const RADII_MI = [5, 10, 25, 50];

const toRad = (d) => (d * Math.PI) / 180;

// Great-circle distance in miles.
function haversineMiles(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Lat/lng box that contains every point within `miles` of center (a cheap,
// index-friendly prefilter; haversine then trims the corners).
// lng ranges may wrap the antimeridian, so lngRanges is a list of [min, max].
function boundingBox(center, miles) {
  const dLat = miles / MILES_PER_DEG_LAT;
  const minLat = Math.max(-90, center.lat - dLat);
  const maxLat = Math.min(90, center.lat + dLat);
  const cos = Math.cos(toRad(Math.max(Math.abs(minLat), Math.abs(maxLat))));
  if (cos < 1e-6 || maxLat === 90 || minLat === -90) return { minLat, maxLat, lngRanges: [[-180, 180]] };
  const dLng = miles / (MILES_PER_DEG_LAT * cos);
  if (dLng >= 180) return { minLat, maxLat, lngRanges: [[-180, 180]] };
  const lo = center.lng - dLng;
  const hi = center.lng + dLng;
  if (lo < -180) return { minLat, maxLat, lngRanges: [[lo + 360, 180], [-180, hi]] };
  if (hi > 180) return { minLat, maxLat, lngRanges: [[lo, 180], [-180, hi - 360]] };
  return { minLat, maxLat, lngRanges: [[lo, hi]] };
}

// ---- rate limiting -------------------------------------------------------
// Global token bucket for all outgoing geocode calls (Google's default QPS is
// 50; we stay well below) + a per-client window for search-triggered geocodes.
function intEnv(name, def) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

const bucket = { tokens: null, last: 0 };
function takeGlobalToken(now) {
  const rate = intEnv('GEOCODE_MAX_PER_SECOND', 10);
  if (bucket.tokens === null) { bucket.tokens = rate; bucket.last = now; }
  bucket.tokens = Math.min(rate, bucket.tokens + ((now - bucket.last) / 1000) * rate);
  bucket.last = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

const clientWindows = new Map();
// true if this client (user id or IP) may trigger another search geocode.
function allowClientGeocode(clientId, now) {
  const limit = intEnv('GEOCODE_SEARCH_PER_MINUTE', 20);
  const w = clientWindows.get(clientId);
  if (!w || now - w.start >= 60000) {
    clientWindows.set(clientId, { start: now, count: 1 });
    if (clientWindows.size > 10000) clientWindows.clear();
    return true;
  }
  if (w.count >= limit) return false;
  w.count += 1;
  return true;
}

function resetRateLimits() { bucket.tokens = null; clientWindows.clear(); cache.clear(); }

// ---- geocoding -----------------------------------------------------------
// Small in-memory cache so repeated searches for the same text are free.
const cache = new Map();
const CACHE_MAX = 1000;

// Default provider: Google Geocoding API. Tests replace it with setProvider().
async function googleGeocode(address, key) {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json?region=us&address=' +
    encodeURIComponent(address) + '&key=' + encodeURIComponent(key);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = await res.json();
    if (body.status === 'OK' && body.results && body.results[0]) {
      const loc = body.results[0].geometry.location;
      return { status: 'ok', lat: loc.lat, lng: loc.lng };
    }
    if (body.status === 'ZERO_RESULTS') return { status: 'not_found' };
    // REQUEST_DENIED (bad/restricted key), OVER_QUERY_LIMIT, ...: never log the key.
    console.error('Geocoding failed with status', body.status);
    return { status: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

let provider = googleGeocode;
function setProvider(fn) { provider = fn || googleGeocode; cache.clear(); }

// Which key may geocode for `user`? Server key first (GOOGLE_GEOCODING_API_KEY,
// else GOOGLE_MAPS_API_KEY), else the user's own key when BYOK is enabled.
// Resolves to a key string or null. The key is never returned to clients.
async function resolveGeocodeKey(user) {
  const serverKey = String(process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim();
  if (serverKey) return serverKey;
  if (!user || !user.id || !(await userMapsKeysEnabled())) return null;
  const full = await models.User.scope('withMapsKey').findByPk(user.id);
  if (!full || !full.mapsKeyEncrypted) return null;
  try { return secretBox.decrypt(full.mapsKeyEncrypted); } catch (e) { return null; }
}

// Geocode free text. Resolves to { status: ok|not_found|error|no_key|rate_limited, lat?, lng? }.
async function geocodeAddress(address, key) {
  const text = String(address || '').trim().replace(/\s+/g, ' ');
  if (!text) return { status: 'not_found' };
  if (!key) return { status: 'no_key' };
  const ck = text.toLowerCase();
  if (cache.has(ck)) return cache.get(ck);
  if (!takeGlobalToken(Date.now())) return { status: 'rate_limited' };
  let result;
  try {
    result = await provider(text, key);
  } catch (err) {
    console.error('Geocoding request failed:', err && err.name);
    return { status: 'error' };
  }
  if (result.status === 'ok' && !(isLat(result.lat) && isLng(result.lng))) result = { status: 'error' };
  if (result.status === 'ok' || result.status === 'not_found') {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(ck, result);
  }
  return result;
}

const isLat = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
const isLng = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;

function postAddress(post) {
  return [post.street, post.city, post.state, post.zipCode].filter(Boolean).join(', ');
}

// Geocode a post with its owner's allowed key and store the outcome. Never
// throws: on any failure the post keeps lat/lng null and is excluded from
// distance search.
async function geocodePost(post, owner) {
  try {
    const key = await resolveGeocodeKey(owner || { id: post.userId });
    const r = await geocodeAddress(postAddress(post), key);
    if (r.status === 'rate_limited') return post; // leave untouched; backfill can retry
    const values = r.status === 'ok'
      ? { lat: r.lat, lng: r.lng, geocodeStatus: 'ok', geocodedAt: new Date() }
      : { lat: null, lng: null, geocodeStatus: r.status, geocodedAt: new Date() };
    return await post.update(values);
  } catch (err) {
    console.error('Could not geocode post', post.id, err && err.message);
    return post;
  }
}

module.exports = {
  EARTH_RADIUS_MI, RADII_MI, haversineMiles, boundingBox, isLat, isLng,
  resolveGeocodeKey, geocodeAddress, geocodePost, postAddress,
  allowClientGeocode, setProvider, resetRateLimits,
};
