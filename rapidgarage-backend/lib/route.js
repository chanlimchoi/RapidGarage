'use strict';
// Order saved sales into a simple driving route: greedy nearest-neighbor from
// the start (the buyer's location, or the sale that opens first).
const { haversineMiles, postAddress, isLat, isLng } = require('./geo');
const schedule = require('./schedule');

// Google Maps URLs allow up to 9 waypoints plus the destination.
const MAX_STOPS = 10;
const WHEN = ['today', 'weekend', 'all'];

const hasCoords = (p) => isLat(p.lat) && isLng(p.lng);

// [when it is (or becomes) open, when that window closes]: open sales sort
// first, and among those the one closing soonest.
function nextOpening(post, at) {
  const t = +(at || schedule.now());
  const live = schedule.windowsOf(post).filter((w) => w.endsAt > t);
  if (!live.length) return [Infinity, Infinity];
  return [Math.max(live[0].startsAt, t), live[0].endsAt];
}
const earlier = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

function round(n) { return Math.round(n * 10) / 10; }

// posts: saved, visible, not-ended posts (with saleDays). start: {lat,lng}|null.
function plan(posts, start, at) {
  const left = posts.filter(hasCoords);
  const noLocation = posts.length - left.length;
  const ordered = [];
  let here = start;
  if (!here && left.length) {
    // No location shared: begin at the sale that opens first (then: closes first, then list order).
    let best = 0;
    left.forEach((p, i) => { if (earlier(nextOpening(p, at), nextOpening(left[best], at))) best = i; });
    const first = left.splice(best, 1)[0];
    ordered.push({ post: first, legMiles: null });
    here = first;
  }
  while (left.length && ordered.length < MAX_STOPS) {
    let best = 0;
    let bestD = Infinity;
    left.forEach((p, i) => {
      const d = haversineMiles(here, p);
      if (d < bestD - 1e-9) { best = i; bestD = d; }
    });
    const next = left.splice(best, 1)[0];
    ordered.push({ post: next, legMiles: round(bestD) });
    here = next;
  }
  const totalMiles = round(ordered.reduce((s, x) => s + (x.legMiles || 0), 0));
  return { ordered, omitted: left.length, noLocation, totalMiles };
}

// The sale's public address when it has one; its coordinates otherwise.
function placeOf(post) {
  const a = postAddress(post);
  return a && post.street ? a : post.lat + ',' + post.lng;
}

// https://developers.google.com/maps/documentation/urls/get-started#directions-action
function googleMapsUrl(start, posts) {
  if (!posts.length) return null;
  const q = ['api=1'];
  // Without an origin, Google Maps starts from the device's current location.
  if (start) q.push('origin=' + encodeURIComponent(start.lat + ',' + start.lng));
  q.push('destination=' + encodeURIComponent(placeOf(posts[posts.length - 1])));
  const mid = posts.slice(0, -1).map(placeOf);
  if (mid.length) q.push('waypoints=' + encodeURIComponent(mid.join('|')));
  q.push('travelmode=driving');
  return 'https://www.google.com/maps/dir/?' + q.join('&');
}

// ---- Time-aware plan (POST /route) ---------------------------------------
// A rough drive: straight-line miles x ROAD_FACTOR at AVG_MPH, plus the time
// spent at each sale. Greedy: from where you are, go next to the sale that
// costs the least time (drive + wait for it to open), among sales you'd reach
// while still open with time to look around. Sales you can't reach in time
// are listed as skipped with the reason, never silently dropped.
const AVG_MPH = 20;
const ROAD_FACTOR = 1.3;
const DWELL = { min: 5, max: 120, default: 20 };
const MIN_BROWSE_MIN = 10; // arriving later than 10 minutes before closing doesn't count

const driveMinutes = (miles) => (miles * ROAD_FACTOR / AVG_MPH) * 60;
const MIN = 60000;

// The window a visit arriving at t can use: the first one still open at t
// with at least MIN_BROWSE_MIN left (or a later one today/tomorrow...).
function usableWindow(post, t) {
  const w = schedule.windowsOf(post).filter((x) => x.endsAt - MIN_BROWSE_MIN * MIN >= t);
  return w.length ? w[0] : null;
}

// posts: visible posts (with saleDays). start: {lat,lng}|null. departAt: ms.
// dwell: minutes per stop. Returns { stops, skipped, totalMiles, finishAt }.
function planTimed(posts, start, departAt, dwell) {
  const left = [];
  const skipped = [];
  posts.forEach((p) => {
    if (!hasCoords(p)) skipped.push({ post: p, reason: 'no_location' });
    else if (!schedule.windowsOf(p).length) left.push(p); // no dates: treat as always open
    else if (!usableWindow(p, departAt)) skipped.push({ post: p, reason: 'ended' });
    else left.push(p);
  });
  const stops = [];
  let here = start;
  let t = departAt;
  const cost = (p) => {
    const miles = here ? haversineMiles(here, p) : 0;
    const arrive = t + driveMinutes(miles) * MIN;
    const dated = schedule.windowsOf(p).length > 0;
    const w = dated ? usableWindow(p, arrive) : null;
    if (dated && !w) return null;
    const begin = w ? Math.max(arrive, w.startsAt) : arrive;
    return { miles, arrive, begin, wait: begin - arrive, window: w, total: begin - t };
  };
  while (left.length && stops.length < MAX_STOPS) {
    let best = -1;
    let bestC = null;
    left.forEach((p, i) => {
      const c = cost(p);
      if (!c) return;
      // Least time first; then nearer; then the one that closes sooner.
      if (!bestC || c.total < bestC.total - 1000 || (Math.abs(c.total - bestC.total) <= 1000 && (c.miles < bestC.miles - 1e-9
        || (Math.abs(c.miles - bestC.miles) <= 1e-9 && c.window && bestC.window && c.window.endsAt < bestC.window.endsAt)))) { best = i; bestC = c; }
    });
    if (best < 0) break;
    const p = left.splice(best, 1)[0];
    const leave = bestC.window ? Math.min(bestC.begin + dwell * MIN, bestC.window.endsAt) : bestC.begin + dwell * MIN;
    stops.push({
      post: p, legMiles: here ? round(bestC.miles) : null,
      arriveAt: new Date(bestC.arrive).toISOString(), waitMinutes: Math.round(bestC.wait / MIN),
      leaveAt: new Date(leave).toISOString(),
      opensAt: bestC.window ? new Date(bestC.window.startsAt).toISOString() : null,
      closesAt: bestC.window ? new Date(bestC.window.endsAt).toISOString() : null,
    });
    here = p;
    t = leave;
  }
  // What's left: closed by the time you'd get there, or over the stop limit.
  left.forEach((p) => skipped.push({ post: p, reason: stops.length >= MAX_STOPS ? 'too_many' : 'closed_by_then' }));
  const totalMiles = round(stops.reduce((s, x) => s + (x.legMiles || 0), 0));
  return { stops, skipped, totalMiles, finishAt: stops.length ? stops[stops.length - 1].leaveAt : null };
}

module.exports = { MAX_STOPS, WHEN, AVG_MPH, ROAD_FACTOR, DWELL, MIN_BROWSE_MIN, plan, planTimed, driveMinutes, googleMapsUrl, nextOpening, placeOf };
