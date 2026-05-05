import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyWatchlist,
  formatAlert,
  runTick,
  runAnnouncementsTick,
  markBackfilled,
  passesYieldFilter,
} from '../src/alerter.js';
import { parseISO } from '../src/trading-calendar.js';
import { emptyState } from '../src/state.js';

const HOLIDAYS = new Set();

const rowMEBL = {
  symbol: 'MEBL',
  company: 'Meezan Bank Limited',
  payoutType: 'Cash Dividend',
  payout: '175%',
  bcFrom: '2026-05-15',
  bcTo: '2026-05-22',
  announced: '2026-04-20',
};

const rowFFC = {
  symbol: 'FFC',
  company: 'Fauji Fertilizer',
  payoutType: 'Cash Dividend',
  payout: '100%',
  bcFrom: '2026-06-01',
  bcTo: '2026-06-08',
  announced: '2026-05-01',
};

const baseConfig = {
  telegram: { botToken: 't', chatId: '1' },
  watchlist: ['MEBL'],
  watchAll: false,
  leadTimeDays: 5,
  checkIntervalMinutes: 60,
  stateFile: '/tmp/psx-test-state.json',
};

test('applyWatchlist filters to listed symbols', () => {
  const out = applyWatchlist([rowMEBL, rowFFC], baseConfig);
  assert.equal(out.length, 1);
  assert.equal(out[0].symbol, 'MEBL');
});

test('applyWatchlist with watchAll passes everything through', () => {
  const out = applyWatchlist([rowMEBL, rowFFC], { ...baseConfig, watchAll: true });
  assert.equal(out.length, 2);
});

test('formatAlert mentions kind, symbol, deadline, payout', () => {
  const text = formatAlert(rowMEBL, 'NEW', '2026-05-13', 12);
  assert.match(text, /NEW DIVIDEND/);
  assert.match(text, /\$MEBL/);
  assert.match(text, /Meezan Bank Limited/);
  assert.match(text, /175%/);
  assert.match(text, /2026-05-13/);
});

test('formatAlert URGENT day-0 says TODAY', () => {
  const text = formatAlert(rowMEBL, 'URGENT', '2026-05-13', 0);
  assert.match(text, /Buy <b>TODAY<\/b>/);
});

test('formatAlert URGENT day-1 says tomorrow', () => {
  const text = formatAlert(rowMEBL, 'URGENT', '2026-05-13', 1);
  assert.match(text, /tomorrow/);
});

test('runTick fires NEW on first sight and persists state', async () => {
  const sent = [];
  const result = await runTick({
    rows: [rowMEBL],
    state: emptyState(),
    config: baseConfig,
    holidays: HOLIDAYS,
    send: async (text) => {
      sent.push(text);
    },
    clock: () => parseISO('2026-04-25'),
  });

  assert.equal(result.alerted, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /NEW DIVIDEND/);
  const entry = result.state.seen['MEBL@2026-05-15'];
  assert.ok(entry);
  assert.deepEqual(entry.alertsSent, ['NEW']);
});

test('runTick is idempotent when nothing changed', async () => {
  const sent = [];
  const send = async (t) => {
    sent.push(t);
  };

  let r = await runTick({
    rows: [rowMEBL],
    state: emptyState(),
    config: baseConfig,
    holidays: HOLIDAYS,
    send,
    clock: () => parseISO('2026-04-25'),
  });

  // Same day, run again — no second alert.
  r = await runTick({
    rows: [rowMEBL],
    state: r.state,
    config: baseConfig,
    holidays: HOLIDAYS,
    send,
    clock: () => parseISO('2026-04-25'),
  });

  assert.equal(sent.length, 1);
  assert.equal(r.alerted, 0);
});

test('runTick fires UPCOMING when within lead time on a later day', async () => {
  const sent = [];
  const send = async (t) => {
    sent.push(t);
  };

  const r = await runTick({
    rows: [rowMEBL],
    state: emptyState(),
    config: baseConfig,
    holidays: HOLIDAYS,
    send,
    clock: () => parseISO('2026-04-25'), // far out → NEW
  });

  await runTick({
    rows: [rowMEBL],
    state: r.state,
    config: baseConfig,
    holidays: HOLIDAYS,
    send,
    clock: () => parseISO('2026-05-09'), // 4 days from deadline → UPCOMING
  });

  assert.equal(sent.length, 2);
  assert.match(sent[1], /UPCOMING in 4 days/);
});

