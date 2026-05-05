// Scrape the PSX Data Portal payouts table.
//
// dps.psx.com.pk/payouts is server-rendered HTML, so we don't strictly
// need a headless browser — but the page sometimes uses client-side
// hydration to populate cells, and Cloudflare occasionally challenges
// non-browser UAs. Puppeteer keeps us robust against both.

import puppeteer from 'puppeteer';
import { logger } from './logger.js';

const PAYOUTS_URL = 'https://dps.psx.com.pk/payouts';
const ANNOUNCEMENTS_URL = 'https://dps.psx.com.pk/announcements/companies';
const MARKET_WATCH_URL = 'https://dps.psx.com.pk/market-watch';

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * @typedef {import('./classifier.js').PayoutRow} PayoutRow
 */

const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/**
 * Convert PSX date strings to ISO YYYY-MM-DD. Tolerant of:
 *   "2026-06-01"               (already ISO)
 *   "01-Jun-2026" / "1 Jun 26" / "01/Jun/2026"
 *   "01/06/2026"               (DD/MM/YYYY — PSX local format)
 *   "March 6, 2026"            (month-name-first, comma)
 *   "March 6, 2026 2:00 PM"    (with trailing time — stripped)
 *   "01/06/2026  - 30/06/2026" (range — first date wins; use parseBookClosureRange to get both)
 *
 * Returns null if nothing matches.
 *
 * @param {string} raw
 * @returns {string|null}
 */
