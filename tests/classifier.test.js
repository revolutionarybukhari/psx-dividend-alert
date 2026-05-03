import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classify, fingerprint, buyDeadlineFor } from '../src/classifier.js';
import { parseISO } from '../src/trading-calendar.js';

const HOLIDAYS = new Set();

/** @type {import('../src/classifier.js').PayoutRow} */
const sampleRow = {
  symbol: 'MEBL',
  company: 'Meezan Bank Limited',
  payoutType: 'Cash Dividend',
  payout: '175%',
  bcFrom: '2026-05-15', // Fri
  bcTo: '2026-05-22',
  announced: '2026-04-20',
};

const emptyState = () => ({ seen: {} });

test('fingerprint dedupes by symbol + bcFrom', () => {
  assert.equal(fingerprint(sampleRow), 'MEBL@2026-05-15');
});

test('buyDeadlineFor is bcFrom minus 2 trading days', () => {
  // bcFrom Fri 2026-05-15 → minus 2 trading days → Wed 2026-05-13
  assert.equal(buyDeadlineFor(sampleRow, HOLIDAYS), '2026-05-13');
});

test('first sighting → NEW', () => {
  const decision = classify(sampleRow, emptyState(), {
    leadTimeDays: 5,
    now: parseISO('2026-05-01'),
    holidays: HOLIDAYS,
  });
  assert.equal(decision.kind, 'NEW');
  assert.equal(decision.fingerprint, 'MEBL@2026-05-15');
});

test('within lead time, already seen, not yet alerted UPCOMING → UPCOMING', () => {
  // Today 2026-05-09, deadline 2026-05-13 → 4 days away
  const state = {
    seen: { 'MEBL@2026-05-15': { firstSeen: '2026-05-01', alertsSent: ['NEW'] } },
  };
  const decision = classify(sampleRow, state, {
    leadTimeDays: 5,
    now: parseISO('2026-05-09'),
    holidays: HOLIDAYS,
  });
  assert.equal(decision.kind, 'UPCOMING');
  assert.equal(decision.daysToDeadline, 4);
});

test('outside lead time, already seen → no alert', () => {
  const state = {
    seen: { 'MEBL@2026-05-15': { firstSeen: '2026-05-01', alertsSent: ['NEW'] } },
  };
  const decision = classify(sampleRow, state, {
    leadTimeDays: 5,
    now: parseISO('2026-05-04'), // 9 days out
    holidays: HOLIDAYS,
  });
  assert.equal(decision.kind, null);
});

test('today is the deadline → URGENT', () => {
  const state = {
    seen: { 'MEBL@2026-05-15': { firstSeen: '2026-05-01', alertsSent: ['NEW', 'UPCOMING'] } },
  };
  const decision = classify(sampleRow, state, {
    leadTimeDays: 5,
    now: parseISO('2026-05-13'),
    holidays: HOLIDAYS,
  });
  assert.equal(decision.kind, 'URGENT');
  assert.equal(decision.daysToDeadline, 0);
});

test('tomorrow is the deadline → URGENT', () => {
  const state = {
    seen: { 'MEBL@2026-05-15': { firstSeen: '2026-05-01', alertsSent: ['NEW', 'UPCOMING'] } },
  };
  const decision = classify(sampleRow, state, {
    leadTimeDays: 5,
    now: parseISO('2026-05-12'),
    holidays: HOLIDAYS,
  });
  assert.equal(decision.kind, 'URGENT');
  assert.equal(decision.daysToDeadline, 1);
});

test('deadline already passed, not yet PASSED-alerted → PASSED', () => {
  const state = {
    seen: {
      'MEBL@2026-05-15': { firstSeen: '2026-05-01', alertsSent: ['NEW', 'UPCOMING', 'URGENT'] },
    },
  };
  const decision = classify(sampleRow, state, {
    leadTimeDays: 5,
    now: parseISO('2026-05-14'),
    holidays: HOLIDAYS,
  });
  assert.equal(decision.kind, 'PASSED');
  assert.ok(decision.daysToDeadline < 0);
});

test('PASSED only fires once', () => {
  const state = {
    seen: {
      'MEBL@2026-05-15': {
        firstSeen: '2026-05-01',
        alertsSent: ['NEW', 'UPCOMING', 'URGENT', 'PASSED'],
      },
    },
  };
  const decision = classify(sampleRow, state, {
    leadTimeDays: 5,
    now: parseISO('2026-05-14'),
    holidays: HOLIDAYS,
  });
  assert.equal(decision.kind, null);
});

test('URGENT only fires once', () => {
  const state = {
    seen: {
      'MEBL@2026-05-15': {
        firstSeen: '2026-05-01',
        alertsSent: ['NEW', 'UPCOMING', 'URGENT'],
      },
    },
  };
  const decision = classify(sampleRow, state, {
    leadTimeDays: 5,
    now: parseISO('2026-05-13'),
    holidays: HOLIDAYS,
  });
  assert.equal(decision.kind, null);
});
