# Architecture

Short version: this is a single-process polling loop that turns a public HTML table into Telegram messages, with a flat-file state store keeping the alerts deduplicated.

```
                             ┌──────────────────────┐
                             │ dps.psx.com.pk/payouts│
                             └──────────┬───────────┘
                                        │ HTML
                                        ▼
   ┌──────────────────────┐    ┌──────────────────────┐
   │   trading-calendar   │◀───│       scraper        │  Puppeteer + tolerant
   │  (T+2, holidays)     │    │  (mapRows / parse)   │  header mapping
   └──────────┬───────────┘    └──────────┬───────────┘
              │ buy deadline              │ PayoutRow[]
              ▼                           ▼
   ┌──────────────────────────────────────────────────┐
   │                   classifier                      │  pure function
   │   row + state + leadTime + today  →  AlertKind    │
   └──────────────────────┬───────────────────────────┘
                          │ Decision
                          ▼
   ┌──────────────────────────────────────────────────┐
   │                    alerter                        │
   │  formats message, dispatches to Telegram,         │
   │  records the alert in state                       │
   └──────────────┬───────────────────────────┬───────┘
                  │                           │
                  ▼                           ▼
        ┌──────────────────┐       ┌──────────────────┐
        │   Telegram API   │       │   state.json     │  atomic write
        └──────────────────┘       └──────────────────┘
```

## File layout

| Path                       | What lives there                                                 |
| -------------------------- | ---------------------------------------------------------------- |
| `src/index.js`             | Entry point — config load, polling loop, signal handling         |
| `src/scraper.js`           | Puppeteer scraper, header normalization, date parsing            |
| `src/trading-calendar.js`  | Day-of-week + holiday math; `subtractTradingDays` for T+2        |
| `src/classifier.js`        | Pure decision function: row + state → alert kind                 |
| `src/alerter.js`           | Composes classifier + state + Telegram per tick                  |
| `src/state.js`             | Atomic JSON read/write of `state.json`                           |
| `src/telegram.js`          | One-call HTTP client (no SDK)                                    |
| `src/config.js`            | Validates `config.json`, fails loud on bad keys                  |
| `src/logger.js`            | Pino if installed, else `console`                                |
| `scripts/test-scrape.js`   | One-shot scrape, prints to stdout                                |
| `scripts/test-telegram.js` | One-shot "is the bot wired up" message                           |
| `tests/*.test.js`          | `node:test` unit tests — no network                              |

## Data flow per tick

1. Load `state.json` (or seed empty).
2. Run the scraper → array of `PayoutRow`.
3. Filter by `watchlist` unless `watchAll: true`.
4. For each row, call `classify(row, state, opts)`:
   - First sight → `NEW`.
   - Deadline already passed and we haven't sent `PASSED` yet → `PASSED`.
   - Deadline today/tomorrow and we haven't sent `URGENT` yet → `URGENT`.
   - Deadline within `leadTimeDays` and we haven't sent `UPCOMING` yet → `UPCOMING`.
   - Otherwise → `null` (no alert).
5. For every non-null decision, format the message, send to Telegram, record the alert in state.
6. Atomically write the new state to `state.json`.

## Buy deadline

The most non-obvious bit. PSX settles T+2: a trade on day D settles into the share register on D+2 trading days. To be on the register before book closure begins (so you're entitled to the dividend), you must trade on or before `bcFrom − 2 trading days`.

`subtractTradingDays` walks backward day by day, skipping weekends and any dates listed in `PSX_TRADING_HOLIDAYS_2026` or `config.holidays`. So:

- `bcFrom = Mon 2026-05-18`, no holidays → buy deadline `Thu 2026-05-14`
- `bcFrom = Mon 2026-05-18`, Friday is a holiday → buy deadline `Wed 2026-05-13`
- `bcFrom = Fri 2026-05-15`, no holidays → buy deadline `Wed 2026-05-13`

## Why a flat file for state

This is a single-process tool. SQLite would be overkill and any networked store would be a foot-gun on home VPSes. The atomic-write trick (`state.json.tmp` then `rename`) gives us crash-safety without a dependency.

If you outgrow the flat file (running this for many users in one process), swap `src/state.js` for whatever store you want — the only callers are `loadState`, `saveState`, and `recordAlert`.

## What we deliberately don't do

- **No private market data.** Everything we read is on a public page. PSX's licensing terms still apply, but we're not bypassing any login.
- **No execution.** Friction with brokers is high in PK and the risk of a misfire is much higher than the upside.
- **No multi-user web UI.** Every user runs their own bot. Centralizing creates a redistribution problem under the PSX data license.
- **No price scraping by default.** The yield filter is a roadmap item; it requires a second scrape and is best left opt-in.
