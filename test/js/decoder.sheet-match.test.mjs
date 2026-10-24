// Measures how closely the Status Decoder's output matches the community Status
// sheet, for every decoded status that has a sheet row. The sheet is the
// reference (docs/decisions.md "Decoder wording follows the sheet"), so these
// counts may only go up: raise the floors when a change improves them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, snapshot } from './harness.mjs';

// Matches per family as of the last improvement.
const FLOORS = {
  LEARNING_MODE:       { names: 53, effects: 39 },
  ULTIMATE_BUDDY_MODE: { names: 270, effects: 137 },
  LIMIT_BREAK_SOUL_DRIVE: { names: 154, effects: 101 },
  DUAL_AWAKE_MODE:     { names: 295, effects: 145 },
  all:                 { names: 2245, effects: 1651 },
};

// Clauses the decoder always writes but many sheet rows leave out. A row matches if
// the sheet has the decoder's text with them or without them (matching only: the
// decoder still outputs them). "Hero Abilities have zero hone cost" is on every Zenith
// Mode (owner decision) and on 64 of 307 sheet rows.
const OPTIONAL_CLAUSES = [/, Hero Abilities have zero hone cost(?=,|$)/g];
const withoutOptional = text => OPTIONAL_CLAUSES.reduce((s, re) => s.replace(re, ''), String(text ?? ''));
const effectsMatch = (decoded, sheet) => decoded === sheet || withoutOptional(decoded) === sheet;

const familyOf = key => Object.keys(FLOORS).find(f => f !== 'all' && key.startsWith(f)) ?? null;

test('decoded names and effects match the Status sheet at least as often as before', async t => {
  const sheet = new Map(snapshot().sheets.status.map(r => [r['Coded Name'], r]));
  const page = await loadPage('status_decoder');
  const decoded = page.eval(`Object.keys(DB.statusAilmentsForward).map(k => decodeStatus(k)).filter(d => d.decoded)`);

  const tally = Object.fromEntries(Object.keys(FLOORS).map(f => [f, { rows: 0, names: 0, effects: 0 }]));
  for (const d of decoded) {
    const row = sheet.get(d.codedName);
    if (!row?.['Common Name']) continue;
    for (const f of ['all', familyOf(d.codedName)].filter(Boolean)) {
      tally[f].rows++;
      if (d.commonName === row['Common Name']) tally[f].names++;
      if (effectsMatch(d.effects, row['Effects'])) tally[f].effects++;
    }
  }
  for (const [f, c] of Object.entries(tally)) {
    t.diagnostic(`${f}: ${c.rows} with sheet rows, names match ${c.names}, effects match ${c.effects}`);
    assert.ok(c.names >= FLOORS[f].names, `${f}: name matches fell to ${c.names} (floor ${FLOORS[f].names})`);
    assert.ok(c.effects >= FLOORS[f].effects, `${f}: effects matches fell to ${c.effects} (floor ${FLOORS[f].effects})`);
  }
});
