import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { emptyState, loadState, saveState, recordAlert } from '../src/state.js';

test('emptyState() seeds an empty seen map', () => {
  assert.deepEqual(emptyState(), { seen: {} });
});

test('loadState returns emptyState when file is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'psx-state-'));
  const state = await loadState(join(dir, 'nope.json'));
  assert.deepEqual(state, { seen: {} });
});

test('loadState returns emptyState on garbage JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'psx-state-'));
  const path = join(dir, 'broken.json');
  await saveState(path, { seen: {} });
  // overwrite with junk
  await (await import('node:fs/promises')).writeFile(path, 'not json');
  const state = await loadState(path);
  assert.deepEqual(state, { seen: {} });
});

test('saveState then loadState round-trips', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'psx-state-'));
  const path = join(dir, 'state.json');
  const seeded = recordAlert(emptyState(), 'MEBL@2026-05-15', 'NEW', '2026-05-01');
  await saveState(path, seeded);
  const loaded = await loadState(path);
  assert.deepEqual(loaded, seeded);
});

test('recordAlert dedupes the same alert kind', () => {
  let s = emptyState();
  s = recordAlert(s, 'MEBL@2026-05-15', 'NEW', '2026-05-01');
  s = recordAlert(s, 'MEBL@2026-05-15', 'NEW', '2026-05-01');
  assert.deepEqual(s.seen['MEBL@2026-05-15'].alertsSent, ['NEW']);
});

test('recordAlert appends new kinds in order', () => {
  let s = emptyState();
  s = recordAlert(s, 'MEBL@2026-05-15', 'NEW', '2026-05-01');
  s = recordAlert(s, 'MEBL@2026-05-15', 'UPCOMING', '2026-05-09');
  s = recordAlert(s, 'MEBL@2026-05-15', 'URGENT', '2026-05-13');
  assert.deepEqual(s.seen['MEBL@2026-05-15'].alertsSent, ['NEW', 'UPCOMING', 'URGENT']);
});

test('saveState atomically replaces existing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'psx-state-'));
  const path = join(dir, 'state.json');
  await saveState(path, { seen: { a: { firstSeen: 'd', alertsSent: ['NEW'] } } });
  await saveState(path, { seen: { b: { firstSeen: 'd', alertsSent: ['URGENT'] } } });
  const buf = await readFile(path, 'utf8');
  const parsed = JSON.parse(buf);
  assert.equal(Object.keys(parsed.seen).join(','), 'b');
});
