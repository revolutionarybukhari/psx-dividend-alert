# Changelog

All notable changes to this project will be documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [SemVer](https://semver.org/).

## [Unreleased]

### Changed
- **Puppeteer bumped to ^24.0.0** (was ^23.0.0). The `headless: 'new'` literal was removed in v24 — `true` now means new-headless-mode and `'shell'` means the legacy mode. Updated [`src/scraper.js`](src/scraper.js) accordingly. Verified end-to-end with a live scrape against `dps.psx.com.pk/payouts`.
- **ESLint bumped to ^10.0.1** (was ^9.0.0). Two new rules surfaced real issues that we fixed: `preserve-caught-error` (the JSON-parse re-throw in [`src/config.js`](src/config.js) now passes `{ cause: err }` so the original error isn't lost) and `no-useless-assignment` (two genuinely-unused reassignments in [`tests/alerter.test.js`](tests/alerter.test.js)).
- **pino bumped to ^10.3.1** (was ^9.0.0). No code change required — our usage is just `pino({ level, transport })`, which is unchanged across the major.
- **pino-pretty bumped to ^13.1.3** (was ^11.0.0). Dev-only logger; pretty-print output verified.
- GitHub Actions bumped: `actions/checkout@v4 → v6`, `actions/setup-node@v4 → v6`, `softprops/action-gh-release@v2 → v3` (via Dependabot PRs #1, #2, #3). Removes the deprecation warnings the runner was emitting.

### Fixed
- **Scraper now matches the live PSX layout.** The initial release shipped with column names that didn't match what `dps.psx.com.pk/payouts` actually serves — `Dividend Announcement` (combined amount + type) and `Book Closure Date` (combined `from - to` cell), plus an announcement date in `March 6, 2026 2:00 PM` format. The parser now handles all of those, and 24 of 25 live rows parse on the first try (the one skip is a row whose BC cell is just `"-"`, which is the right thing to skip).
- New helpers `parseBookClosureRange` and `inferPayoutType` (Final / Interim / Cash Dividend / Bonus / Right Shares — including `(ii)` / `(iii)` for 2nd/3rd interim).
- `parsePayoutAmount` now also rejects PSX's `(B)` / `(R)` suffixes so bonus and right rows don't accidentally compute a fake yield.
- Backward-compatible: legacy `BC From` / `BC To` / `Type` column layouts still parse, so existing fixtures and tests didn't need to change.
- 15 new unit tests covering the discovered formats. Total now 101.

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
