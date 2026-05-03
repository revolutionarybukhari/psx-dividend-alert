import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDate, mapRows } from '../src/scraper.js';

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
