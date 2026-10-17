import React from 'react';

// A small schematic of the route (no map tiles needed): stops are projected
// onto an SVG in visiting order. The real map is shown alongside when available.
const W = 320;
const H = 180;
const PAD = 22;

export default function RouteSketch({ start, stops }) {
  const pts = (start ? [{ lat: start.lat, lng: start.lng, start: true }] : [])
    .concat(stops.map((s, i) => ({ lat: s.post.lat, lng: s.post.lng, n: i + 1, title: s.post.title })));
  if (pts.length < 1) return null;
  const midLat = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
  const k = Math.cos((midLat * Math.PI) / 180);
  const xs = pts.map((p) => p.lng * k);
  const ys = pts.map((p) => -p.lat);
  const minX = Math.min.apply(null, xs);
  const minY = Math.min.apply(null, ys);
  const span = Math.max(Math.max.apply(null, xs) - minX, Math.max.apply(null, ys) - minY, 1e-6);
  const scale = Math.min((W - PAD * 2) / span, (H - PAD * 2) / span);
  const offX = (W - (Math.max.apply(null, xs) - minX) * scale) / 2;
  const offY = (H - (Math.max.apply(null, ys) - minY) * scale) / 2;
  const at = pts.map((p, i) => Object.assign({}, p, { x: offX + (xs[i] - minX) * scale, y: offY + (ys[i] - minY) * scale }));
  const d = at.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
  return (
    <figure className="route-sketch">
      <svg viewBox={'0 0 ' + W + ' ' + H} role="img" aria-label={'Route sketch with ' + stops.length + (stops.length === 1 ? ' stop' : ' stops')}>
        <path d={d} className="route-sketch-line" />
        {at.map((p, i) => (p.start ? (
          <g key={'s' + i} className="route-sketch-start">
            <circle cx={p.x} cy={p.y} r="7" />
            <text x={p.x} y={p.y - 12} textAnchor="middle">You</text>
          </g>
        ) : (
          <g key={p.n} className="route-sketch-stop">
            <title>{p.n + '. ' + p.title}</title>
            <circle cx={p.x} cy={p.y} r="11" />
            <text x={p.x} y={p.y + 4} textAnchor="middle">{p.n}</text>
          </g>
        )))}
      </svg>
      <figcaption className="small muted">Straight-line sketch. Not to scale for driving.</figcaption>
    </figure>
  );
}
