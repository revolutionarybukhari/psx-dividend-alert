// Live price + yield helpers.
//
// PSX face value is Rs 10 for ~all listed companies, so a "175%" cash
// dividend = Rs 17.50 per share. A "Rs 17.50/sh" string is already in
// rupees. We parse both shapes and combine with a current price (if we
// have one) to compute yield.
//
// Important: yield from these scrapes is informational only. Treat it
// the same way you'd treat the price tape on the PSX website — it's
// last-trade-as-shown, not real-time exchange data.

/**
 * Extract a per-share rupee amount from PSX payout text.
 *
 *   "175%"          → { perShare: 17.5,  type: 'percent', raw: 17.5 }
 *   "Rs 17.50/sh"   → { perShare: 17.5,  type: 'rupees',  raw: 17.5 }
 *   "Rs. 5/sh"      → { perShare: 5,     type: 'rupees',  raw: 5 }
 *   "20%B"          → null  (bonus issue — no cash, different math)
 *   "1R for 5"      → null  (right issue — out of scope here)
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.faceValue]   Default Rs 10 (true for ~all PSX stocks).
 * @returns {{ perShare: number, type: 'percent' | 'rupees', raw: number } | null}
 */
export function parsePayoutAmount(text, opts = {}) {
  if (!text || typeof text !== 'string') return null;
  const s = text.trim();
  if (!s) return null;

  // Bonus / right shares — explicitly not cash. Caller should skip yield.
  // PSX uses `(B)` / `(R)` suffixes; we also match plain words for robustness.
  if (/(bonus|right)/i.test(s)) return null;
  if (/\([BbRr]\)/.test(s)) return null;
  if (/^\d+%\s*B\b/i.test(s)) return null;

  const faceValue = opts.faceValue ?? 10;

  // "Rs 17.50/sh" / "Rs. 17.5 / share" / "PKR 17.50"
  const rs = s.match(/(?:Rs\.?|PKR)\s*(\d+(?:\.\d+)?)/i);
  if (rs) {
    const v = Number(rs[1]);
    if (Number.isFinite(v)) return { perShare: v, type: 'rupees', raw: v };
  }

  // "175%" or "175.5 %" — percent of face value
  const pct = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) {
    const v = Number(pct[1]);
    if (Number.isFinite(v)) return { perShare: (v / 100) * faceValue, type: 'percent', raw: v };
  }

  return null;
}

/**
 * Yield = dividend / price * 100. Returns null if either side is missing
 * or invalid (no negative yields, no division by zero).
 *
 * @param {number} dividendPerShare
 * @param {number} pricePerShare
 * @returns {number | null}
 */
export function computeYield(dividendPerShare, pricePerShare) {
  if (!Number.isFinite(dividendPerShare) || dividendPerShare <= 0) return null;
  if (!Number.isFinite(pricePerShare) || pricePerShare <= 0) return null;
  return (dividendPerShare / pricePerShare) * 100;
}

/**
 * Format a yield number for the alert message. Two decimals, trimmed.
 *   3.20  → "3.2%"
 *   3.05  → "3.05%"
 *   0.001 → "<0.01%"
 *
 * @param {number} pct
 * @returns {string}
 */
export function formatYield(pct) {
  if (!Number.isFinite(pct)) return '—';
  if (pct < 0.01) return '<0.01%';
  if (pct < 10) return `${pct.toFixed(2).replace(/\.?0+$/, '')}%`;
  return `${pct.toFixed(1).replace(/\.0$/, '')}%`;
}

/**
 * Format a rupee amount for display. Two decimals, no trailing zeros.
 *
 * @param {number} v
 */
export function formatRupees(v) {
  if (!Number.isFinite(v)) return '—';
  return `Rs ${v.toFixed(2).replace(/\.?0+$/, '')}`;
}
