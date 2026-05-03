// Pure classification logic — no I/O, fully testable.
// Given a scraped row plus prior state, decide whether to alert and what kind.

import { daysBetween, parseISO, subtractTradingDays, formatISO } from './trading-calendar.js';

/**
 * @typedef {object} PayoutRow
 * @property {string} symbol         e.g. "MEBL"
 * @property {string} company        e.g. "Meezan Bank Limited"
 * @property {string} payoutType     "Cash Dividend" | "Bonus" | "Right" | etc.
 * @property {string} payout         Raw text e.g. "175%" or "Rs 17.50/sh"
 * @property {string} bcFrom         ISO date YYYY-MM-DD
 * @property {string} bcTo           ISO date YYYY-MM-DD
 * @property {string} [announced]    ISO date if available
 */

/**
 * @typedef {object} SeenEntry
 * @property {string} firstSeen      ISO date row first appeared
 * @property {string[]} alertsSent   List of alert kinds already dispatched
 */

/**
 * @typedef {object} State
 * @property {Record<string, SeenEntry>} seen   Keyed by row fingerprint
 */

/**
 * @typedef {('NEW'|'UPCOMING'|'URGENT'|'PASSED'|null)} AlertKind
 */

/**
 * @typedef {object} Decision
 * @property {AlertKind} kind
 * @property {string} fingerprint
 * @property {string} buyDeadline       ISO date — T-2 trading days before bcFrom
 * @property {number} daysToDeadline    Calendar days; negative means passed
 */

/**
 * Stable identifier for a row across polls. Symbol + bcFrom is enough to
 * dedupe, since a company rarely runs two payouts with the same opening BC.
 * @param {PayoutRow} row
 */
export function fingerprint(row) {
  return `${row.symbol.toUpperCase()}@${row.bcFrom}`;
}

/**
 * @param {PayoutRow} row
 * @param {Set<string>} holidays
 * @returns {string}                    ISO date
 */
export function buyDeadlineFor(row, holidays) {
  const bcFrom = parseISO(row.bcFrom);
  // PSX is T+2 settlement: a trade on day D settles on D+2 trading days.
  // To be on the share register before BC opens, you must trade on or
  // before bcFrom - 2 trading days.
  const deadline = subtractTradingDays(bcFrom, 2, holidays);
  return formatISO(deadline);
}

/**
 * Decide whether `row` warrants an alert given prior state and lead time.
 *
 * Rules:
 *   - First time we see a row → NEW
 *   - Buy deadline today/tomorrow and not yet alerted as URGENT → URGENT
 *   - Buy deadline within `leadTimeDays` and not yet alerted as UPCOMING → UPCOMING
 *   - Buy deadline already passed and not yet alerted as PASSED → PASSED
 *   - Otherwise → null (no alert)
 *
 * @param {PayoutRow} row
 * @param {State} state
 * @param {object} opts
 * @param {number} opts.leadTimeDays
 * @param {Date} opts.now
 * @param {Set<string>} opts.holidays
 * @returns {Decision}
 */
export function classify(row, state, opts) {
  const fp = fingerprint(row);
  const buyDeadline = buyDeadlineFor(row, opts.holidays);
  const deadlineDate = parseISO(buyDeadline);
  const todayMid = new Date(
    Date.UTC(opts.now.getUTCFullYear(), opts.now.getUTCMonth(), opts.now.getUTCDate())
  );
  const daysToDeadline = daysBetween(todayMid, deadlineDate);

  const seen = state.seen[fp];
  const alerted = new Set(seen?.alertsSent ?? []);

  /** @type {AlertKind} */
  let kind = null;

  if (!seen) {
    kind = 'NEW';
  } else if (daysToDeadline < 0 && !alerted.has('PASSED')) {
    kind = 'PASSED';
  } else if (daysToDeadline >= 0 && daysToDeadline <= 1 && !alerted.has('URGENT')) {
    kind = 'URGENT';
  } else if (
    daysToDeadline > 1 &&
    daysToDeadline <= opts.leadTimeDays &&
    !alerted.has('UPCOMING')
  ) {
    kind = 'UPCOMING';
  }

  return { kind, fingerprint: fp, buyDeadline, daysToDeadline };
}
