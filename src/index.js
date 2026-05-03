// Entry point. Loads config, kicks off the polling loop, handles signals.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { loadState, saveState } from './state.js';
import { scrapePayouts } from './scraper.js';
import { runTick, telegramSender } from './alerter.js';
import { PSX_TRADING_HOLIDAYS_2026 } from './trading-calendar.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CONFIG_PATH = process.env.PSX_ALERT_CONFIG ?? path.join(ROOT, 'config.json');

let stopRequested = false;
let activeRun = null;

async function tick(config, holidays) {
  const send = telegramSender(config);
  const state = await loadState(config.stateFile);

  let rows;
  try {
    rows = await scrapePayouts();
  } catch (err) {
    logger.error({ err: err.message }, 'scrape failed; skipping tick');
    return;
  }

  logger.info({ rows: rows.length }, 'scraped payouts');

  const result = await runTick({
    rows,
    state,
    config,
    holidays,
    send,
  });

  await saveState(config.stateFile, result.state);
  logger.info({ alerted: result.alerted }, 'tick complete');
}

async function main() {
  const config = await loadConfig(CONFIG_PATH);
  const holidays = new Set([...PSX_TRADING_HOLIDAYS_2026, ...(config.holidays ?? [])]);

  logger.info(
    {
      configPath: CONFIG_PATH,
      watchAll: config.watchAll,
      watchlist: config.watchlist.length,
      leadTimeDays: config.leadTimeDays,
      checkIntervalMinutes: config.checkIntervalMinutes,
    },
    'psx-dividend-alert starting'
  );

  // Run once immediately, then schedule.
  activeRun = tick(config, holidays).catch((err) =>
    logger.error({ err: err.message }, 'first tick failed')
  );
  await activeRun;

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
    // Allow Node to exit on signals even if a long sleep is pending.
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
