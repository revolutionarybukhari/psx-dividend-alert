<div align="center">

# 📈 PSX Dividend Alert

**Telegram alerts for Pakistan Stock Exchange dividends, BoD-meeting announcements, and yields — with a buy deadline that actually accounts for T+2 settlement and trading holidays.**

[![CI](https://github.com/your-username/psx-dividend-alert/actions/workflows/ci.yml/badge.svg)](https://github.com/your-username/psx-dividend-alert/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Stars](https://img.shields.io/github/stars/your-username/psx-dividend-alert?style=social)](https://github.com/your-username/psx-dividend-alert/stargazers)

[Quick start](#-quick-start) · [How it works](#-how-it-works) · [Configuration](#%EF%B8%8F-configuration) · [Deploy](#-deploy) · [FAQ](#-faq) · [Roadmap](#%EF%B8%8F-roadmap)

</div>

---

> If you've ever opened the PSX payouts page on a Friday evening, realised the book closure starts Monday, and done the maths in your head about whether you can still buy in — this is for you.

`psx-dividend-alert` watches three live PSX feeds — the [payouts table](https://dps.psx.com.pk/payouts), the [BoD-meeting announcements](https://dps.psx.com.pk/announcements/companies), and (optionally) the [market-watch prices](https://dps.psx.com.pk/market-watch) — and pings your Telegram **before the buy deadline**, not on the ex-dividend date when it's already too late.

It runs on a $5 VPS, a Raspberry Pi, or your laptop. Setup takes about 90 seconds.

## What an alert looks like

When a payout first appears (with the optional yield line if `priceLookup: true`):

```
🆕 NEW DIVIDEND — $MEBL
Meezan Bank Limited

💰 Cash Dividend: 175%
📈 Yield: ~3.24% (Rs 17.5 on Rs 540)
📅 Book Closure: 2026-05-15 → 2026-05-22
⏰ Buy Deadline: 2026-05-13 (in 10 days)

dps.psx.com.pk/company/MEBL
```

Four days before the deadline:

```
⏳ UPCOMING in 4 days — $MEBL
…
⏰ Buy Deadline: 2026-05-13 (in 4 days)
```

On the day:

```
⚠️ URGENT — Buy TODAY — $MEBL
…
⏰ Buy Deadline: 2026-05-13 (today)
```

And the earliest possible heads-up — straight from the BoD-meeting feed, before the row hits the payouts table at all:

```
🔔 DECLARED — $MEBL
BoD-meeting outcome on 2026-04-20

Cash Dividend @ Rs. 17.50/share
💰 Detected: Rs 17.50/share

Watch for the book-closure dates to land on the payouts table.
PDF announcement
```

No noise after that. The tool remembers what it's already alerted on and won't double-fire.

## ⚡ Quick start

```bash
git clone https://github.com/your-username/psx-dividend-alert.git
cd psx-dividend-alert
npm install
cp config.example.json config.json
# edit config.json with your bot token, chat id, and watchlist
npm start
```

That's it. Logs go to stdout; on a real deployment use [PM2](#pm2) or [Docker](#docker).

> **Already have rows on the payouts page?** Run `node src/index.js --backfill` once before `npm start`. The tool will register everything currently visible as already-seen so `NEW` alerts only fire for payouts added after that point. `UPCOMING` / `URGENT` / `PASSED` still fire normally as their deadlines arrive.

### Get a Telegram bot (60 seconds)

1. DM [@BotFather](https://t.me/BotFather) → `/newbot` → save the token it gives you.
2. DM your new bot once (any message).
3. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` — your `chat.id` is in there.
4. Paste both into `config.json`.
5. Run `npm run test-telegram` to confirm the wire is up.

## ⚠️ Read this before you treat dividends as free money

The single most common reason people lose money chasing dividends:

| What you pay attention to            | What actually moves your P&L                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| The dividend per share               | The price drop on the ex-dividend date is roughly equal to the dividend       |
| The dividend yield                   | Withholding tax — **15%** for active filers, **30%** for non-filers (PK)      |
| "Free Rs 17.50 per share"            | Brokerage on both legs of the trade                                           |
| The headline "175%"                  | That's % of face value (usually Rs 10), not of the price you pay              |

Pure dividend-capture trades — buy before BC, sell after — usually break even or lose to friction. **This tool isn't a money printer.** It's most useful when:

- You already wanted to own the stock and are optimising entry timing.
- You're tracking a portfolio you already hold and don't want to miss payouts.
- You want a heads-up before AGMs and book closures so you can decide deliberately.

If that's not you, save your money and your time. If it is, read on.

## 🧠 How it works

The non-obvious part is the **buy deadline**, not the alert plumbing.

PSX settles **T+2** — a trade on day `D` lands in the share register on `D + 2 trading days`. To be on the register on the day before book closure starts (which is the requirement for the dividend), you must trade on or before:

```
bcFrom − 2 trading days
```

…where "trading days" skips weekends *and* the PSX holiday calendar. So:

- `bcFrom = Mon 2026-05-18`, no holidays → buy by **Thu 2026-05-14**
- `bcFrom = Mon 2026-05-18`, Fri is Eid → buy by **Wed 2026-05-13**
- `bcFrom = Fri 2026-05-15`, no holidays → buy by **Wed 2026-05-13**

The tool computes this for every row, every poll, and decides whether you need an alert today.

```
                                ┌──────────────────────┐
                                │  PSX payouts table   │
                                └──────────┬───────────┘
                                           │
                              scraper + tolerant header mapping
                                           │
                                           ▼
   ┌──────────────────────────┐    ┌──────────────────────┐
   │   trading-calendar       │───▶│      classifier      │  pure function
   │  (T+2, holidays)         │    │  → NEW / UPCOMING /  │  fully tested
   │                          │    │    URGENT / PASSED   │
   └──────────────────────────┘    └──────────┬───────────┘
                                              │
                                              ▼
                                ┌──────────────────────────┐
                                │  Telegram + state.json   │
                                └──────────────────────────┘
```

The classifier is a pure function with [a dozen unit tests](tests/classifier.test.js). It doesn't care where the rows came from or where the alerts go — which makes the whole pipeline easy to extend (see [Extending](#-extending)).

For a deeper tour, read [`docs/architecture.md`](docs/architecture.md).

## 🛠️ Configuration

`config.json`:

| Field                          | Type            | Default                              | What it does                                                                                                |
| ------------------------------ | --------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `telegram.botToken`            | `string`        | —                                    | From `@BotFather`. **Required.**                                                                            |
| `telegram.chatId`              | `string \| int` | —                                    | Your Telegram chat id (user, group, or channel). **Required.**                                              |
| `watchlist`                    | `string[]`      | `[]`                                 | Symbols you care about, e.g. `["MEBL", "FFC", "OGDC"]`.                                                     |
| `watchAll`                     | `boolean`       | `false`                              | If `true`, alert on every PSX symbol — overrides `watchlist`.                                               |
| `leadTimeDays`                 | `number`        | `5`                                  | How many days before the buy deadline to fire `UPCOMING`.                                                   |
| `checkIntervalMinutes`         | `number`        | `60`                                 | How often to poll PSX. Don't go below 15 — be polite.                                                       |
| `stateFile`                    | `string`        | `./state.json`                       | Where to persist seen/alerted state. Resolved relative to `config.json`.                                    |
| `holidays`                     | `string[]`      | `[]`                                 | Extra trading holidays (`YYYY-MM-DD`), merged with the built-in list.                                       |
| `priceLookup`                  | `boolean`       | `false`                              | If `true`, fetch live last-trade prices and add a yield line to alerts.                                     |
| `minYieldPercent`              | `number`        | `0`                                  | Suppress payout alerts whose computed yield is below this (e.g. `5` for 5%). Requires `priceLookup: true`.  |
| `announcements.enabled`        | `boolean`       | `false`                              | If `true`, also poll the announcements feed and fire `DECLARED` alerts for BoD-meeting outcomes.            |
| `announcements.types`          | `string[]`      | `["dividend","bonus","right"]`       | Announcement categories to alert on.                                                                        |

The built-in holiday list lives in [`src/trading-calendar.js`](src/trading-calendar.js) (`PSX_TRADING_HOLIDAYS_2026`). It ships intentionally empty — PSX publishes the official calendar in December and you should drop in the real list when it does. Without it, the math just skips weekends, which is right ~50 weeks a year and wrong on Eid weeks.

### CLI flags

```
node src/index.js --backfill   # one-shot: register every visible row as already-seen, exit
node src/index.js --once       # run a single tick and exit (useful for cron)
node src/index.js --help
```

## 🚢 Deploy

### PM2

```bash
npm install
cp config.example.json config.json
# fill in config.json

pm2 start ecosystem.config.cjs
pm2 save
pm2 logs psx-dividend-alert
```

PM2 will auto-restart on crash (up to 10x with a 5s backoff) and recycle if memory passes 500MB. Logs land in `./logs/`.

### Docker

```bash
docker compose up -d
docker compose logs -f
```

The included [`Dockerfile`](Dockerfile) is multi-stage, runs as a non-root user, and uses Debian's Chromium so the image stays under 400MB. `docker-compose.yml` mounts your `config.json` read-only and persists state in a named volume.

If you'd rather use the Puppeteer-bundled Chromium, drop the `PUPPETEER_SKIP_DOWNLOAD` env var — at the cost of about 100MB of image size.

### Bare metal / Raspberry Pi

Anything with Node 20+ and ~200MB free. The polling loop is essentially idle between ticks; CPU usage during a scrape is whatever Chromium needs for ~10s.

## 🧪 Testing

```bash
# Unit tests — no network. Run these on every commit.
npm test

# One-shot scrape against the live PSX page. Prints what we found.
npm run test-scrape

# One canned message to the configured chat.
npm run test-telegram
```

The unit tests cover the classifier (alert-kind decisions, dedup), the trading-day calendar (weekend / holiday skip), the scraper parser (header drift, date formats), the state store (atomic write, dedup), and the alerter (end-to-end with an injected clock).

## 🧩 Extending

A few directions worth considering — issues and PRs welcome on any of them.

- **Watchlist via Telegram.** Add a webhook so you can `/watch FFC` and `/unwatch FFC` from your phone instead of editing `config.json`.
- **More adapters.** The Telegram client is intentionally tiny — see [`src/telegram.js`](src/telegram.js). A Discord webhook adapter would be ~30 lines.
- **Multi-user mode.** A `users[]` array, each with their own `chatId` + `watchlist`, all served by one process. Mind the PSX licensing terms before you turn this into a service.
- **`EX_DIV_TODAY` alerts.** Fire on the morning the share trades ex-dividend so you know to expect the price drop.

## ❓ FAQ

### What does it actually fetch from PSX?

Three live feeds, all from public pages on the PSX Data Portal:

1. **Payouts table** (`dps.psx.com.pk/payouts`) — always on. Drives `NEW`, `UPCOMING`, `URGENT`, `PASSED`.
2. **Announcements feed** (`dps.psx.com.pk/announcements/companies`) — opt-in via `announcements.enabled`. Drives `DECLARED` alerts for BoD-meeting outcomes that haven't yet hit the payouts table.
3. **Market-watch prices** (`dps.psx.com.pk/market-watch`) — opt-in via `priceLookup: true`. Used to add a yield line to alerts and to power `minYieldPercent`.

It only fetches what's *currently rendered* on those pages, and only stores what it has seen since you started running it.

### Does it fetch *historic* PSX data?

No — by design. It doesn't backfill multi-year dividend history, doesn't pull OHLC archives, doesn't scrape years of announcements. The `--backfill` flag is a one-shot snapshot of what's visible on the payouts table *right now*, nothing older.

That line isn't arbitrary. PSX market data is licensed for personal and non-commercial use only, and anything that redistributes a multi-year archive needs a paid data license — email [marketdatarequest@psx.com.pk](mailto:marketdatarequest@psx.com.pk). The same caveat applies to whatever ends up in your `state.json` — it's yours to use, not yours to publish.

### Will it tell me when to buy or sell?

It tells you when the *buy window* is closing — no more, no less. It doesn't recommend specific stocks, doesn't size positions, doesn't generate sell signals. The decision to buy or sell anything is yours.

### Can I use it for non-PSX markets?

Not without a rewrite. The scraper is specific to the PSX Data Portal's HTML, and the buy-deadline math assumes T+2 settlement (true for PSX, not universal). The classifier and Telegram pieces would survive a port; the scraper would not. Happy to link to any market-specific fork — open a PR adding it to this section.

### Will it tell me when to buy or sell?

It tells you when the *buy window* is closing — no more, no less. It doesn't recommend specific stocks, doesn't size positions, doesn't generate sell signals. The decision to buy or sell anything is yours.

### Can I use it for non-PSX markets?

Not without a rewrite. The scraper is specific to the PSX Data Portal's HTML, and the buy-deadline math assumes T+2 settlement (true for PSX, not universal). The classifier and Telegram pieces would survive a port; the scraper would not. Happy to link to any market-specific fork — open a PR adding it to this section.

## 🗺️ Roadmap

- [x] `--backfill` flag — register every visible payout as already-seen on first run
- [x] Pre-payouts announcements feed (`DECLARED` alerts for BoD-meeting outcomes)
- [x] Live prices + yield in alerts, with `minYieldPercent` filter
- [ ] Built-in PSX 2026 holiday list (waiting on the official PDF)
- [ ] `EX_DIV_TODAY` alert kind (heads-up that price is about to drop)
- [ ] Discord adapter
- [ ] Per-user watchlists from a single process
- [ ] Optional Telegram webhook for `/watch FFC` and `/unwatch FFC` from your phone

## 🤝 Contributing

PRs welcome. Quick links:

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — workflow, conventions, what's in/out of scope
- [`docs/architecture.md`](docs/architecture.md) — the 5-minute tour
- [Issues](https://github.com/your-username/psx-dividend-alert/issues) — bug reports and feature requests

If you're new to the codebase, the easiest way in is to read [`src/classifier.js`](src/classifier.js) end-to-end — it's the brain of the project and ~100 lines.

## 📊 Data licensing

PSX market data is licensed for **personal and non-commercial use only.** This repo is MIT-licensed, but **the data the tool fetches at runtime is not yours to redistribute.** Don't:

- Resell scraped data
- Run a paid hosted version of this for users who don't have their own data access
- Bake snapshots of PSX rows into a public dataset

If you want to do any of those, get a license: [marketdatarequest@psx.com.pk](mailto:marketdatarequest@psx.com.pk). The scraper is a convenience layer over a page you could read by hand; the obligations stay the same either way.

## 📜 License

MIT. See [LICENSE](LICENSE).

## 🙏 Acknowledgements

- The Pakistani retail-investor community on Twitter / r/pakistan / KSE forums — half the rules in this codebase are things people learned the hard way and shared.
- [Puppeteer](https://pptr.dev/), [pino](https://getpino.io/), and PM2 — the boring infrastructure that lets a 600-line tool run reliably for months.

---

<div align="center">

If this saved you from missing a dividend, **give it a ⭐** — it's how more people find it.

</div>
