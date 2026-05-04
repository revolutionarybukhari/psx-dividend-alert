# Contributing

Thanks for taking the time to contribute! This is a small, focused tool — the bar for changes is "does it make the alerts more useful or more reliable for the average PSX retail investor?"

## Quick start

```bash
git clone https://github.com/revolutionarybukhari/psx-dividend-alert.git
cd psx-dividend-alert
npm install
cp config.example.json config.json
# fill in a throwaway bot token + your own chat id

npm test            # unit tests, no network
npm run test-scrape # one-shot scrape against the live PSX page
```

## Ground rules

- **Tests are unit tests.** They must pass offline. Anything that touches PSX or Telegram lives in `scripts/test-*.js` and is opt-in.
- **No new heavy dependencies** without a clear payoff. We deliberately keep the dep tree tiny so installs stay fast and the audit surface stays small.
- **Don't mock PSX data into permanent fixtures.** PSX has changed its column names before; baking yesterday's HTML into the test suite hides the breakage. Make the parser tolerant instead.
- **Be honest about uncertainty.** Code comments should call out the parts that are guesses about PSX behavior — that's exactly the kind of context future contributors need.

## Reporting bugs

Open an issue using the **Bug report** template. Include:

- The symbol(s) the bug affects
- Approximate date you saw the row on `dps.psx.com.pk/payouts`
- The text of the alert you got vs. what you expected
- Output of `npm run test-scrape` if relevant (redact tokens!)

If the scraper broke because PSX redesigned the page, the row in the test-scrape output is what we need most.

## Suggesting features

Open an issue using the **Feature request** template. The roadmap in the README lists the directions we're already considering — drop in a +1 there if one matches.

A few "out of scope" notes so we don't waste each other's time:

- We're not going to add buy/sell execution. The risk/reward is wrong for a free OSS tool.
- We're not going to host a centralized version with hosted bots. The license on PSX data wouldn't allow it, and the per-user setup is intentionally a small barrier.
- We're keeping it Telegram-only for now. Discord/Slack are reasonable adds, but only as additional adapters, not replacements.

## Code style

Run before opening a PR:

```bash
npm run format
npm run lint
npm test
```

A few opinions baked into the code we'd rather keep:

- ESM (`type: "module"`) — no CommonJS converts.
- No TypeScript build step. JSDoc types where they help; `// @ts-check` if you want stricter checking locally.
- `node:test` only. No Jest, no Mocha, no Ava.
- Pure functions where possible. The scraper, Telegram client, and state file are the only places I/O lives — everything else is composed from them.
- One short comment line max per non-obvious decision. Don't paraphrase the code.

## Adding a new alert kind

`src/classifier.js` is the source of truth. To add a new kind (e.g. `EX_DIV_TODAY`):

1. Add the kind to the `AlertKind` union.
2. Add the rule to `classify()`, choosing carefully where in the if/else chain it slots in (kind precedence matters).
3. Add a prefix to `KIND_PREFIX` in `src/alerter.js`.
4. Cover the rule in `tests/classifier.test.js` — at least the "fires when expected" and "doesn't double-fire" cases.

## Releasing

Maintainers only.

1. Bump the version in `package.json` (semver — bug fix → patch, new alert kind / config key → minor, breaking change → major).
2. Update `CHANGELOG.md`.
3. Tag: `git tag v0.X.Y && git push --tags`.
4. The `release` workflow on GitHub Actions takes it from there.
