# Changelog

All notable changes to this project will be documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **`DECLARED` alert kind** — opt-in scraper for the [PSX announcements feed](https://dps.psx.com.pk/announcements/companies). Fires the moment a BoD-meeting outcome appears, so you get a heads-up before the row even hits the payouts table. Configure via `announcements.enabled` and `announcements.types`.
- **Live prices + yield line** — opt-in lookup against `dps.psx.com.pk/market-watch`. When `priceLookup: true`, every alert message includes a yield estimate computed from the announced amount and last-trade price.
- **`minYieldPercent` filter** — suppress payout alerts whose computed yield is below this threshold. Requires `priceLookup: true` (we need a price to compute the yield against).
- **`--backfill` flag** — `node src/index.js --backfill` registers every payout currently on the table as already-seen and exits, so `NEW` alerts only fire for payouts added afterwards. `UPCOMING` / `URGENT` / `PASSED` still fire as their deadlines arrive.
- **`--once` flag** — single-tick mode for cron / one-shot scripting.
- New modules: `src/prices.js` (yield math, formatters), `src/announcements.js` (`DECLARED` classifier and filters).
- New scraper exports: `scrapePrices`, `scrapeRecentAnnouncements` (now returns a typed shape with category + payout-text extraction), `mapPrices`, `mapAnnouncements`, `parsePrice`, `categorizeAnnouncement`, `extractPayoutText`.
- 44 additional unit tests covering price parsing, yield math, the announcement classifier, the yield filter, the announcements tick, and the backfill helper. Total now 86.

### Updated
- README — three-feed overview at the top, configuration table covers new fields, alert preview shows the yield line and a `DECLARED` example, FAQ rewritten to keep the live-vs-historic-archive distinction crisp.
- `config.example.json` — includes the new opt-in fields with safe defaults.

## [0.1.0] — 2026-05-03

Initial public release.

### Added
- Puppeteer scraper for `dps.psx.com.pk/payouts` with tolerant column mapping.
- Trading-day calendar with PSX holiday support and T+2 buy-deadline math.
- Classifier with four alert kinds: `NEW`, `UPCOMING`, `URGENT`, `PASSED`.
- Telegram dispatcher with HTML formatting and per-row deduplication.
- Atomic JSON state persistence (`state.json`).
- `npm run test-scrape` and `npm run test-telegram` smoke scripts.
- PM2 ecosystem config and a multi-stage Dockerfile.
- Unit tests for the classifier, calendar, scraper parser, state, and alerter.
- GitHub Actions CI on Node 20 / 22 across Linux / macOS.
