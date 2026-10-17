// Seller dashboard helpers (pure; see test/dashboard.test.js).

export const METRICS = ['views', 'scans', 'saves', 'messages', 'shares'];

// A round axis maximum >= n: 1, 2, 5, 10, 20, 50, ...
export function niceMax(n) {
  if (!(n > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  const m = n / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

// Bar rectangles for a series [{ date, count }] in a w x h box (bottom-aligned).
// A zero day still gets a 1px stub so the time axis reads as continuous.
export function bars(series, w, h, gap) {
  const n = series.length || 1;
  const g = gap === undefined ? 3 : gap;
  const max = niceMax(Math.max(0, ...series.map((d) => d.count)));
  const bw = Math.max(1, (w - g * (n - 1)) / n);
  return {
    max,
    bars: series.map((d, i) => {
      const bh = d.count ? Math.max(2, (d.count / max) * h) : 1;
      return { date: d.date, count: d.count, x: i * (bw + g), y: h - bh, w: bw, h: bh };
    }),
  };
}

export const sum = (series) => series.reduce((n, d) => n + d.count, 0);

// Change of the last 7 days vs the 7 before: { last, prev, delta } (delta null without a base).
export function weekChange(series) {
  const last = sum(series.slice(-7));
  const prev = sum(series.slice(-14, -7));
  return { last, prev, delta: prev ? Math.round(((last - prev) / prev) * 100) : null };
}

export const soldPct = (items) => (items && items.total ? Math.round((items.sold / items.total) * 100) : 0);

// all | active (upcoming, open or without dates) | ended (hidden sales count as neither, shown under "all").
export function filterSales(sales, filter) {
  if (filter === 'active') return sales.filter((s) => !s.ended && s.status !== 'hidden');
  if (filter === 'ended') return sales.filter((s) => s.ended);
  return sales;
}