export function normalizeDate(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // If it looks like a range (PSX BC column), take the first half.
  const dashSplit = s.split(/\s*[-–—]\s*/);
  if (dashSplit.length === 2 && dashSplit[0] && dashSplit[1]) s = dashSplit[0].trim();

  // Drop a trailing time suffix like "2:00 PM" or "14:30".
  s = s.replace(/\s+\d{1,2}:\d{2}(\s*[APap][Mm])?\s*$/, '').trim();

  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // 01-Jun-2026 / 1 Jun 2026 / 01/Jun/2026 (3-letter month between numbers)
  const m1 = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/](\d{4})$/);
  if (m1) {
    const [, dd, mon, yyyy] = m1;
    const mm = MONTHS[mon.toLowerCase()];
    if (mm) return `${yyyy}-${String(mm).padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  // 01/06/2026 — DD/MM/YYYY (PSX local format)
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const [, dd, mm, yyyy] = m2;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  // March 6, 2026  /  March 6 2026
  const m3 = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m3) {
    const [, mon, dd, yyyy] = m3;
    const mm = MONTHS[mon.toLowerCase()];
    if (mm) return `${yyyy}-${String(mm).padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  return null;
}

/**
 * Parse PSX's "Book Closure Date" cell, which is a single column holding
 * both endpoints separated by a dash:
 *
 *   "23/03/2026  - 30/03/2026"  → { from: '2026-03-23', to: '2026-03-30' }
 *   "23/03/2026"                → { from: '2026-03-23', to: '2026-03-23' }
 *
 * Returns null if neither side parses.
 *
 * @param {string} raw
 * @returns {{ from: string, to: string } | null}
 */
export function parseBookClosureRange(raw) {
  if (!raw) return null;
  const parts = String(raw)
    .split(/\s*[-–—]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const from = normalizeDate(parts[0]);
  if (!from) return null;
  const to = parts[1] ? (normalizeDate(parts[1]) ?? from) : from;
  return { from, to };
}

/**
 * Heuristic: pull a friendly payout type out of PSX's "Dividend Announcement"
 * cell. PSX appends suffixes like "(F)" / "(i)" / "(D)" / "(B)" / "(R)" to
 * indicate Final / interim / Dividend / Bonus / Right.
 *
 *   "17%(F) (D)"    → "Cash Dividend (Final)"
 *   "20%(i) (D)"    → "Cash Dividend (Interim)"
 *   "10%(B)"        → "Bonus"
 *   "25%(R)"        → "Right Shares"
 *   "Rs 5/sh (D)"   → "Cash Dividend"
 *
 * @param {string} text
 * @returns {string}
 */
export function inferPayoutType(text) {
  if (!text) return '';
  const s = String(text);
  const isFinal = /\([Ff](inal)?\)/.test(s);
  // PSX uses (i), (ii), (iii)... to denote 1st, 2nd, 3rd interim — all "Interim" for our purposes.
  const isInterim = /\([Ii]+(nterim)?\)/.test(s);
  if (/\([Bb]\)/.test(s) || /\bbonus\b/i.test(s)) return 'Bonus';
  if (/\([Rr]\)/.test(s) || /\bright\b/i.test(s)) return 'Right Shares';
  if (/\([Dd]\)/.test(s) || /dividend|payout/i.test(s)) {
    if (isFinal) return 'Cash Dividend (Final)';
    if (isInterim) return 'Cash Dividend (Interim)';
    return 'Cash Dividend';
  }
  return '';
}

/**
 * Launch a Puppeteer browser with sensible defaults for a long-running
 * scraper (small footprint, no GPU, reasonable timeouts).
 */
export async function launchBrowser() {
  return puppeteer.launch({
    // Puppeteer 24 removed the `'new'` literal — `true` now means the new
    // headless mode (the old/legacy mode is `'shell'`, which we don't want).
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
}

/**
 * Scrape the live payouts table.
 *
 * @param {object} [opts]
 * @param {import('puppeteer').Browser} [opts.browser]   Reuse an existing instance
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<PayoutRow[]>}
 */
export async function scrapePayouts(opts = {}) {
  const browser = opts.browser ?? (await launchBrowser());
  const ownsBrowser = !opts.browser;
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    logger.debug({ url: PAYOUTS_URL }, 'fetching payouts');
    await page.goto(PAYOUTS_URL, { waitUntil: 'networkidle2' });
    await page.waitForSelector('table', { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS });

    const raw = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      // Pick the table that contains the most rows — PSX has a small nav
      // table at the top on some renders, so "biggest table wins".
      const target = tables
        .map((t) => ({ t, rows: t.querySelectorAll('tbody tr').length }))
        .sort((a, b) => b.rows - a.rows)[0]?.t;
      if (!target) return { headers: [], rows: [] };

      const headers = Array.from(target.querySelectorAll('thead th')).map((th) =>
        th.textContent.trim().toLowerCase()
      );

      const rows = Array.from(target.querySelectorAll('tbody tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim())
      );

      return { headers, rows };
    });

    return mapRows(raw);
  } finally {
    await page.close();
    if (ownsBrowser) await browser.close();
  }
}

/**
 * @typedef {object} Announcement
 * @property {string} symbol
 * @property {string} date              ISO YYYY-MM-DD
 * @property {string} subject           Raw subject line as PSX shows it
 * @property {'dividend'|'bonus'|'right'|'other'} category
 * @property {string} [payoutText]      Extracted "175%" / "Rs 17.50/sh" if found
 * @property {string} [attachmentUrl]   PDF link if present
 */

/**
 * Scrape the announcements feed (BoD-meeting outcomes etc.) and parse into
 * a typed shape. We only normalize fields we can identify confidently;
 * everything else stays in `subject` for the user to read.
 *
 * @param {object} [opts]
 * @returns {Promise<Announcement[]>}
 */
export async function scrapeRecentAnnouncements(opts = {}) {
  const browser = opts.browser ?? (await launchBrowser());
  const ownsBrowser = !opts.browser;
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    await page.goto(ANNOUNCEMENTS_URL, { waitUntil: 'networkidle2' });
    await page.waitForSelector('table', { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS });

    const raw = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      const target = tables
        .map((t) => ({ t, rows: t.querySelectorAll('tbody tr').length }))
        .sort((a, b) => b.rows - a.rows)[0]?.t;
      if (!target) return { headers: [], rows: [] };

      const headers = Array.from(target.querySelectorAll('thead th')).map((th) =>
        th.textContent.trim().toLowerCase()
      );
      const rows = Array.from(target.querySelectorAll('tbody tr')).map((tr) => {
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim());
        // Try to find a PDF link in the row (PSX usually attaches one).
        const link = tr.querySelector('a[href$=".pdf"], a[href*="/download/"]');
        return { cells, attachmentUrl: link?.getAttribute('href') ?? '' };
      });
      return { headers, rows };
    });

    return mapAnnouncements(raw);
  } finally {
    await page.close();
    if (ownsBrowser) await browser.close();
  }
}

