// Free stuff at the curb: quick posts and nearby alerts (backend lib/curbAlerts.js).
// Pure helpers (test/curb-post.test.js).
export const HOUR_CHOICES = [1, 2, 4, 8, 12];
export const DEFAULT_HOURS = 4;
export const RADIUS_CHOICES = [0.5, 1, 2, 3, 5, 10];
export const TITLE_MAX = 80;
export const NOTE_MAX = 200;

// Form -> { errors: { field: i18n key }, body }.
//   v: { title, note, hours, coords: { lat, lng } | null, street, zipCode }
export function curbPostBody(v) {
  const errors = {};
  const title = String(v.title || '').trim();
  const note = String(v.note || '').trim();
  if (title.length > TITLE_MAX) errors.title = 'quick.errTitle';
  if (note.length > NOTE_MAX) errors.note = 'quick.errNote';
  const hours = Number(v.hours || DEFAULT_HOURS);
  if (HOUR_CHOICES.indexOf(hours) === -1) errors.hours = 'quick.errHours';
  const body = { title: title || undefined, note: note || undefined, hours };
  if (v.coords) Object.assign(body, { lat: v.coords.lat, lng: v.coords.lng });
  const street = String(v.street || '').trim();
  const zip = String(v.zipCode || '').trim();
  if (street) body.street = street;
  if (zip) {
    if (!/^\d{5}$/.test(zip)) errors.zipCode = 'quick.errZip';
    body.zipCode = zip;
  }
  if (!v.coords && !(street && zip)) errors.location = 'quick.errLocation';
  return { errors, body };
}

// Minutes left until `until` (ISO), at least 0.
export function minutesLeft(until, now) {
  const ms = new Date(until).getTime() - (now || new Date()).getTime();
  return isNaN(ms) ? 0 : Math.max(0, Math.round(ms / 60000));
}

// "0.5 mi" / "2 mi" label for a radius.
export const radiusLabel = (r) => String(r) + ' mi';
