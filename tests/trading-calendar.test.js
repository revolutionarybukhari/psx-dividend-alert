import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseISO,
  formatISO,
  isWeekend,
  isTradingDay,
  subtractTradingDays,
  daysBetween,
} from '../src/trading-calendar.js';

test('parseISO / formatISO round-trip', () => {
  assert.equal(formatISO(parseISO('2026-05-15')), '2026-05-15');
});

test('isWeekend recognises Saturday and Sunday', () => {
  assert.equal(isWeekend(parseISO('2026-05-09')), true); // Sat
  assert.equal(isWeekend(parseISO('2026-05-10')), true); // Sun
  assert.equal(isWeekend(parseISO('2026-05-11')), false); // Mon
});

test('isTradingDay treats holidays as non-trading', () => {
  const holidays = new Set(['2026-05-11']);
  assert.equal(isTradingDay(parseISO('2026-05-11'), holidays), false);
  assert.equal(isTradingDay(parseISO('2026-05-12'), holidays), true);
});

test('subtractTradingDays skips weekends', () => {
  // Mon 2026-05-18 minus 2 trading days = Thu 2026-05-14
  const out = subtractTradingDays(parseISO('2026-05-18'), 2, new Set());
  assert.equal(formatISO(out), '2026-05-14');
});

test('subtractTradingDays skips holidays too', () => {
  // Mon 2026-05-18 minus 2 trading days, with Friday closed = Wed 2026-05-13
  const holidays = new Set(['2026-05-15']); // Fri
  const out = subtractTradingDays(parseISO('2026-05-18'), 2, holidays);
  assert.equal(formatISO(out), '2026-05-13');
});

test('subtractTradingDays(0) is a no-op', () => {
  const start = parseISO('2026-05-20');
  assert.equal(formatISO(subtractTradingDays(start, 0, new Set())), '2026-05-20');
});

test('daysBetween counts calendar days', () => {
  assert.equal(daysBetween(parseISO('2026-05-01'), parseISO('2026-05-08')), 7);
  assert.equal(daysBetween(parseISO('2026-05-08'), parseISO('2026-05-01')), -7);
});
