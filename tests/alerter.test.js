import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyWatchlist, formatAlert, runTick } from '../src/alerter.js';
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

  let r = await runTick({
    rows: [rowMEBL],
    state: emptyState(),
    config: baseConfig,
    holidays: HOLIDAYS,
    send,
    clock: () => parseISO('2026-04-25'), // far out → NEW
  });

  r = await runTick({
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

  let r = await runTick({
    rows: [rowMEBL],
    state: emptyState(),
    config: baseConfig,
    holidays: HOLIDAYS,
    send,
    clock: () => parseISO('2026-04-25'),
  });

  r = await runTick({
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
