// Entry point. Loads config, kicks off the polling loop, handles signals,
// and supports a one-shot `--backfill` mode that catches up on rows already
// visible on the payouts page.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { loadConfig } from './config.js';
import { loadState, saveState } from './state.js';
import { scrapePayouts, scrapePrices, scrapeRecentAnnouncements } from './scraper.js';
import { runTick, runAnnouncementsTick, telegramSender, markBackfilled } from './alerter.js';
import { PSX_TRADING_HOLIDAYS_2026 } from './trading-calendar.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CONFIG_PATH = process.env.PSX_ALERT_CONFIG ?? path.join(ROOT, 'config.json');

const { values: argv } = parseArgs({
  options: {
    backfill: { type: 'boolean', default: false },
    once: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: false,
});

if (argv.help) {
  process.stdout.write(
    [
      'psx-dividend-alert',
      '',
      'Usage: node src/index.js [options]',
      '',
      'Options:',
      '  --backfill    Record every visible payout row as already-seen and exit.',
      '                Run this once when starting fresh on a watchlist that',
      '                already has rows on the payouts page, so NEW alerts only',
      '                fire for new payouts going forward. UPCOMING / URGENT /',
      '                PASSED still fire normally as the deadlines arrive.',
      '  --once        Run a single tick and exit. Useful for cron.',
      '  -h, --help    Print this and exit.',
      '',
      'Config:',
      '  PSX_ALERT_CONFIG   Override the path to config.json',
      '  LOG_LEVEL          pino level (trace|debug|info|warn|error|fatal)',
      '',
    ].join('\n')
  );
  process.exit(0);
}

let stopRequested = false;
let activeRun = null;

async function tick(config, holidays) {
  const send = telegramSender(config);
  let state = await loadState(config.stateFile);

  // 1) payouts table
  let rows;
  try {
    rows = await scrapePayouts();
  } catch (err) {
    logger.error({ err: err.message }, 'payouts scrape failed; skipping payouts portion');
    rows = null;
  }

  // 2) optional live prices for the watched symbols (or all, if watchAll)
  /** @type {Map<string, number> | undefined} */
  let prices;
  if (config.priceLookup && rows && rows.length > 0) {
    const symbols = config.watchAll
      ? Array.from(new Set(rows.map((r) => r.symbol)))
      : config.watchlist;
    try {
      prices = await scrapePrices(symbols);
      logger.info({ priced: prices.size, requested: symbols.length }, 'prices fetched');
    } catch (err) {
      logger.warn({ err: err.message }, 'price lookup failed; alerting without yields');
    }
  }

  if (rows) {
    logger.info({ rows: rows.length }, 'scraped payouts');
    const result = await runTick({ rows, state, config, holidays, send, prices });
    state = result.state;
    logger.info({ alerted: result.alerted }, 'payouts tick complete');
  }

  // 3) optional announcements feed
  if (config.announcements?.enabled) {
    try {
      const anns = await scrapeRecentAnnouncements();
      logger.info({ announcements: anns.length }, 'scraped announcements');
      const result = await runAnnouncementsTick({
        announcements: anns,
        state,
        config,
        send,
      });
      state = result.state;
      logger.info({ alerted: result.alerted }, 'announcements tick complete');
    } catch (err) {
      logger.error({ err: err.message }, 'announcements scrape failed');
    }
  }

  await saveState(config.stateFile, state);
}

async function backfill(config) {
  const state = await loadState(config.stateFile);

  let rows;
  try {
    rows = await scrapePayouts();
  } catch (err) {
    logger.fatal({ err: err.message }, 'backfill scrape failed');
    process.exit(2);
  }

  const { state: next, recorded } = markBackfilled({ rows, state, config });
  await saveState(config.stateFile, next);

  logger.info(
    {
      totalVisible: rows.length,
      recorded,
      watchlist: config.watchAll ? '(all)' : config.watchlist.length,
    },
    'backfill complete'
  );
  process.stdout.write(
    [
      `Backfill complete.`,
      `  Visible rows on payouts table:  ${rows.length}`,
      `  Watched (after watchlist filter): ${recorded}`,
      ``,
      `NEW alerts will now only fire for payouts added after this point.`,
      `UPCOMING / URGENT / PASSED still fire normally as deadlines arrive.`,
      ``,
    ].join('\n')
  );
}

async function main() {
  const config = await loadConfig(CONFIG_PATH);
  const holidays = new Set([...PSX_TRADING_HOLIDAYS_2026, ...(config.holidays ?? [])]);

  if (argv.backfill) {
    logger.info({ configPath: CONFIG_PATH }, 'psx-dividend-alert backfill mode');
    await backfill(config);
    return;
  }

  logger.info(
    {
      configPath: CONFIG_PATH,
      watchAll: config.watchAll,
      watchlist: config.watchlist.length,
      leadTimeDays: config.leadTimeDays,
      checkIntervalMinutes: config.checkIntervalMinutes,
      priceLookup: !!config.priceLookup,
      minYieldPercent: config.minYieldPercent || 0,
      announcements: !!config.announcements?.enabled,
      once: !!argv.once,
    },
    'psx-dividend-alert starting'
  );

  // Run once immediately, then schedule.
  activeRun = tick(config, holidays).catch((err) =>
    logger.error({ err: err.message }, 'first tick failed')
  );
  await activeRun;

  if (argv.once) return;

  const intervalMs = config.checkIntervalMinutes * 60_000;
  while (!stopRequested) {
    await sleep(intervalMs);
    if (stopRequested) break;
    activeRun = tick(config, holidays).catch((err) =>
      logger.error({ err: err.message }, 'tick failed')
    );
    await activeRun;
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

function shutdown(signal) {
  if (stopRequested) return;
  stopRequested = true;
  logger.info({ signal }, 'shutdown requested; finishing in-flight tick');
  Promise.resolve(activeRun).finally(() => {
    logger.info('bye');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'fatal error');
  process.exit(1);
});
