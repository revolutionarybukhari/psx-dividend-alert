// Minimal Telegram Bot API client. Just sendMessage.

const API_BASE = 'https://api.telegram.org';

/**
 * @param {string} botToken
 * @param {string|number} chatId
 * @param {string} text
 * @param {object} [opts]
 * @param {'HTML'|'MarkdownV2'} [opts.parseMode]
 * @param {boolean} [opts.disableWebPagePreview]
 */
export async function sendMessage(botToken, chatId, text, opts = {}) {
  const url = `${API_BASE}/bot${botToken}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: opts.parseMode ?? 'HTML',
    disable_web_page_preview: opts.disableWebPagePreview ?? true,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  /** @type {{ ok: boolean, description?: string, error_code?: number }} */
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram error ${data.error_code}: ${data.description}`);
  }
  return data;
}

/**
 * Escape user-controlled text for Telegram HTML parse mode.
 * @param {string} s
 */
export function escapeHTML(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
