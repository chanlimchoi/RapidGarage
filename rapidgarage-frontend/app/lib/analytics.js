// Admin analytics: pure helpers (see test/analytics.test.js). The view is
// app/admin/Analytics.jsx, the chart app/admin/TrendChart.jsx.

export const RANGES = [7, 30, 90];

// Change versus the previous period: { pct, dir } where dir is up | down | flat.
// pct is null when the previous period had nothing (no meaningful percentage).
export function delta(total, previous) {
  if (total === previous) return { pct: 0, dir: 'flat' };
  const dir = total > previous ? 'up' : 'down';
  if (!previous) return { pct: null, dir };
  return { pct: Math.round(((total - previous) / previous) * 100), dir };
}

// A "nice" axis top: 1, 2, 5 x 10^n at or above max (at least 1).
export function niceMax(max) {
  if (!(max > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

// Geometry for a single-series area chart in a W x H box (y grows down).
// Returns { top, points: [{ x, y, date, count }], line, area }.
export function areaGeometry(series, W, H, pad) {
  const p = pad || 0;
  const n = series.length;
  const top = niceMax(Math.max(0, ...series.map((d) => d.count)));
  const x = (i) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v) => p + (H - 2 * p) * (1 - v / top);
  const points = series.map((d, i) => ({ x: x(i), y: y(d.count), date: d.date, count: d.count }));
  const line = points.map((pt, i) => (i ? 'L' : 'M') + pt.x.toFixed(2) + ' ' + pt.y.toFixed(2)).join(' ');
  const area = points.length ? line + ' L' + points[points.length - 1].x.toFixed(2) + ' ' + H + ' L' + points[0].x.toFixed(2) + ' ' + H + ' Z' : '';
  return { top, points, line, area };
}

// Index of the data point nearest to a pointer at fraction f (0..1) of the width.
export function nearestIndex(f, n) {
  if (n <= 1) return 0;
  return Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))));
}
