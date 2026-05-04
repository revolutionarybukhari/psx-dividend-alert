// Load and validate config.json. Fails loud — better to crash on boot
// than silently swallow a missing bot token at 3am.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} TelegramConfig
 * @property {string} botToken
 * @property {string|number} chatId
 */

/**
 * @typedef {object} AnnouncementsConfig
 * @property {boolean} enabled              Default false (opt-in; PSX feed is noisy)
 * @property {string[]} types               Categories to alert on; default ['dividend','bonus','right']
 */

/**
 * @typedef {object} Config
 * @property {TelegramConfig} telegram
 * @property {string[]} watchlist
 * @property {boolean} watchAll
 * @property {number} leadTimeDays
 * @property {number} checkIntervalMinutes
 * @property {string} stateFile
 * @property {string[]} [holidays]          Override PSX_TRADING_HOLIDAYS_2026
 * @property {boolean} [priceLookup]        Fetch live prices and show yield in alerts
 * @property {number}  [minYieldPercent]    Suppress alerts below this yield (requires priceLookup)
 * @property {AnnouncementsConfig} [announcements]
 */

const DEFAULTS = {
  watchlist: [],
  watchAll: false,
  leadTimeDays: 5,
  checkIntervalMinutes: 60,
  stateFile: './state.json',
  holidays: [],
  priceLookup: false,
  minYieldPercent: 0,
  announcements: {
    enabled: false,
    types: ['dividend', 'bonus', 'right'],
  },
};

/**
 * @param {string} configPath
 * @returns {Promise<Config>}
 */
export async function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    throw new Error(
      `config file not found at ${configPath}. Copy config.example.json to config.json and fill it in.`
    );
  }

  const raw = await readFile(configPath, 'utf8');
  /** @type {Partial<Config>} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config at ${configPath} is not valid JSON: ${err.message}`);
  }

  const cfg = {
    ...DEFAULTS,
    ...parsed,
    telegram: { ...(parsed.telegram ?? {}) },
    announcements: { ...DEFAULTS.announcements, ...(parsed.announcements ?? {}) },
  };

  // Resolve stateFile relative to the config file's directory, so it
  // doesn't depend on the cwd PM2 happens to launch from.
  if (!path.isAbsolute(cfg.stateFile)) {
    cfg.stateFile = path.resolve(path.dirname(configPath), cfg.stateFile);
  }

  validate(cfg);
  return cfg;
}

/** @param {Config} cfg */
function validate(cfg) {
  const errors = [];

  if (!cfg.telegram.botToken || cfg.telegram.botToken.includes('YOUR_BOT_TOKEN')) {
    errors.push('telegram.botToken is missing — get one from @BotFather');
  }
  if (!cfg.telegram.chatId || String(cfg.telegram.chatId).includes('YOUR_CHAT_ID')) {
    errors.push('telegram.chatId is missing — see README for how to find yours');
  }
  if (!cfg.watchAll && (!Array.isArray(cfg.watchlist) || cfg.watchlist.length === 0)) {
    errors.push('watchlist is empty and watchAll is false — set one or the other');
  }
  if (!Number.isFinite(cfg.leadTimeDays) || cfg.leadTimeDays < 0) {
    errors.push('leadTimeDays must be a non-negative number');
  }
  if (!Number.isFinite(cfg.checkIntervalMinutes) || cfg.checkIntervalMinutes < 1) {
    errors.push('checkIntervalMinutes must be a positive number (>=1)');
  }
  if (
    cfg.minYieldPercent != null &&
    (!Number.isFinite(cfg.minYieldPercent) || cfg.minYieldPercent < 0)
  ) {
    errors.push('minYieldPercent must be a non-negative number');
  }
  if (cfg.minYieldPercent > 0 && !cfg.priceLookup) {
    errors.push('minYieldPercent requires priceLookup: true (we need a price to compute yield)');
  }

  if (errors.length) {
    throw new Error(`config invalid:\n  - ${errors.join('\n  - ')}`);
  }
}
