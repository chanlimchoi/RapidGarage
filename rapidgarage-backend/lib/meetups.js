'use strict';
// Suggested public meetup spots.
//
// * Spots: an admin-curated list (MeetupSpot) of public places such as police
//   station exchange zones, libraries and stores. Inside a conversation either
//   person sees the active spots nearest the *sale's area* (the sale's public
//   location, or a wanted post's area center) and can suggest one, or type in
//   another public place, with a time. No one's location is used: not the
//   viewer's, and never a home address the sale doesn't already show.
// * Proposals (MeetupProposal): the other person accepts, declines or counters
//   (a new proposal; the old one becomes 'countered'). The proposer can
//   withdraw a pending suggestion; either person can call off an accepted one.
//   Pending suggestions lapse at their meeting time. One pending suggestion per
//   conversation at a time. Every step posts a Message (kind 'meetup') with an
//   English summary in body (moderators see it only when the conversation is
//   reported; see controllers/adminConversations.js), so it shows in the thread
//   and the unread badge, like item holds.
// * Optional nearby-place search through Google Places when a server-side
//   GOOGLE_PLACES_API_KEY is set. The curated list works without any key.
const { Op } = require('sequelize');
const schedule = require('./schedule');
const geo = require('./geo');

function models() { return require('../models'); }

const NAME_MAX = 120;
const ADDRESS_MAX = 200;
const NOTE_MAX = 200;
const SPOT_NOTES_MAX = 300;
const MAX_DAYS = 14;
const NEAR_MILES = 30;
const NEAR_LIMIT = 8;
const PER_DAY = 10; // suggestions per person per conversation per 24 h
const HOUR = 3600000;

const now = () => schedule.now();
const ms = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// ---- spots -------------------------------------------------------------------
function spotJSON(s, admin) {
  const out = { id: s.id, name: s.name, kind: s.kind, address: s.address, city: s.city, state: s.state, notes: s.notes };
  if (admin) Object.assign(out, { lat: s.lat, lng: s.lng, active: !!s.active, createdAt: s.createdAt, updatedAt: s.updatedAt });
  return out;
}

// Admin create/update. Returns { errors, values } (values only has given fields when partial).
function validateSpot(b, partial) {
  const errors = {};
  const values = {};
  const KINDS = models().MeetupSpot.KINDS;
  const text = (field, max, required, label) => {
    if (b[field] === undefined) { if (required && !partial) errors[field] = label + ' is required.'; return; }
    if (b[field] === null || b[field] === '') { if (required) errors[field] = label + ' is required.'; else values[field] = null; return; }
    if (typeof b[field] !== 'string') { errors[field] = label + ' must be text.'; return; }
    const v = clean(b[field]);
    if (!v && required) errors[field] = label + ' is required.';
    else if (v.length > max) errors[field] = 'Keep it under ' + max + ' characters.';
    else values[field] = v || null;
  };
  text('name', NAME_MAX, true, 'Name');
  text('address', ADDRESS_MAX, false, 'Address');
  text('city', 80, false, 'City');
  text('state', 40, false, 'State');
  text('notes', SPOT_NOTES_MAX, false, 'Notes');
  if (b.kind !== undefined || !partial) {
    if (KINDS.indexOf(b.kind) === -1) errors.kind = 'Choose a type: ' + KINDS.join(', ') + '.';
    else values.kind = b.kind;
  }
  for (const [f, ok] of [['lat', geo.isLat], ['lng', geo.isLng]]) {
    if (b[f] === undefined || b[f] === null || b[f] === '') continue;
    const n = Number(b[f]);
    if (!Number.isFinite(n) || !ok(n)) errors[f] = f === 'lat' ? 'Latitude must be between -90 and 90.' : 'Longitude must be between -180 and 180.';
    else values[f] = n;
  }
  if ((values.lat === undefined) !== (values.lng === undefined) && !errors.lat && !errors.lng) errors.lat = 'Give both latitude and longitude.';
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') errors.active = 'active must be true or false.';
    else values.active = b.active;
  }
  return { errors, values };
}

