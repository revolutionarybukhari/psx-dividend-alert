<div align="center">

# 📈 PSX Dividend Alert

**Telegram alerts for Pakistan Stock Exchange dividends — with a buy deadline that actually accounts for T+2 settlement and trading holidays.**

[![CI](https://github.com/your-username/psx-dividend-alert/actions/workflows/ci.yml/badge.svg)](https://github.com/your-username/psx-dividend-alert/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Stars](https://img.shields.io/github/stars/your-username/psx-dividend-alert?style=social)](https://github.com/your-username/psx-dividend-alert/stargazers)

[Quick start](#-quick-start) · [How it works](#-how-it-works) · [Configuration](#%EF%B8%8F-configuration) · [Deploy](#-deploy) · [FAQ](#-faq) · [Roadmap](#%EF%B8%8F-roadmap)

</div>

---

> If you've ever opened the PSX payouts page on a Friday evening, realised the book closure starts Monday, and done the maths in your head about whether you can still buy in — this is for you.

`psx-dividend-alert` watches the [PSX Data Portal](https://dps.psx.com.pk/payouts) for dividend announcements and book-closure dates, and pings your Telegram **before the buy deadline**, not on the ex-dividend date when it's already too late.

It runs on a $5 VPS, a Raspberry Pi, or your laptop. Setup takes about 90 seconds.

## What an alert looks like

```
🆕 NEW DIVIDEND — $MEBL
Meezan Bank Limited

💰 Cash Dividend: 175%
📅 Book Closure: 2026-05-15 → 2026-05-22
⏰ Buy Deadline: 2026-05-13 (in 10 days)

dps.psx.com.pk/company/MEBL
```

Then four days before the deadline:

```
⏳ UPCOMING in 4 days — $MEBL
Meezan Bank Limited
…
⏰ Buy Deadline: 2026-05-13 (in 4 days)
```

And on the day:

```
⚠️ URGENT — Buy TODAY — $MEBL
Meezan Bank Limited
…
⏰ Buy Deadline: 2026-05-13 (today)
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

| Field                  | Type            | Default            | What it does                                                                  |
| ---------------------- | --------------- | ------------------ | ----------------------------------------------------------------------------- |
| `telegram.botToken`    | `string`        | —                  | From `@BotFather`. **Required.**                                              |
| `telegram.chatId`      | `string \| int` | —                  | Your Telegram chat id (user, group, or channel). **Required.**                |
| `watchlist`            | `string[]`      | `[]`               | Symbols you care about, e.g. `["MEBL", "FFC", "OGDC"]`.                       |
| `watchAll`             | `boolean`       | `false`            | If `true`, alert on every PSX symbol — overrides `watchlist`.                 |
| `leadTimeDays`         | `number`        | `5`                | How many days before the buy deadline to fire `UPCOMING`.                     |
| `checkIntervalMinutes` | `number`        | `60`               | How often to poll PSX. Don't go below 15 — be polite.                         |
| `stateFile`            | `string`        | `./state.json`     | Where to persist seen/alerted state. Resolved relative to `config.json`.      |
| `holidays`             | `string[]`      | `[]`               | Extra trading holidays (`YYYY-MM-DD`), merged with the built-in list.         |

The built-in holiday list lives in [`src/trading-calendar.js`](src/trading-calendar.js) (`PSX_TRADING_HOLIDAYS_2026`). It ships intentionally empty — PSX publishes the official calendar in December and you should drop in the real list when it does. Without it, the math just skips weekends, which is right ~50 weeks a year and wrong on Eid weeks.

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

- **Announcements feed.** The scraper already exports `scrapeRecentAnnouncements()`. Wire it into `index.js` to also catch BoD-meeting dividend declarations *before* they appear in the payouts table.
- **Watchlist via Telegram.** Add a webhook so you can `/watch FFC` and `/unwatch FFC` from your phone instead of editing `config.json`.
- **Yield filter.** Parse the `payout` text (`"175%"`, `"Rs 5/sh"`) and only alert above a threshold yield given the current price. Needs a second scrape for prices — keep it opt-in.
- **More adapters.** The Telegram client is intentionally tiny. A Discord webhook adapter is ~30 lines.
- **Multi-user mode.** A `users[]` array, each with their own `chatId` + `watchlist`, all served by one process. Mind the PSX licensing terms before you turn this into a service.

## ❓ FAQ

### Does it fetch historic PSX data?

No — it polls the *current* PSX payouts table and only stores what it has seen since you started running it. It doesn't backfill dividend history, scrape prices, or pull years of announcements.

If you want a multi-year dividend archive or OHLC price data, that's a different tool and a different licensing question. PSX market data is licensed for personal and non-commercial use only, so anything that redistributes an archive needs a paid data license — email [marketdatarequest@psx.com.pk](mailto:marketdatarequest@psx.com.pk).

The `--backfill` flag on the [roadmap](#%EF%B8%8F-roadmap) will record everything currently visible on the payouts table on first run, so the tool doesn't ignore rows that were already on the page when you started it. That's the line we stop at — it's still data PSX shows on a public page right now, not an archive.

### Will it tell me when to buy or sell?

It tells you when the *buy window* is closing — no more, no less. It doesn't recommend specific stocks, doesn't size positions, doesn't generate sell signals. The decision to buy or sell anything is yours.

### Can I use it for non-PSX markets?

Not without a rewrite. The scraper is specific to the PSX Data Portal's HTML, and the buy-deadline math assumes T+2 settlement (true for PSX, not universal). The classifier and Telegram pieces would survive a port; the scraper would not. Happy to link to any market-specific fork — open a PR adding it to this section.

## 🗺️ Roadmap

- [ ] `--backfill` flag — record everything currently visible on the payouts table on first run, so existing rows aren't ignored
- [ ] Built-in PSX 2026 holiday list (waiting on the official PDF)
- [ ] `EX_DIV_TODAY` alert kind (heads-up that price is about to drop)
- [ ] Pre-payouts announcements scraper wired into the loop
- [ ] Discord adapter
- [ ] Optional yield-threshold filter
- [ ] Per-user watchlists from a single process

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
