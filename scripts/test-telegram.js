// Send one canned message to the configured chat. Confirms the bot token,
// chat id, and HTML escaping are all working before you trust real alerts.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { sendMessage } from '../src/telegram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const configPath = process.env.PSX_ALERT_CONFIG ?? path.join(ROOT, 'config.json');

const config = await loadConfig(configPath);
const text = [
  '<b>✅ psx-dividend-alert — wire test</b>',
  '',
  'If you see this, your bot token and chat id are good.',
  'Real dividend alerts will look like this, with the symbol and dates filled in.',
].join('\n');

await sendMessage(config.telegram.botToken, config.telegram.chatId, text);
console.log('Test message delivered.');