/**
 * Decide what category an announcement belongs to from its subject text.
 * Order matters: a "dividend & bonus" announcement counts as 'dividend'
 * because that's the alert path the user cares about more.
 *
 * @param {string} subject
 * @returns {'dividend'|'bonus'|'right'|'other'}
 */
export function categorizeAnnouncement(subject) {
  const s = (subject || '').toLowerCase();
  if (/\b(dividend|cash payout|interim payout|final payout)\b/.test(s)) return 'dividend';
  if (/\b(bonus|stock dividend)\b/.test(s)) return 'bonus';
  if (/\b(right shares?|rights? issue|right offer)\b/.test(s)) return 'right';
  return 'other';
}

/**
 * Pull a payout amount out of an announcement subject if one is there.
 *
 *   "Cash Dividend @ Rs. 17.50/share"  → "Rs 17.50/sh"
 *   "175% cash dividend"               → "175%"
 *
 * @param {string} subject
 * @returns {string | undefined}
 */
export function extractPayoutText(subject) {
  if (!subject) return undefined;
  const rs = subject.match(
    /(?:Rs\.?|PKR)\s*\d+(?:\.\d+)?(?:\s*\/\s*share|\s*per\s*share|\s*\/sh)?/i
  );
  if (rs) return rs[0].replace(/\s+/g, ' ').trim();
  const pct = subject.match(/\d+(?:\.\d+)?\s*%/);
  if (pct) return pct[0].replace(/\s+/g, '');
  return undefined;
}

/**
 * @param {{ headers: string[], rows: { cells: string[], attachmentUrl: string }[] }} raw
 * @returns {Announcement[]}
 */
export function mapAnnouncements(raw) {
  const idx = (...names) => {
    for (const n of names) {
      const i = raw.headers.findIndex((h) => h.includes(n));
      if (i !== -1) return i;
    }
    return -1;
  };

  const iSym = idx('symbol');
  const iDate = idx('date', 'announced');
  const iSubject = idx('subject', 'title', 'description');

  /** @type {Announcement[]} */
  const out = [];
  for (const { cells, attachmentUrl } of raw.rows) {
    const symbol = cells[iSym]?.trim();
    if (!symbol) continue;

    const dateISO = normalizeDate(cells[iDate] ?? '');
    if (!dateISO) continue;

    const subject = cells[iSubject]?.trim() ?? '';
    out.push({
      symbol: symbol.toUpperCase(),
      date: dateISO,
      subject,
      category: categorizeAnnouncement(subject),
      payoutText: extractPayoutText(subject),
      attachmentUrl: attachmentUrl || undefined,
    });
  }
  return out;
}

/**
 * Fetch live last-trade prices for the given symbols. Single page load
 * (market-watch) returns every symbol on PSX, then we filter to what we
 * need.
 *
 * @param {string[]} symbols
 * @param {object} [opts]
 * @returns {Promise<Map<string, number>>}
 */
export async function scrapePrices(symbols, opts = {}) {
  const wanted = new Set(symbols.map((s) => s.toUpperCase()));
  if (wanted.size === 0) return new Map();

  const browser = opts.browser ?? (await launchBrowser());
  const ownsBrowser = !opts.browser;
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    await page.goto(MARKET_WATCH_URL, { waitUntil: 'networkidle2' });
    await page.waitForSelector('table', { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS });

    const raw = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      const target = tables
        .map((t) => ({ t, rows: t.querySelectorAll('tbody tr').length }))
        .sort((a, b) => b.rows - a.rows)[0]?.t;
      if (!target) return { headers: [], rows: [] };
      const headers = Array.from(target.querySelectorAll('thead th')).map((th) =>
        th.textContent.trim().toLowerCase()
      );
      const rows = Array.from(target.querySelectorAll('tbody tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim())
      );
      return { headers, rows };
    });

    return mapPrices(raw, wanted);
  } finally {
    await page.close();
    if (ownsBrowser) await browser.close();
  }
}

