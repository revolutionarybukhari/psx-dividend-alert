// Trading-day math for PSX. PSX trades Mon–Fri and observes a published
// holiday calendar. Buy-deadline computation needs T-2 trading days.

/**
 * @typedef {string} ISODate  YYYY-MM-DD
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse YYYY-MM-DD as a UTC date so day-of-week math is deterministic
 * across timezones (Karachi is UTC+5; we don't want DST surprises).
 * @param {ISODate} iso
 * @returns {Date}
 */
export function parseISO(iso) {
  if (!iso || typeof iso !== 'string') {
    throw new TypeError(`parseISO: expected YYYY-MM-DD, got ${iso}`);
  }
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) {
    throw new TypeError(`parseISO: invalid YYYY-MM-DD: ${iso}`);
  }
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * @param {Date} date
 * @returns {ISODate}
 */
export function formatISO(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * @param {Date} date
 * @returns {boolean}
 */
export function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * @param {Date} date
 * @param {Set<ISODate>} holidays
 * @returns {boolean}
 */
export function isTradingDay(date, holidays) {
  return !isWeekend(date) && !holidays.has(formatISO(date));
}

/**
 * Step backward by N trading days, skipping weekends and holidays.
 * @param {Date} from
 * @param {number} n
 * @param {Set<ISODate>} holidays
 * @returns {Date}
 */
export function subtractTradingDays(from, n, holidays) {
  let d = new Date(from.getTime());
  let stepped = 0;
  while (stepped < n) {
    d = new Date(d.getTime() - ONE_DAY_MS);
    if (isTradingDay(d, holidays)) stepped += 1;
  }
  return d;
}

/**
 * Whole calendar days between two dates. Negative if `to` is before `from`.
 * @param {Date} from
 * @param {Date} to
 * @returns {number}
 */
export function daysBetween(from, to) {
  return Math.round((to.getTime() - from.getTime()) / ONE_DAY_MS);
}

/**
 * Today as a UTC date (midnight). Accepts an injected clock for tests.
 * @param {() => Date} [clock]
 * @returns {Date}
 */
export function today(clock = () => new Date()) {
  const now = clock();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// PSX publishes its annual trading-holiday calendar in December. The list
// below is a starting point — you can override it via `config.holidays` or
// edit this constant directly. With this empty, math still skips weekends.
//
// Source: https://www.psx.com.pk/psx/exchange/general/calendar-holidays
export const PSX_TRADING_HOLIDAYS_2026 = new Set([
  '2026-02-05', // Kashmir Day
  '2026-03-23', // Pakistan Day
  '2026-04-01', // Eid-ul-Fitr (1st day)
  '2026-04-02', // Eid-ul-Fitr (2nd day)
  '2026-04-03', // Eid-ul-Fitr (3rd day)
  '2026-05-01', // Labour Day
  '2026-05-27', // Eid-ul-Adha (1st day)
  '2026-05-28', // Eid-ul-Adha (2nd day)
  '2026-05-29', // Eid-ul-Adha (3rd day)
  '2026-06-17', // Ashura (9th Muharram)
  '2026-06-18', // Ashura (10th Muharram)
  '2026-08-14', // Independence Day
  '2026-08-27', // Eid Milad-un-Nabi
  '2026-11-09', // Iqbal Day
  '2026-12-25', // Quaid-e-Azam's Birthday / Christmas
  '2026-12-31', // Bank Holiday (Year End)
]);
