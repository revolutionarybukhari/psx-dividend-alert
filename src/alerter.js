// Compose: scraped rows + state → decisions → Telegram messages → new state.

import { classify, fingerprint } from './classifier.js';
import { recordAlert } from './state.js';
import { sendMessage, escapeHTML } from './telegram.js';
import { formatISO, today } from './trading-calendar.js';
import { logger } from './logger.js';

/**
 * @typedef {import('./classifier.js').PayoutRow} PayoutRow
 * @typedef {import('./classifier.js').State} State
 * @typedef {import('./classifier.js').AlertKind} AlertKind
 * @typedef {import('./config.js').Config} Config
 */

const KIND_PREFIX = {
  NEW: '🆕 NEW DIVIDEND',
  UPCOMING: '⏳ UPCOMING',
  URGENT: '⚠️ URGENT',
  PASSED: '⌛ PASSED',
};

/**
 * Render an alert message. Symbol-cashtagged so Telegram makes it tappable.
 *
 * @param {PayoutRow} row
 * @param {AlertKind} kind
 * @param {string} buyDeadlineISO
 * @param {number} daysToDeadline
 */
export function formatAlert(row, kind, buyDeadlineISO, daysToDeadline) {
  const sym = escapeHTML(row.symbol);
  const co = escapeHTML(row.company);
  const type = escapeHTML(row.payoutType || 'Payout');
  const amt = escapeHTML(row.payout || '—');
  const bcFrom = escapeHTML(row.bcFrom);
  const bcTo = escapeHTML(row.bcTo);
  const deadline = escapeHTML(buyDeadlineISO);

  const headline = (() => {
    if (kind === 'URGENT' && daysToDeadline === 0)
      return `${KIND_PREFIX.URGENT} — Buy <b>TODAY</b>`;
    if (kind === 'URGENT') return `${KIND_PREFIX.URGENT} — Buy by <b>tomorrow</b>`;
    if (kind === 'UPCOMING') return `${KIND_PREFIX.UPCOMING} in ${daysToDeadline} days`;
    if (kind === 'PASSED') return `${KIND_PREFIX.PASSED} — buy deadline already gone`;
    return KIND_PREFIX.NEW;
  })();

  return [
    `<b>${headline} — $${sym}</b>`,
    co,
    '',
    `💰 <b>${type}:</b> ${amt}`,
    `📅 <b>Book Closure:</b> ${bcFrom} → ${bcTo}`,
    `⏰ <b>Buy Deadline:</b> ${deadline}` +
      (daysToDeadline >= 0
        ? ` (${daysToDeadline === 0 ? 'today' : daysToDeadline === 1 ? 'tomorrow' : `in ${daysToDeadline} days`})`
        : ' (passed)'),
    '',
    `<a href="https://dps.psx.com.pk/company/${sym}">dps.psx.com.pk/company/${sym}</a>`,
  ].join('\n');
}

/**
 * Filter to symbols the user actually cares about.
 *
 * @param {PayoutRow[]} rows
 * @param {Config} cfg
 */
export function applyWatchlist(rows, cfg) {
  if (cfg.watchAll) return rows;
  const set = new Set(cfg.watchlist.map((s) => s.toUpperCase()));
  return rows.filter((r) => set.has(r.symbol));
}

/**
 * Single tick of the alert pipeline. Pure-ish: I/O is pushed to the edges
 * via injected `send` and `now`, so this is straightforward to test.
 *
 * @param {object} params
 * @param {PayoutRow[]} params.rows
 * @param {State} params.state
 * @param {Config} params.config
 * @param {Set<string>} params.holidays
 * @param {(text: string) => Promise<void>} params.send
 * @param {() => Date} [params.clock]
 * @returns {Promise<{ state: State, alerted: number }>}
 */
export async function runTick({ rows, state, config, holidays, send, clock }) {
  const now = (clock ?? (() => new Date()))();
  const todayISO = formatISO(today(() => now));

  const watched = applyWatchlist(rows, config);
  let next = state;
  let alerted = 0;

  for (const row of watched) {
    /** @type {import('./classifier.js').Decision} */
    let decision;
    try {
      decision = classify(row, next, {
        leadTimeDays: config.leadTimeDays,
        now,
        holidays,
      });
    } catch (err) {
      logger.warn({ err: err.message, row }, 'classify failed; skipping');
      continue;
    }

    // Even if no alert this tick, record that we've now seen the row so a
    // second pass (e.g. operator manually retrying) doesn't fire NEW twice.
    if (!next.seen[decision.fingerprint]) {
      next = recordAlert(next, decision.fingerprint, '__seen__', todayISO);
      // strip the bookkeeping marker so it doesn't dedupe a real alert
      const entry = next.seen[decision.fingerprint];
      entry.alertsSent = entry.alertsSent.filter((k) => k !== '__seen__');
    }

    if (!decision.kind) continue;

    const text = formatAlert(row, decision.kind, decision.buyDeadline, decision.daysToDeadline);
    try {
      await send(text);
      alerted += 1;
      next = recordAlert(next, decision.fingerprint, decision.kind, todayISO);
      logger.info({ symbol: row.symbol, kind: decision.kind }, 'alert sent');
    } catch (err) {
      logger.error({ err: err.message, symbol: row.symbol }, 'alert send failed');
    }
  }

  return { state: next, alerted };
}

/**
 * Convenience wrapper that builds the `send` closure from config.
 *
 * @param {Config} config
 */
export function telegramSender(config) {
  return (text) => sendMessage(config.telegram.botToken, config.telegram.chatId, text);
}

/**
 * Make sure the fingerprint helper is exported alongside the runner so
 * downstream tools (status pages, dashboards, manual scripts) can dedupe
 * the same way the alerter does.
 */
export { fingerprint };
