import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDate, parseBookClosureRange, inferPayoutType, mapRows } from '../src/scraper.js';

test('normalizeDate: ISO passes through', () => {
  assert.equal(normalizeDate('2026-05-15'), '2026-05-15');
});

test('normalizeDate: 01-Jun-2026 → ISO', () => {
  assert.equal(normalizeDate('01-Jun-2026'), '2026-06-01');
});

test('normalizeDate: 1 Jun 2026 → ISO', () => {
  assert.equal(normalizeDate('1 Jun 2026'), '2026-06-01');
});

test('normalizeDate: DD/MM/YYYY → ISO', () => {
  assert.equal(normalizeDate('01/06/2026'), '2026-06-01');
});

test('normalizeDate: junk returns null', () => {
  assert.equal(normalizeDate('soon'), null);
  assert.equal(normalizeDate(''), null);
  assert.equal(normalizeDate('   '), null);
});

test('mapRows: handles minor header drift', () => {
  const out = mapRows({
    headers: ['symbol', 'company name', 'type', 'payout', 'bc from', 'bc to', 'announced'],
    rows: [
      [
        'MEBL',
        'Meezan Bank Limited',
        'Cash Dividend',
        '175%',
        '15-May-2026',
        '22-May-2026',
        '20-Apr-2026',
      ],
      ['FFC', 'Fauji Fertilizer', 'Cash Dividend', '100%', '01/06/2026', '08/06/2026', ''],
    ],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].symbol, 'MEBL');
  assert.equal(out[0].bcFrom, '2026-05-15');
  assert.equal(out[1].bcFrom, '2026-06-01');
});

test('mapRows: skips rows with unparseable bcFrom', () => {
  const out = mapRows({
    headers: ['symbol', 'bc from'],
    rows: [
      ['MEBL', '15-May-2026'],
      ['HBL', 'soon'],
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].symbol, 'MEBL');
});

test('mapRows: lowercases nothing, uppercases symbols', () => {
  const out = mapRows({
    headers: ['symbol', 'bc from'],
    rows: [['mebl', '2026-05-15']],
  });
  assert.equal(out[0].symbol, 'MEBL');
});

// ---- Real PSX layout (current as of 2026-05) ---------------------------

test('normalizeDate: "March 6, 2026 2:00 PM" with trailing time → ISO', () => {
  assert.equal(normalizeDate('March 6, 2026 2:00 PM'), '2026-03-06');
});

test('normalizeDate: "March 6, 2026" (no time) → ISO', () => {
  assert.equal(normalizeDate('March 6, 2026'), '2026-03-06');
});

test('normalizeDate: full month name with no comma', () => {
  assert.equal(normalizeDate('December 30 2026'), '2026-12-30');
});

test('normalizeDate: range cell — first half wins', () => {
  assert.equal(normalizeDate('23/03/2026  - 30/03/2026'), '2026-03-23');
});

test('parseBookClosureRange: standard PSX range', () => {
  assert.deepEqual(parseBookClosureRange('23/03/2026  - 30/03/2026'), {
    from: '2026-03-23',
    to: '2026-03-30',
  });
});

test('parseBookClosureRange: single date — to mirrors from', () => {
  assert.deepEqual(parseBookClosureRange('23/03/2026'), {
    from: '2026-03-23',
    to: '2026-03-23',
  });
});

test('parseBookClosureRange: empty / placeholder cell', () => {
  assert.equal(parseBookClosureRange(''), null);
  assert.equal(parseBookClosureRange('-'), null);
});

test('inferPayoutType: (F) (D) → Final cash dividend', () => {
  assert.equal(inferPayoutType('17%(F) (D)'), 'Cash Dividend (Final)');
});

test('inferPayoutType: (i) (D) → Interim cash dividend', () => {
  assert.equal(inferPayoutType('20%(i) (D)'), 'Cash Dividend (Interim)');
});

test('inferPayoutType: (ii) is also Interim', () => {
  // PSX uses (i), (ii), (iii) for 1st/2nd/3rd interim — we treat all as Interim.
  assert.equal(inferPayoutType('100%(ii) (D)'), 'Cash Dividend (Interim)');
  assert.equal(inferPayoutType('30%(iii) (D)'), 'Cash Dividend (Interim)');
});

test('inferPayoutType: (D) only → unqualified Cash Dividend', () => {
  assert.equal(inferPayoutType('60%(D)'), 'Cash Dividend');
});

test('inferPayoutType: (B) → Bonus', () => {
  assert.equal(inferPayoutType('20%(B)'), 'Bonus');
});

test('inferPayoutType: (R) → Right Shares', () => {
  assert.equal(inferPayoutType('= 37.65% AT A PREMIUM RS. 30/= PER SHARE (R)'), 'Right Shares');
});

test('mapRows: real PSX layout (combined BC column, "Dividend Announcement")', () => {
  const out = mapRows({
    headers: [
      'Symbol',
      'Company',
      'Sector',
      'Dividend Announcement',
      'Date / Time of Announcement',
      'Book Closure Date',
    ],
    rows: [
      [
        'BOK',
        'The Bank of Khyber',
        'COMMERCIAL BANKS',
        '17%(F) (D)',
        'March 6, 2026 2:00 PM',
        '23/03/2026  - 30/03/2026',
      ],
      [
        'PTL',
        'Panther Tyres Ltd.',
        'AUTOMOBILE PARTS & ACCESSORIES',
        '20%(i) (D)',
        'March 5, 2026 2:45 PM',
        '12/03/2026  - 13/03/2026',
      ],
    ],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].symbol, 'BOK');
  assert.equal(out[0].payout, '17%(F) (D)');
  assert.equal(out[0].payoutType, 'Cash Dividend (Final)');
  assert.equal(out[0].bcFrom, '2026-03-23');
  assert.equal(out[0].bcTo, '2026-03-30');
  assert.equal(out[0].announced, '2026-03-06');
  assert.equal(out[1].payoutType, 'Cash Dividend (Interim)');
  assert.equal(out[1].bcFrom, '2026-03-12');
  assert.equal(out[1].bcTo, '2026-03-13');
});

test('mapRows: skips rows whose BC cell is just a placeholder ("-")', () => {
  const out = mapRows({
    headers: ['Symbol', 'Dividend Announcement', 'Book Closure Date'],
    rows: [
      ['MEBL', '175%(F) (D)', '15/05/2026 - 22/05/2026'],
      ['MFFL', '10%(i) (D)', '-'],
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].symbol, 'MEBL');
});
