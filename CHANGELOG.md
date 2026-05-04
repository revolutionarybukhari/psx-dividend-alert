# Changelog

All notable changes to this project will be documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [SemVer](https://semver.org/).

## [Unreleased]

### Added
- README FAQ — covers historic-data scope, "buy/sell" signal expectations, and non-PSX market portability.
- Roadmap entry for a `--backfill` flag that records everything currently visible on the payouts table on first run.

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
