// Locks in the Status Decoder's output for every STATUS_AILMENTS_TYPE key in
// the snapshot. One JSON line per key, sorted by key. Regenerate after an
// intended change with: $env:UPDATE_GOLDEN='1'; node --test "test/js/*.test.mjs"

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, checkGolden } from './harness.mjs';

// Families reported in the summary, matched on the status's define() module
// (from its assignment in battle.js) or its key prefix.
const FAMILIES = [
  ['Crystal Buddy Mode', (m) => m.endsWith('/CrystalBuddyMode')],
  ['Tactical Awake Mode', (m) => m.endsWith('/TacticalAwakeMode')],
  ['Buster Attack', (m) => m.endsWith('/BusterAttack')],
  ['Extra Buddy Mode', (m) => m.endsWith('/ExtraBuddyMode')],
  ['Learning Mode', (_, key) => key.startsWith('LEARNING_MODE')],
  ['Reduce Consume Point', (_, key) => key.startsWith('REDUCE_CONSUME_POINT')],
  ['Other assigned', (m) => m !== ''],
  ['No assignment found', () => true],
];

test('decodeStatus output matches the golden file for every status key', async t => {
  const page = await loadPage('status_decoder');
  const results = page.eval(`
    Object.keys(DB.statusAilmentsForward).sort().map(key => {
      const d = decodeStatus(key);
      const row = {};
      for (const [k, v] of Object.entries(d)) {
        if (!k.startsWith('_') && k !== 'block') row[k] = v;
      }
      return { key, module: DB.statusAssignments[key]?.defineModule ?? '', row };
    })
  `);
  const rows = results.map(r => r.row);

  const summary = Object.fromEntries(FAMILIES.map(([name]) => [name, { decoded: 0, undecoded: 0 }]));
  for (const { key, module, row } of results) {
    const [family] = FAMILIES.find(([, match]) => match(module, key));
    summary[family][row.decoded ? 'decoded' : 'undecoded']++;
  }
  t.diagnostic(`${rows.length} status keys`);
  for (const [name, c] of Object.entries(summary)) {
    t.diagnostic(`${name}: ${c.decoded} decoded, ${c.undecoded} not decoded`);
  }

  const jsonl = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  const diff = checkGolden('statuses.jsonl', jsonl);
  assert.equal(diff, null, diff ?? '');
});