/**
 * Pull symbol → last-trade price out of the market-watch table.
 *
 * @param {{ headers: string[], rows: string[][] }} raw
 * @param {Set<string>} wanted
 * @returns {Map<string, number>}
 */
export function mapPrices(raw, wanted) {
  const idx = (...names) => {
    for (const n of names) {
      const i = raw.headers.findIndex((h) => h.includes(n));
      if (i !== -1) return i;
    }
    return -1;
  };
  const iSym = idx('symbol');
  // PSX uses "current" / "last" / "ldcp" depending on the section.
  const iPrice = idx('current', 'last', 'price', 'close');

  /** @type {Map<string, number>} */
  const out = new Map();
  if (iSym === -1 || iPrice === -1) return out;

  for (const cells of raw.rows) {
    const sym = cells[iSym]?.trim().toUpperCase();
    if (!sym || !wanted.has(sym)) continue;
    const v = parsePrice(cells[iPrice] ?? '');
    if (v !== null) out.set(sym, v);
  }
  return out;
}

/**
 * Parse a price cell. PSX rows often have commas ("1,234.50") and
 * sometimes a percent-change in parens ("123.45 (1.2%)") which we strip.
 *
 * @param {string} text
 * @returns {number | null}
 */
export function parsePrice(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text
    .replace(/\(.*?\)/g, '')
    .replace(/,/g, '')
    .trim();
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Map the raw header-keyed cells into our PayoutRow shape.
 *
 * PSX's payouts table currently uses these columns:
 *   Symbol | Company | Sector | Dividend Announcement | Date / Time of Announcement | Book Closure Date
 *
 * The "Book Closure Date" cell holds the whole range in one string
 * ("23/03/2026  - 30/03/2026"), and "Dividend Announcement" combines
 * amount + type-suffix ("17%(F) (D)").
 *
 * The lookup is forgiving — we match header substrings, so prior layouts
 * with separate "BC From" / "BC To" / "Type" columns still work too.
 *
 * @param {{ headers: string[], rows: string[][] }} raw
 * @returns {PayoutRow[]}
 */
export function mapRows(raw) {
  const idx = (...names) => {
    for (const n of names) {
      const i = raw.headers.findIndex((h) => h.toLowerCase().includes(n.toLowerCase()));
      if (i !== -1) return i;
    }
    return -1;
  };

  const iSym = idx('symbol');
  const iCo = idx('company', 'name');
  const iType = idx('type'); // legacy layouts only
  const iAmt = idx('dividend announcement', 'payout', 'dividend', 'amount');
  const iBcCombined = idx('book closure date', 'book closure');
  const iBcFrom = idx('bc from', 'book closure from');
  const iBcTo = idx('bc to', 'book closure to');
  const iAnn = idx('date / time', 'announced', 'announcement date');

  /** @type {PayoutRow[]} */
  const out = [];
  for (const cells of raw.rows) {
    const symbol = cells[iSym]?.trim();
    if (!symbol) continue;

    // Resolve BC range: prefer the combined cell, fall back to two columns.
    let bcFrom, bcTo;
    if (iBcCombined !== -1) {
      const range = parseBookClosureRange(cells[iBcCombined] ?? '');
      if (range) ({ from: bcFrom, to: bcTo } = range);
    }
    if (!bcFrom && iBcFrom !== -1) {
      bcFrom = normalizeDate(cells[iBcFrom] ?? '');
      bcTo = normalizeDate(cells[iBcTo] ?? '') ?? bcFrom;
    }
    if (!bcFrom) {
      logger.warn(
        { symbol, raw: cells[iBcCombined] ?? cells[iBcFrom] },
        'skipping row: unparseable book closure date'
      );
      continue;
    }

    const payoutText = cells[iAmt]?.trim() ?? '';
    const payoutType = cells[iType]?.trim() || inferPayoutType(payoutText);

    out.push({
      symbol: symbol.toUpperCase(),
      company: cells[iCo]?.trim() ?? '',
      payoutType,
      payout: payoutText,
      bcFrom,
      bcTo,
      announced: normalizeDate(cells[iAnn] ?? '') ?? '',
    });
  }
  return out;
}
