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

module.exports = { MAX_STOPS, WHEN, plan, googleMapsUrl, nextOpening, placeOf };
