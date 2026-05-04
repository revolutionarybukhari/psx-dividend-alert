// DECLARED-kind alerts for BoD-meeting announcements that haven't yet
// shown up on the payouts table. Same state file, separate fingerprint
// namespace so the payouts classifier and this one don't collide.

import { escapeHTML } from './telegram.js';

/**
 * @typedef {import('./scraper.js').Announcement} Announcement
 * @typedef {import('./classifier.js').State} State
 */

/**
 * Stable identifier for an announcement. Keyed by date-of-announcement so
 * the same company posting two payouts on the same day will collide — that
 * happens approximately never, and missing one alert is preferable to
 * spamming on every text reformatting.
 *
 * @param {Announcement} ann
 */
export function fingerprintAnnouncement(ann) {
  return `${ann.symbol}@announced:${ann.date}`;
}

/**
 * @param {Announcement} ann
 * @param {State} state
 * @returns {{ kind: 'DECLARED' | null, fingerprint: string }}
 */
export function classifyAnnouncement(ann, state) {
  const fp = fingerprintAnnouncement(ann);
  const seen = state.seen[fp];
  const alerted = new Set(seen?.alertsSent ?? []);
  if (!seen || !alerted.has('DECLARED')) {
    return { kind: 'DECLARED', fingerprint: fp };
  }
  return { kind: null, fingerprint: fp };
}

/**
 * @param {Announcement} ann
 */
export function formatAnnouncementAlert(ann) {
  const sym = escapeHTML(ann.symbol);
  const date = escapeHTML(ann.date);
  const subject = escapeHTML(ann.subject);
  const payout = ann.payoutText ? `\n💰 <b>Detected:</b> ${escapeHTML(ann.payoutText)}` : '';
  const link = ann.attachmentUrl
    ? `\n\n<a href="${escapeHTML(ann.attachmentUrl)}">PDF announcement</a>`
    : '';

  return [
    `<b>🔔 DECLARED — $${sym}</b>`,
    `BoD-meeting outcome on <b>${date}</b>`,
    '',
    subject + payout,
    `\n<i>Watch for the book-closure dates to land on the payouts table.</i>${link}`,
  ].join('\n');
}

/**
 * Filter announcements down to:
 *   - symbols in the watchlist (or all, if watchAll)
 *   - categories the user opted into (default: dividend + bonus + right)
 *
 * @param {Announcement[]} list
 * @param {object} cfg
 * @param {string[]} cfg.watchlist
 * @param {boolean} cfg.watchAll
 * @param {string[]} cfg.types         e.g. ["dividend", "bonus", "right"]
 * @returns {Announcement[]}
 */
export function applyAnnouncementFilters(list, cfg) {
  const types = new Set((cfg.types ?? ['dividend', 'bonus', 'right']).map((t) => t.toLowerCase()));
  const symbols = cfg.watchAll ? null : new Set(cfg.watchlist.map((s) => s.toUpperCase()));
  return list.filter((a) => {
    if (!types.has(a.category)) return false;
    if (symbols && !symbols.has(a.symbol)) return false;
    return true;
  });
}
