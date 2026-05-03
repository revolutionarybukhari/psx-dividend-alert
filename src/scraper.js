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

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * @typedef {import('./classifier.js').PayoutRow} PayoutRow
 */

/**
 * Convert "01-Jun-2026", "1 Jun 2026", "2026-06-01", or "01/06/2026" to ISO.
 * Returns null if the input doesn't look like a date.
 * @param {string} raw
 * @returns {string|null}
 */
export function normalizeDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const months = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };

  // 01-Jun-2026 / 1 Jun 2026 / 01/Jun/2026
  const m1 = s.match(/^(\d{1,2})[-\s/](\w{3})[-\s/](\d{4})$/i);
  if (m1) {
    const [, dd, mon, yyyy] = m1;
    const mm = months[mon.toLowerCase()];
    if (mm) return `${yyyy}-${String(mm).padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  // 01/06/2026 — assume DD/MM/YYYY (PSX is local format).
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const [, dd, mm, yyyy] = m2;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  return null;
}

/**
 * Launch a Puppeteer browser with sensible defaults for a long-running
 * scraper (small footprint, no GPU, reasonable timeouts).
 */
export async function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
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
 * Same shape, for the announcements feed (BoD-meeting dividend
 * declarations that haven't yet appeared in the payouts table).
 *
 * @param {object} [opts]
 * @returns {Promise<Array<Record<string, string>>>}
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
      const target = document.querySelector('table');
      if (!target) return { headers: [], rows: [] };
      const headers = Array.from(target.querySelectorAll('thead th')).map((th) =>
        th.textContent.trim().toLowerCase()
      );
      const rows = Array.from(target.querySelectorAll('tbody tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim())
      );
      return { headers, rows };
    });

    return raw.rows.map((cells) => {
      /** @type {Record<string, string>} */
      const obj = {};
      raw.headers.forEach((h, i) => {
        obj[h] = cells[i] ?? '';
      });
      return obj;
    });
  } finally {
    await page.close();
    if (ownsBrowser) await browser.close();
  }
}

/**
 * Map the raw header-keyed cells into our PayoutRow shape.
 * Tolerant of small column-name drift (PSX has changed it before).
 *
 * @param {{ headers: string[], rows: string[][] }} raw
 * @returns {PayoutRow[]}
 */
export function mapRows(raw) {
  const idx = (...names) => {
    for (const n of names) {
      const i = raw.headers.findIndex((h) => h.includes(n));
      if (i !== -1) return i;
    }
    return -1;
  };

  const iSym = idx('symbol');
  const iCo = idx('company', 'name');
  const iType = idx('type');
  const iAmt = idx('payout', 'dividend', 'amount');
  const iBcFrom = idx('bc from', 'book closure from', 'from');
  const iBcTo = idx('bc to', 'book closure to', 'to');
  const iAnn = idx('announced', 'announcement', 'date');

  /** @type {PayoutRow[]} */
  const out = [];
  for (const cells of raw.rows) {
    const symbol = cells[iSym]?.trim();
    if (!symbol) continue;

    const bcFromISO = normalizeDate(cells[iBcFrom] ?? '');
    if (!bcFromISO) {
      logger.warn({ symbol, raw: cells[iBcFrom] }, 'skipping row: unparseable BC From');
      continue;
    }

    out.push({
      symbol: symbol.toUpperCase(),
      company: cells[iCo]?.trim() ?? '',
      payoutType: cells[iType]?.trim() ?? '',
      payout: cells[iAmt]?.trim() ?? '',
      bcFrom: bcFromISO,
      bcTo: normalizeDate(cells[iBcTo] ?? '') ?? bcFromISO,
      announced: normalizeDate(cells[iAnn] ?? '') ?? '',
    });
  }
  return out;
}
