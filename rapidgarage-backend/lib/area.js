// "An area" as sale alerts and wanted posts take it: { lat, lng } from the
// browser (current location / map) or { address } geocoded on the server with
// the user's or the server's key, rate limited per user. The address itself is
// never stored.
const geo = require('./geo');
const { badRequest, sendError } = require('./http');

// Validate the location part of a body into errors/values (lat, lng).
// required: a create must give one of the two.
function readLocation(body, errors, values, required) {
  const has = (k) => body[k] !== undefined;
  if (has('lat') || has('lng')) {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!geo.isLat(lat) || !geo.isLng(lng) || body.lat === null || body.lng === null || body.lat === '' || body.lng === '') errors.location = 'Location must be a valid latitude and longitude.';
    else { values.lat = lat; values.lng = lng; }
  } else if (has('address')) {
    if (typeof body.address !== 'string' || !body.address.trim()) errors.location = 'Enter an address or zip code.';
    else if (body.address.trim().length > 200) errors.location = 'Address is too long.';
  } else if (required) errors.location = 'Choose a location: an address, your current location or the map.';
}

// Geocode body.address into values.lat/lng (or answer the error). Returns
// false if it already answered. labelKey/labelMax: default that field to the
// address (sale alerts name themselves after it).
async function resolveAddress(req, res, body, values, labelKey, labelMax) {
  if (values.lat !== undefined || body.address === undefined) return true;
  const key = await geo.resolveGeocodeKey(req.user);
  if (!key) {
    sendError(res, 400, 'geocode_unavailable', "Address lookup isn't available on this server. Use your current location or the map instead.", { location: 'Use your current location or the map.' });
    return false;
  }
  if (!geo.allowClientGeocode('user:' + req.user.id, Date.now())) {
    sendError(res, 429, 'rate_limited', 'Too many address lookups. Please wait a minute.');
    return false;
  }
  const r = await geo.geocodeAddress(body.address, key);
  if (r.status !== 'ok') {
    const msg = r.status === 'not_found' ? "We couldn't find that address." : 'Address lookup failed. Please try again.';
    badRequest(res, msg, { location: msg });
    return false;
  }
  values.lat = r.lat;
  values.lng = r.lng;
  if (labelKey && (values[labelKey] === undefined || values[labelKey] === null)) values[labelKey] = body.address.trim().slice(0, labelMax);
  return true;
}

module.exports = { readLocation, resolveAddress };
