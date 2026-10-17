// Neighborhood sales on the map and in lists (pure helpers; see test/events.test.js).

// Split search results for the map: sales that belong to one of the shown
// events are drawn as that event's single pin (with a count), the rest as usual.
// -> { singles: [post], events: [{ event, posts }] }
export function groupForMap(posts, events) {
  const shown = new Map((events || []).filter((e) => typeof e.lat === 'number' && typeof e.lng === 'number').map((e) => [e.id, { event: e, posts: [] }]));
  const singles = [];
  (posts || []).forEach((p) => {
    const g = p.event && shown.get(p.event.id);
    if (g) g.posts.push(p); else singles.push(p);
  });
  return { singles, events: Array.from(shown.values()) };
}

// The number on an event pin: its public sale count (at least the members on this page).
export const pinCount = (g) => Math.max(g.event.saleCount || 0, g.posts.length);

// Area circle and sale dots projected onto a small SVG (no map tiles needed).
export function sketch(event, sales, w, h, pad) {
  const W = w || 320;
  const H = h || 200;
  const P = pad || 16;
  const k = Math.cos((event.lat * Math.PI) / 180);
  const r = event.radiusMiles / 69.0; // degrees of latitude
  const scale = (Math.min(W, H) / 2 - P) / r;
  const at = (lat, lng) => ({ x: W / 2 + (lng - event.lng) * k * scale, y: H / 2 - (lat - event.lat) * scale });
  return {
    W, H, cx: W / 2, cy: H / 2, r: r * scale,
    dots: (sales || []).filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number').map((s) => Object.assign({ id: s.id, title: s.title }, at(s.lat, s.lng))),
  };
}