// Where to look for spots in a conversation: the sale's public location (the
// sale page shows its address), or a wanted post's area center. A sale the
// viewer can no longer see falls back to its city/state only.
// -> { lat?, lng?, city?, state?, label, step } or null. step: distance rounding (mi).
async function originFor(conv, user) {
  const m = models();
  const mod = require('./moderation');
  if (conv.wantedId) {
    const w = await m.WantedPost.findByPk(conv.wantedId);
    if (!w) return null;
    // A wanted post shows only "Near <area> within N mi": round to whole miles.
    return { lat: w.lat, lng: w.lng, label: w.areaLabel, step: 1 };
  }
  const post = conv.postId ? await m.Post.findByPk(conv.postId) : null;
  if (!post) return null;
  const label = [post.city, post.state].filter(Boolean).join(', ') || null;
  if (mod.canSee(user, post) && !post.hidden && post.lat !== null && post.lng !== null && post.lat !== undefined) {
    return { lat: post.lat, lng: post.lng, city: post.city, state: post.state, label, step: 0.1, timeZone: post.timeZone };
  }
  return { city: post.city, state: post.state, label, step: 0.1, timeZone: post.timeZone };
}

const roundTo = (n, step) => (step >= 1 ? Math.max(1, Math.round(n)) : Math.round(n * 10) / 10);

// Active spots nearest the origin (within NEAR_MILES), else those in the same
// city/state, else none.
async function nearestSpots(origin, limit) {
  const m = models();
  const n = limit || NEAR_LIMIT;
  if (!origin) return [];
  if (origin.lat !== undefined && origin.lat !== null) {
    const box = geo.boundingBox({ lat: origin.lat, lng: origin.lng }, NEAR_MILES);
    const rows = await m.MeetupSpot.findAll({
      where: { active: true, lat: { [Op.between]: [box.minLat, box.maxLat] }, [Op.or]: box.lngRanges.map(([a, b]) => ({ lng: { [Op.between]: [a, b] } })) },
      limit: 2000,
    });
    return rows
      .map((s) => ({ s, d: geo.haversineMiles(origin, s) }))
      .filter((x) => x.d <= NEAR_MILES)
      .sort((a, b) => a.d - b.d || a.s.name.localeCompare(b.s.name))
      .slice(0, n)
      .map((x) => Object.assign(spotJSON(x.s), { distanceMiles: roundTo(x.d, origin.step), distanceApprox: origin.step >= 1 }));
  }
  if (!origin.city && !origin.state) return [];
  const where = { active: true };
  const lower = (f, v) => m.sequelize.where(m.sequelize.fn('lower', m.sequelize.col(f)), String(v).toLowerCase());
  const conds = [];
  if (origin.city) conds.push(lower('city', origin.city));
  if (origin.state) conds.push(lower('state', origin.state));
  where[Op.and] = conds;
  const rows = await m.MeetupSpot.findAll({ where, order: [['name', 'ASC']], limit: n });
  return rows.map((s) => Object.assign(spotJSON(s), { distanceMiles: null }));
}

// ---- proposals ---------------------------------------------------------------
const zoneOf = (tz) => (tz && schedule.isValidTimeZone(tz) ? tz : schedule.defaultTimeZone());

