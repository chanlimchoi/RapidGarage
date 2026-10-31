import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachRows, keptPercent, soldPercent, reportCsv, reportFileName, REACH_KEYS } from '../app/lib/saleReport.js';

const report = {
  post: { title: 'Porch Sale!' },
  totals: { items: 4, sold: 3, unsold: 1, earnedCents: 2000, listedValueSoldCents: 2500 },
  sold: [{ name: 'Lamp', listedCents: 500, soldCents: 500, priceSource: 'listed' }, { name: 'Chair "oak"', listedCents: 2000, soldCents: 1500, priceSource: 'offer' }, { name: '=SUM(A1)', listedCents: null, soldCents: null, priceSource: null }],
  unsold: [{ name: 'Desk', listedCents: 4000 }],
  reach: { views: 15, scans: 4, saves: 1 },
};

test('reach rows in order, missing counts are zero', () => {
  const rows = reachRows(report);
  assert.deepEqual(rows.map((r) => r.key), REACH_KEYS);
  assert.deepEqual(rows.slice(0, 4).map((r) => r.value), [15, 4, 0, 1]);
  assert.deepEqual(reachRows(null).map((r) => r.value), REACH_KEYS.map(() => 0));
});

test('percentages', () => {
  assert.equal(keptPercent(report.totals), 80);
  assert.equal(soldPercent(report.totals), 75);
  assert.equal(keptPercent({ earnedCents: 0, listedValueSoldCents: 0 }), null);
  assert.equal(soldPercent({ items: 0 }), null);
});

test('CSV: quoted, formula-safe, sold then unsold', () => {
  const lines = reportCsv(report).trim().split('\r\n');
  assert.equal(lines[0], '"Item","Status","Listed","Sold for","Price from"');
  assert.equal(lines[1], '"Lamp","sold","5.00","5.00","listed"');
  assert.equal(lines[2], '"Chair ""oak""","sold","20.00","15.00","offer"');
  assert.equal(lines[3], '"\'=SUM(A1)","sold","","",""');
  assert.equal(lines[4], '"Desk","unsold","40.00","",""');
  assert.equal(reportFileName('Porch Sale!'), 'porch-sale-report.csv');
  assert.equal(reportFileName('세일'), 'sale-report.csv');
});
