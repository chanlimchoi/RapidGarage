// Seller sale report (backend lib/saleReport.js): pure helpers for the
// printable page (test/sale-report.test.js).

// Reach cards in print order: [{ key, value }] (labels are report.<key>).
export const REACH_KEYS = ['views', 'scans', 'shares', 'saves', 'conversations', 'messages', 'holdsCompleted'];
export function reachRows(report) {
  const r = (report && report.reach) || {};
  return REACH_KEYS.map((key) => ({ key, value: Number(r[key]) || 0 }));
}

// Share of listed value actually earned on the sold items (null when none
// had a price): 2000 earned of 2500 listed -> 80.
export function keptPercent(totals) {
  if (!totals || !totals.listedValueSoldCents) return null;
  return Math.round((totals.earnedCents / totals.listedValueSoldCents) * 100);
}

// Sold share of all items, 0-100 (null with no items).
export function soldPercent(totals) {
  if (!totals || !totals.items) return null;
  return Math.round((totals.sold / totals.items) * 100);
}

const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote, and defuse spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return '"' + safe.replace(/"/g, '""') + '"';
};
const dollars = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2));

// CSV of the item lines: name, status, listed, sold-for, price source.
export function reportCsv(report, labels) {
  const L = labels || {};
  const head = [L.item || 'Item', L.status || 'Status', L.listed || 'Listed', L.soldFor || 'Sold for', L.source || 'Price from'];
  const rows = [head.map(cell).join(',')];
  ((report && report.sold) || []).forEach((i) => rows.push([i.name, L.sold || 'sold', dollars(i.listedCents), dollars(i.soldCents), i.priceSource || ''].map(cell).join(',')));
  ((report && report.unsold) || []).forEach((i) => rows.push([i.name, L.unsold || 'unsold', dollars(i.listedCents), '', ''].map(cell).join(',')));
  return rows.join('\r\n') + '\r\n';
}

// "porch-sale-report.csv"
export function reportFileName(title) {
  const slug = String(title || 'sale').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sale';
  return slug + '-report.csv';
}