test('runTick fires URGENT when deadline is today', async () => {
  const sent = [];
  const send = async (t) => {
    sent.push(t);
  };

  const r = await runTick({
    rows: [rowMEBL],
    state: emptyState(),
    config: baseConfig,
    holidays: HOLIDAYS,
    send,
    clock: () => parseISO('2026-04-25'),
  });

  await runTick({
    rows: [rowMEBL],
    state: r.state,
    config: baseConfig,
    holidays: HOLIDAYS,
    send,
    clock: () => parseISO('2026-05-13'), // deadline day
  });

  assert.equal(sent.length, 2);
  assert.match(sent[1], /URGENT/);
  assert.match(sent[1], /TODAY/);
});

test('runTick send-failure leaves state unchanged so we retry next tick', async () => {
  const send = async () => {
    throw new Error('telegram unreachable');
  };
  const result = await runTick({
    rows: [rowMEBL],
    state: emptyState(),
    config: baseConfig,
    holidays: HOLIDAYS,
    send,
    clock: () => parseISO('2026-04-25'),
  });
  assert.equal(result.alerted, 0);
  // Row was registered as seen, but NEW alert was NOT recorded — so next
  // tick will retry it.
  const entry = result.state.seen['MEBL@2026-05-15'];
  assert.ok(entry);
  assert.deepEqual(entry.alertsSent, []);
});

test('formatAlert with price renders yield line', () => {
  const text = formatAlert(rowMEBL, 'NEW', '2026-05-13', 12, { price: 540 });
  assert.match(text, /Yield/);
  assert.match(text, /Rs 17\.5/);
  assert.match(text, /Rs 540/);
});

test('formatAlert without price omits yield line', () => {
  const text = formatAlert(rowMEBL, 'NEW', '2026-05-13', 12);
  assert.ok(!/Yield/.test(text));
});

test('formatAlert with bonus payout falls back to "Last price" only', () => {
  const bonus = { ...rowMEBL, payoutType: 'Bonus', payout: '20% B' };
  const text = formatAlert(bonus, 'NEW', '2026-05-13', 12, { price: 540 });
  assert.ok(!/Yield/.test(text));
  assert.match(text, /Last price/);
});

test('passesYieldFilter: under threshold → false', () => {
  // Rs 17.5 / Rs 1000 = 1.75% — under 5% threshold.
  assert.equal(passesYieldFilter(rowMEBL, 1000, 5), false);
});

test('passesYieldFilter: over threshold → true', () => {
  // Rs 17.5 / Rs 200 = 8.75% — over 5% threshold.
  assert.equal(passesYieldFilter(rowMEBL, 200, 5), true);
});

test('passesYieldFilter: no threshold → always true', () => {
  assert.equal(passesYieldFilter(rowMEBL, 1000, 0), true);
  assert.equal(passesYieldFilter(rowMEBL, 1000, undefined), true);
});

test('passesYieldFilter: missing price is permissive (do not silently drop)', () => {
  assert.equal(passesYieldFilter(rowMEBL, undefined, 5), true);
});

test('runTick suppresses alert and records kind when yield is below floor', async () => {
  const sent = [];
  const send = async (t) => sent.push(t);
  const result = await runTick({
    rows: [rowMEBL],
    state: emptyState(),
    config: { ...baseConfig, minYieldPercent: 10 },
    holidays: HOLIDAYS,
    send,
    prices: new Map([['MEBL', 1000]]), // yields 1.75%, far under 10%
    clock: () => parseISO('2026-04-25'),
  });
  assert.equal(sent.length, 0);
  assert.equal(result.alerted, 0);
  // We mark the kind as sent so we don't keep re-evaluating.
  const entry = result.state.seen['MEBL@2026-05-15'];
  assert.ok(entry.alertsSent.includes('NEW'));
});

