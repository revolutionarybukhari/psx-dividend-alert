// State persistence — flat JSON file. No database; this is a personal tool.
// We hold an in-memory copy and write atomically (write-temp-then-rename)
// so a crash never leaves a half-written state file.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * @typedef {import('./classifier.js').State} State
 */

/** @returns {State} */
export function emptyState() {
  return { seen: {} };
}

/**
 * @param {string} path
 * @returns {Promise<State>}
 */
export async function loadState(path) {
  if (!existsSync(path)) return emptyState();
  try {
    const buf = await readFile(path, 'utf8');
    const parsed = JSON.parse(buf);
    if (!parsed || typeof parsed !== 'object' || !parsed.seen) return emptyState();
    return parsed;
  } catch {
    return emptyState();
  }
}

/**
 * @param {string} path
 * @param {State} state
 */
export async function saveState(path, state) {
  const dir = dirname(path);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await rename(tmp, path);
}

/**
 * Mark a row as seen (or update its alert log) and return the next state.
 * Pure function; caller persists.
 *
 * @param {State} state
 * @param {string} fingerprint
 * @param {string} alertKind          e.g. "NEW", "URGENT"
 * @param {string} todayISO
 */
export function recordAlert(state, fingerprint, alertKind, todayISO) {
  const entry = state.seen[fingerprint] ?? { firstSeen: todayISO, alertsSent: [] };
  if (!entry.alertsSent.includes(alertKind)) entry.alertsSent.push(alertKind);
  return {
    ...state,
    seen: { ...state.seen, [fingerprint]: entry },
  };
}
