// Buyer wish radar helpers (pure; no imports, so node tests can load them).

// Bar width in percent relative to the busiest term (never below 8 so a bar shows).
export function barPercent(count, max) {
  if (!max || !count) return 0;
  return Math.max(8, Math.round((count / max) * 100));
}

// Which summary line to show: { key, vars }.
export function summary(data) {
  if (!data) return null;
  if (data.hunters === null || data.hunters === undefined) return { key: 'radar.fewer', vars: { n: data.fewerThan || data.minHunters } };
  return { key: 'radar.hunters', vars: { count: data.hunters } };
}

// Terms split into what the seller already has listed and ideas to dig out.
export function splitTerms(terms) {
  const have = []; const ideas = [];
  (terms || []).forEach((x) => (x.onYourList ? have : ideas).push(x));
  return { have, ideas };
}