test('runAnnouncementsTick fires DECLARED on first sight', async () => {
  const sent = [];
  const send = async (t) => sent.push(t);
  const announcements = [
    {
      symbol: 'MEBL',
      date: '2026-05-01',
      subject: 'Cash Dividend @ Rs. 17.50/share',
      category: 'dividend',
      payoutText: 'Rs. 17.50/share',
    },
  ];
  const result = await runAnnouncementsTick({
    announcements,
    state: emptyState(),
    config: { ...baseConfig, announcements: { enabled: true, types: ['dividend'] } },
    send,
    clock: () => parseISO('2026-05-01'),
  });
  assert.equal(result.alerted, 1);
  assert.match(sent[0], /DECLARED/);
  assert.match(sent[0], /\$MEBL/);
  const entry = result.state.seen['MEBL@announced:2026-05-01'];
  assert.ok(entry);
  assert.deepEqual(entry.alertsSent, ['DECLARED']);
});

test('runAnnouncementsTick filters non-watched symbols', async () => {
  const sent = [];
  const send = async (t) => sent.push(t);
  const announcements = [
    { symbol: 'MEBL', date: '2026-05-01', subject: 'div', category: 'dividend' },
    { symbol: 'NOTWATCHED', date: '2026-05-01', subject: 'div', category: 'dividend' },
  ];
  const result = await runAnnouncementsTick({
    announcements,
    state: emptyState(),
    config: { ...baseConfig, announcements: { enabled: true, types: ['dividend'] } },
    send,
    clock: () => parseISO('2026-05-01'),
  });
  assert.equal(result.alerted, 1);
  assert.match(sent[0], /\$MEBL/);
});

test('runAnnouncementsTick is idempotent across ticks', async () => {
  const sent = [];
  const send = async (t) => sent.push(t);
  const announcements = [
    { symbol: 'MEBL', date: '2026-05-01', subject: 'div', category: 'dividend' },
  ];
  let r = await runAnnouncementsTick({
    announcements,
    state: emptyState(),
    config: { ...baseConfig, announcements: { enabled: true, types: ['dividend'] } },
    send,
    clock: () => parseISO('2026-05-01'),
  });
  r = await runAnnouncementsTick({
    announcements,
    state: r.state,
    config: { ...baseConfig, announcements: { enabled: true, types: ['dividend'] } },
    send,
    clock: () => parseISO('2026-05-02'),
  });
  assert.equal(sent.length, 1);
  assert.equal(r.alerted, 0);
});

test('markBackfilled records every watched row as already-NEW-alerted', () => {
  const result = markBackfilled({
    rows: [rowMEBL, rowFFC],
    state: emptyState(),
    config: { ...baseConfig, watchAll: true },
    clock: () => parseISO('2026-04-25'),
  });
  assert.equal(result.recorded, 2);
  assert.deepEqual(result.state.seen['MEBL@2026-05-15'].alertsSent, ['NEW']);
  assert.deepEqual(result.state.seen['FFC@2026-06-01'].alertsSent, ['NEW']);
});

test('markBackfilled respects watchlist filter', () => {
  const result = markBackfilled({
    rows: [rowMEBL, rowFFC],
    state: emptyState(),
    config: baseConfig, // watchlist: ["MEBL"]
    clock: () => parseISO('2026-04-25'),
  });
  assert.equal(result.recorded, 1);
  assert.ok(result.state.seen['MEBL@2026-05-15']);
  assert.ok(!result.state.seen['FFC@2026-06-01']);
});

test('after backfill, NEW does not fire but UPCOMING still does', async () => {
  const backfill = markBackfilled({
    rows: [rowMEBL],
    state: emptyState(),
    config: baseConfig,
    clock: () => parseISO('2026-04-25'),
  });

  const sent = [];
  const send = async (t) => sent.push(t);

  // Same day — nothing should fire.
  let r = await runTick({
    rows: [rowMEBL],
    state: backfill.state,
    config: baseConfig,
    holidays: HOLIDAYS,
    send,
    clock: () => parseISO('2026-04-25'),
  });
  assert.equal(r.alerted, 0);

  // Later, inside lead window — UPCOMING should fire.
  r = await runTick({
    rows: [rowMEBL],
    state: r.state,
    config: baseConfig,
    holidays: HOLIDAYS,
    send,
    clock: () => parseISO('2026-05-09'),
  });
  assert.equal(r.alerted, 1);
  assert.match(sent[0], /UPCOMING/);
});
