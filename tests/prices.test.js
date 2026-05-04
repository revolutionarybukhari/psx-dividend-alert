import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePayoutAmount, computeYield, formatYield, formatRupees } from '../src/prices.js';
import { mapPrices, parsePrice } from '../src/scraper.js';

test('parsePayoutAmount: 175% on Rs 10 face = Rs 17.50/share', () => {
  const out = parsePayoutAmount('175%');
  assert.equal(out.type, 'percent');
  assert.equal(out.raw, 175);
  assert.equal(out.perShare, 17.5);
});

test('parsePayoutAmount: explicit rupee amount passes through', () => {
  const out = parsePayoutAmount('Rs 17.50/sh');
  assert.equal(out.type, 'rupees');
  assert.equal(out.perShare, 17.5);
});

test('parsePayoutAmount: PKR prefix and "per share" suffix', () => {
  const out = parsePayoutAmount('PKR 5 per share');
  assert.equal(out.type, 'rupees');
  assert.equal(out.perShare, 5);
});

test('parsePayoutAmount: bonus issue returns null', () => {
  assert.equal(parsePayoutAmount('20% B'), null);
  assert.equal(parsePayoutAmount('Bonus 10%'), null);
});

test('parsePayoutAmount: right issue returns null', () => {
  assert.equal(parsePayoutAmount('Right Shares 25%'), null);
});

test('parsePayoutAmount: junk returns null', () => {
  assert.equal(parsePayoutAmount(''), null);
  assert.equal(parsePayoutAmount('soon'), null);
  assert.equal(parsePayoutAmount(null), null);
});

test('parsePayoutAmount: respects custom faceValue', () => {
  // Some PSX stocks have Rs 100 face value (rare, but exists).
  const out = parsePayoutAmount('50%', { faceValue: 100 });
  assert.equal(out.perShare, 50);
});

test('computeYield: standard case', () => {
  // Rs 17.50 dividend on Rs 540 price ≈ 3.24%
  const y = computeYield(17.5, 540);
  assert.ok(y > 3.2 && y < 3.3);
});

test('computeYield: division-by-zero / negatives return null', () => {
  assert.equal(computeYield(17.5, 0), null);
  assert.equal(computeYield(17.5, -5), null);
  assert.equal(computeYield(0, 540), null);
  assert.equal(computeYield(-1, 540), null);
});

test('formatYield: 2dp under 10%, 1dp over', () => {
  assert.equal(formatYield(3.24), '3.24%');
  assert.equal(formatYield(3.2), '3.2%');
  assert.equal(formatYield(15.04), '15%');
  assert.equal(formatYield(0.005), '<0.01%');
});

test('formatRupees: trims trailing zeros', () => {
  assert.equal(formatRupees(17.5), 'Rs 17.5');
  assert.equal(formatRupees(17.0), 'Rs 17');
  assert.equal(formatRupees(540.25), 'Rs 540.25');
});

test('parsePrice: comma-stripped numbers', () => {
  assert.equal(parsePrice('1,234.50'), 1234.5);
  assert.equal(parsePrice('540'), 540);
});

test('parsePrice: strips parenthesised change indicators', () => {
  assert.equal(parsePrice('540.25 (1.20%)'), 540.25);
});

test('parsePrice: invalid → null', () => {
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice('—'), null);
  assert.equal(parsePrice('0'), null);
});

test('mapPrices: returns only requested symbols', () => {
  const out = mapPrices(
    {
      headers: ['symbol', 'name', 'current', 'change'],
      rows: [
        ['MEBL', 'Meezan Bank', '540.25', '+1.2%'],
        ['FFC', 'Fauji Fertilizer', '210.00', '-0.4%'],
        ['HBL', 'Habib Bank', '125.50', '+0.8%'],
      ],
    },
    new Set(['MEBL', 'HBL'])
  );
  assert.equal(out.size, 2);
  assert.equal(out.get('MEBL'), 540.25);
  assert.equal(out.get('HBL'), 125.5);
  assert.ok(!out.has('FFC'));
});

test('mapPrices: tolerates "last" instead of "current"', () => {
  const out = mapPrices(
    {
      headers: ['symbol', 'last'],
      rows: [['MEBL', '540']],
    },
    new Set(['MEBL'])
  );
  assert.equal(out.get('MEBL'), 540);
});

test('mapPrices: missing columns → empty map (no crash)', () => {
  const out = mapPrices({ headers: ['weird1', 'weird2'], rows: [['x', 'y']] }, new Set(['MEBL']));
  assert.equal(out.size, 0);
});
