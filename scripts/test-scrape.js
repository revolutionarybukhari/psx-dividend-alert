// Run the scraper once and print the parsed rows. Useful as a smoke test
// after a PSX page redesign breaks our header heuristics.

import { scrapePayouts } from '../src/scraper.js';

const rows = await scrapePayouts();
console.log(`Scraped ${rows.length} payout rows.\n`);
for (const r of rows.slice(0, 25)) {
  console.log(
    [
      r.symbol.padEnd(8),
      r.payoutType.padEnd(20),
      r.payout.padEnd(14),
      `BC ${r.bcFrom} → ${r.bcTo}`,
      r.company,
    ].join('  ')
  );
}
if (rows.length > 25) console.log(`\n…and ${rows.length - 25} more.`);
