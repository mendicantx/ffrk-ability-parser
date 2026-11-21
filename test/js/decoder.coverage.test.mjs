// The decoder's purpose: describe statuses the community sheet doesn't have yet.
// Counts how many of those it can decode; the count may only go up (raise FLOOR
// when a change improves it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, snapshot } from './harness.mjs';

// 1040 → 678 (snapshot of 2026-11-21): the sheet filled in Effects on 427 Status-tab rows,
// most of them statuses the decoder described, so they no longer count as missing. No
// status stopped decoding (statuses.jsonl), and 33 of the 37 new statuses decode.
const FLOOR = 678;

test('decodes statuses that are missing from the Status sheet', async t => {
  const sheet = new Map(snapshot().sheets.status.map(r => [r['Coded Name'], r]));
  const page = await loadPage('status_decoder');
  const results = page.eval(`Object.keys(DB.statusAilmentsForward).map(k => ({ key: k, decoded: !!decodeStatus(k).decoded }))`);
  const missing = results.filter(({ key }) => {
    const effects = String(sheet.get(key)?.['Effects'] ?? '').trim();
    return !effects || effects === '-' || effects === '?';
  });
  const decoded = missing.filter(s => s.decoded).length;
  t.diagnostic(`${decoded} of ${missing.length} statuses missing from the sheet are decoded`);
  assert.ok(decoded >= FLOOR, `decoded ${decoded}, floor ${FLOOR}`);
});
