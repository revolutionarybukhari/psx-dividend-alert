import { test } from 'node:test';
import assert from 'node:assert/strict';

import { categorizeAnnouncement, extractPayoutText, mapAnnouncements } from '../src/scraper.js';
import {
  classifyAnnouncement,
  fingerprintAnnouncement,
  formatAnnouncementAlert,
  applyAnnouncementFilters,
} from '../src/announcements.js';

test('categorizeAnnouncement: dividend wins over bonus when both present', () => {
  assert.equal(categorizeAnnouncement('Cash Dividend & Bonus Issue'), 'dividend');
});

test('categorizeAnnouncement: dividend variants', () => {
  assert.equal(categorizeAnnouncement('Cash dividend @ 175%'), 'dividend');
  assert.equal(categorizeAnnouncement('Final payout for FY26'), 'dividend');
  assert.equal(categorizeAnnouncement('Interim Cash Payout'), 'dividend');
});

test('categorizeAnnouncement: bonus / right / other', () => {
  assert.equal(categorizeAnnouncement('Bonus issue of 20%'), 'bonus');
  assert.equal(categorizeAnnouncement('Right shares offer'), 'right');
  assert.equal(categorizeAnnouncement('Quarterly results — Q1 FY26'), 'other');
});

test('extractPayoutText: rupee amount', () => {
  const out = extractPayoutText('Cash Dividend @ Rs. 17.50/share');
  assert.match(out, /Rs\.?\s*17\.50/);
});

test('extractPayoutText: percent amount', () => {
  assert.equal(extractPayoutText('175% cash dividend'), '175%');
});

test('extractPayoutText: nothing useful → undefined', () => {
  assert.equal(extractPayoutText('Quarterly results'), undefined);
});

test('mapAnnouncements: extracts symbol, date, category', () => {
  const out = mapAnnouncements({
    headers: ['date', 'symbol', 'subject'],
    rows: [
      {
        cells: ['01-May-2026', 'MEBL', 'Cash Dividend @ Rs. 17.50/share'],
        attachmentUrl: 'https://dps.psx.com.pk/download/123.pdf',
      },
      {
        cells: ['02-May-2026', 'OGDC', 'Quarterly results Q1 FY26'],
        attachmentUrl: '',
      },
    ],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].symbol, 'MEBL');
  assert.equal(out[0].date, '2026-05-01');
  assert.equal(out[0].category, 'dividend');
  assert.match(out[0].payoutText, /17\.50/);
  assert.equal(out[0].attachmentUrl, 'https://dps.psx.com.pk/download/123.pdf');
  assert.equal(out[1].category, 'other');
  assert.equal(out[1].attachmentUrl, undefined);
});

test('fingerprintAnnouncement: symbol@announced:date', () => {
  assert.equal(
    fingerprintAnnouncement({ symbol: 'MEBL', date: '2026-05-01' }),
    'MEBL@announced:2026-05-01'
  );
});

test('classifyAnnouncement: first sight → DECLARED', () => {
  const ann = { symbol: 'MEBL', date: '2026-05-01' };
  const decision = classifyAnnouncement(ann, { seen: {} });
  assert.equal(decision.kind, 'DECLARED');
  assert.equal(decision.fingerprint, 'MEBL@announced:2026-05-01');
});

test('classifyAnnouncement: already-DECLARED → null', () => {
  const ann = { symbol: 'MEBL', date: '2026-05-01' };
  const state = {
    seen: {
      'MEBL@announced:2026-05-01': { firstSeen: '2026-05-01', alertsSent: ['DECLARED'] },
    },
  };
  assert.equal(classifyAnnouncement(ann, state).kind, null);
});

test('formatAnnouncementAlert: includes symbol, date, subject', () => {
  const text = formatAnnouncementAlert({
    symbol: 'MEBL',
    date: '2026-05-01',
    subject: 'Cash Dividend @ Rs. 17.50/share',
    category: 'dividend',
    payoutText: 'Rs. 17.50/share',
    attachmentUrl: 'https://dps.psx.com.pk/download/123.pdf',
  });
  assert.match(text, /DECLARED/);
  assert.match(text, /\$MEBL/);
  assert.match(text, /2026-05-01/);
  assert.match(text, /17\.50/);
  assert.match(text, /PDF announcement/);
});

test('applyAnnouncementFilters: respects watchlist + types', () => {
  const list = [
    { symbol: 'MEBL', date: '2026-05-01', subject: 'div', category: 'dividend' },
    { symbol: 'FFC', date: '2026-05-01', subject: 'div', category: 'dividend' },
    { symbol: 'MEBL', date: '2026-05-02', subject: 'q1', category: 'other' },
  ];
  const out = applyAnnouncementFilters(list, {
    watchlist: ['MEBL'],
    watchAll: false,
    types: ['dividend'],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].symbol, 'MEBL');
  assert.equal(out[0].category, 'dividend');
});

test('applyAnnouncementFilters: watchAll passes everything in allowed types', () => {
  const list = [
    { symbol: 'MEBL', date: '2026-05-01', subject: 'div', category: 'dividend' },
    { symbol: 'FFC', date: '2026-05-01', subject: 'bon', category: 'bonus' },
    { symbol: 'XYZ', date: '2026-05-02', subject: 'q1', category: 'other' },
  ];
  const out = applyAnnouncementFilters(list, {
    watchlist: [],
    watchAll: true,
    types: ['dividend', 'bonus'],
  });
  assert.equal(out.length, 2);
});
