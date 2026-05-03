# Security policy

## Supported versions

This project follows the latest minor release on the `main` branch. Older minors do not receive backports.

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Reporting a vulnerability

**Please do not open public GitHub issues for security problems.**

Email the maintainer (see `package.json`) with:

- A description of the issue
- A minimal reproduction
- The version / commit you tested against
- Your contact details for follow-up

You can expect:

- An acknowledgment within 72 hours
- A patch release within 14 days for confirmed issues, or a clear timeline if more time is needed
- Credit in the release notes (unless you'd rather stay anonymous)

## Threat model

This tool is intended to run on a single user's machine or VPS, holding:

- A Telegram bot token (write access to one chat)
- A list of PSX symbols
- A small JSON state file

It does **not** hold brokerage credentials, banking data, or anything that can move money. If you're considering forking it to do so, the threat model changes substantially — be deliberate about secret handling, audit logging, and least-privilege.

## Things that are *not* vulnerabilities

- "The tool fetches PSX data" — it scrapes a public page.
- "The tool sends messages to Telegram" — that's the feature.
- "config.json contains a bot token" — it's how Telegram bots authenticate; rotate via `@BotFather` if leaked.