function whenText(p) {
  return new Intl.DateTimeFormat('en-US', { timeZone: zoneOf(p.timeZone), weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(p.meetAt));
}
const place = (p) => '“' + String(p.placeName || 'a public place').slice(0, NAME_MAX) + '”';
const SUMMARY = {
  proposed: (p) => 'Suggested meeting at ' + place(p) + ' on ' + whenText(p) + '.',
  countered: (p) => 'Suggested another time or place: ' + place(p) + ' on ' + whenText(p) + '.',
  accepted: (p) => 'Agreed to meet at ' + place(p) + ' on ' + whenText(p) + '.',
  declined: (p) => 'Declined meeting at ' + place(p) + '.',
  cancelled: (p) => 'Called off meeting at ' + place(p) + '.',
  expired: (p) => 'The suggestion to meet at ' + place(p) + ' expired without an answer.',
};

async function postEvent(p, event, by) {
  const m = models();
  const msg = await m.Message.create({ conversationId: p.conversationId, senderId: by, kind: 'meetup', meetupId: p.id, meetupEvent: event, body: SUMMARY[event](p) });
  const conv = await m.Conversation.findByPk(p.conversationId);
  if (conv) {
    const fields = { lastMessageAt: msg.createdAt };
    if (by === conv.buyerId || by === conv.sellerId) fields[conv.lastReadField(by)] = msg.createdAt;
    await conv.update(fields, { silent: true });
  }
  return msg;
}

// Pending suggestions whose time has passed lapse. The event is attributed to
// the person who didn't answer, so the proposer is the one notified.
async function sweep(at) {
  const m = models();
  const t = at || now();
  const due = await m.MeetupProposal.findAll({ where: { status: 'pending', meetAt: { [Op.lte]: t } }, limit: 200 });
  let n = 0;
  for (const p of due) {
    const [changed] = await m.MeetupProposal.update({ status: 'expired' }, { where: { id: p.id, status: 'pending' } });
    if (!changed) continue;
    await postEvent(p, 'expired', p.recipientId);
    n++;
  }
  return n;
}

// A block ends pending and upcoming accepted meetups between the two (no messages).
async function endBetween(a, b) {
  const m = models();
  const [n] = await m.MeetupProposal.update({ status: 'cancelled', endedReason: 'blocked', respondedAt: now() }, {
    where: { status: { [Op.in]: ['pending', 'accepted'] }, [Op.or]: [{ proposerId: a, recipientId: b }, { proposerId: b, recipientId: a }] },
  });
  return n;
}

// A link that opens the place in a maps app. Curated spots and searched places
// have coordinates; typed-in places search by their text.
function mapsUrl(p) {
  const q = p.placeLat !== null && p.placeLat !== undefined
    ? p.placeLat + ',' + p.placeLng
    : [p.placeName, p.placeAddress, p.placeCity, p.placeState].filter(Boolean).join(', ');
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

function proposalJSON(p, me) {
  return {
    id: p.id,
    status: p.status,
    mine: p.proposerId === me,
    place: { spotId: p.spotId, name: p.placeName, kind: p.placeKind, address: p.placeAddress, city: p.placeCity, state: p.placeState, mapsUrl: mapsUrl(p) },
    meetAt: p.meetAt,
    timeZone: zoneOf(p.timeZone),
    note: p.note,
    counterOfId: p.counterOfId,
    respondedAt: p.respondedAt,
    endedReason: p.endedReason,
    createdAt: p.createdAt,
  };
}

// Validate a suggestion: { spotId } or { place: { name, address? } }, plus
// meetAt (ISO, in the future, within MAX_DAYS) and an optional note.
// Resolves to { errors, values }.
async function parseProposal(b, t) {
  const errors = {};
  const values = {};
  b = b || {};
  if (b.spotId !== undefined && b.spotId !== null && b.spotId !== '') {
    const id = Number(b.spotId);
    const spot = Number.isInteger(id) && id > 0 ? await models().MeetupSpot.findOne({ where: { id, active: true } }) : null;
    if (!spot) errors.spotId = 'That meetup spot is no longer available. Choose another.';
    else Object.assign(values, { spotId: spot.id, placeName: spot.name, placeKind: spot.kind, placeAddress: spot.address, placeCity: spot.city, placeState: spot.state, placeLat: spot.lat, placeLng: spot.lng });
  } else if (b.place && typeof b.place === 'object') {
    const name = typeof b.place.name === 'string' ? clean(b.place.name) : '';
    const address = typeof b.place.address === 'string' ? clean(b.place.address) : '';
    if (name.length < 2) errors.place = 'Name the public place.';
    else if (name.length > NAME_MAX) errors.place = 'Keep the place name under ' + NAME_MAX + ' characters.';
    else if (address.length > ADDRESS_MAX) errors.place = 'Keep the address under ' + ADDRESS_MAX + ' characters.';
    else Object.assign(values, { spotId: null, placeName: name, placeKind: 'custom', placeAddress: address || null, placeCity: null, placeState: null, placeLat: null, placeLng: null });
    // A place picked from the nearby search carries its coordinates.
    if (!errors.place && b.place.lat !== undefined && b.place.lng !== undefined) {
      const lat = Number(b.place.lat); const lng = Number(b.place.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng) && geo.isLat(lat) && geo.isLng(lng)) Object.assign(values, { placeLat: lat, placeLng: lng });
    }
  } else errors.spotId = 'Choose a meetup spot or name a public place.';
  const d = typeof b.meetAt === 'string' ? new Date(b.meetAt) : null;
  if (!d || isNaN(d.getTime())) errors.meetAt = 'Pick a date and time to meet.';
  else if (ms(d) <= ms(t)) errors.meetAt = 'Pick a time in the future.';
  else if (ms(d) > ms(t) + MAX_DAYS * 24 * HOUR) errors.meetAt = 'Pick a time within the next ' + MAX_DAYS + ' days.';
  else values.meetAt = d;
  if (b.note === undefined || b.note === null) values.note = null;
  else if (typeof b.note !== 'string') errors.note = 'Note must be text.';
  else if (clean(b.note).length > NOTE_MAX) errors.note = 'Keep the note under ' + NOTE_MAX + ' characters.';
  else values.note = clean(b.note) || null;
  return { errors, values };
}

// Is someone allowed another suggestion in this conversation? -> error code or null.
async function proposalBlocker(conv, me, t) {
  const P = models().MeetupProposal;
  if (await P.count({ where: { conversationId: conv.id, status: 'pending' } })) return 'pending';
  if (await P.count({ where: { conversationId: conv.id, proposerId: me, createdAt: { [Op.gt]: new Date(ms(t) - 24 * HOUR) } } }) >= PER_DAY) return 'too_many';
  return null;
}

// ---- optional nearby-place search (Google Places API, server key) -------------
const placesKey = () => String(process.env.GOOGLE_PLACES_API_KEY || '').trim();
const PLACES_PER_HOUR = 30;
const placeHits = new Map(); // userId -> [timestamps]

function allowPlacesSearch(userId, at) {
  const t = ms(at || now());
  const list = (placeHits.get(userId) || []).filter((x) => x > t - HOUR);
  if (list.length >= PLACES_PER_HOUR) { placeHits.set(userId, list); return false; }
  list.push(t);
  placeHits.set(userId, list);
  if (placeHits.size > 5000) placeHits.delete(placeHits.keys().next().value);
  return true;
}

// Text Search (New), biased to a circle around the origin. Never logs the key.
async function googlePlaces(query, origin, key) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.primaryType' },
      body: JSON.stringify({ textQuery: query, maxResultCount: 8, locationBias: { circle: { center: { latitude: origin.lat, longitude: origin.lng }, radius: 8000 } } }),
    });
    if (!res.ok) { console.error('Places search failed with HTTP', res.status); return { status: 'error' }; }
    const body = await res.json();
    return { status: 'ok', results: (body.places || []).map((p) => ({ name: p.displayName && p.displayName.text, address: p.formattedAddress || null, lat: p.location && p.location.latitude, lng: p.location && p.location.longitude, type: p.primaryType || null })) };
  } catch (err) {
    console.error('Places search failed:', err && err.name);
    return { status: 'error' };
  } finally { clearTimeout(timer); }
}
let placesProvider = googlePlaces;
function setPlacesProvider(fn) { placesProvider = fn || googlePlaces; placeHits.clear(); }

async function searchPlaces(query, origin) {
  const key = placesKey();
  if (!key) return { status: 'no_key' };
  const r = await placesProvider(query, origin, key);
  if (r.status !== 'ok') return r;
  const results = r.results
    .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({ name: clean(p.name).slice(0, NAME_MAX), address: p.address ? clean(p.address).slice(0, ADDRESS_MAX) : null, lat: p.lat, lng: p.lng, type: p.type,
      distanceMiles: roundTo(geo.haversineMiles(origin, p), origin.step) }))
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
  return { status: 'ok', results };
}

module.exports = {
  NAME_MAX, ADDRESS_MAX, NOTE_MAX, SPOT_NOTES_MAX, MAX_DAYS, NEAR_MILES, PER_DAY, SUMMARY,
  now, spotJSON, validateSpot, originFor, nearestSpots, whenText, postEvent, sweep, endBetween, mapsUrl, proposalJSON,
  parseProposal, proposalBlocker, placesKey, allowPlacesSearch, searchPlaces, setPlacesProvider,
};
