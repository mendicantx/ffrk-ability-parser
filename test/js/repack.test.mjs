// Simulates a battle.js repack: every minified name the decoder could depend on
// (the X[Y. assignment prefixes and the helper names) is renamed, and the
// decoder must still decode exactly the same statuses with the same text. Game data is
// off: a renamed battle.js can't be executed, and this test is about the helper decoders.
// See docs/decisions.md "Status decoder: assignment scanning and decoder dispatch".

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, snapshot } from './harness.mjs';

// The fields a decoder produces from the status itself (funcName/argsText echo battle.js names).
const DECODED_FIELDS = ['id', 'codedName', 'commonName', 'effects', 'defaultDuration', 'mndModifier', 'exclusiveStatus', 'notes', 'decoded'];

const pick = row => Object.fromEntries(DECODED_FIELDS.map(f => [f, row[f]]));
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function decodedRows(page) {
  return page.eval(`Object.keys(DB.statusAilmentsForward).sort()
    .map(k => decodeStatus(k)).filter(d => d.decoded)`).map(pick);
}

// Range of a define("module") factory body in js, as [start, end).
function defineRange(js, moduleName) {
  const start = js.indexOf(`define("${moduleName}"`);
  if (start < 0) return null;
  let i = start, paren = 0;
  for (; i < js.length; i++) { if (js[i] === '(') paren++; else if (js[i] === '{' && paren > 0) break; }
  let depth = 0, j = i;
  for (; j < js.length; j++) { if (js[j] === '{') depth++; else if (js[j] === '}' && --depth === 0) break; }
  return [i, j + 1];
}

test('decoder output survives a simulated battle.js repack', async () => {
  const original = await loadPage('status_decoder', { gameData: false });
  const before = decodedRows(original);
  assert.ok(before.length > 800, `expected over 800 decoded statuses, got ${before.length}`);

  // Every (module, helper) pair used by a decoded status gets a fresh name.
  const decodedKeys = new Set(before.map(r => r.codedName));
  const assignments = original.eval('DB.statusAssignments');
  const helpers = new Map();
  for (const key of decodedKeys) {
    // Statuses read from their coded name alone have no helper to rename.
    if (!assignments[key]) continue;
    const { defineModule, funcName } = assignments[key];
    const id = `${defineModule}|${funcName}`;
    if (!helpers.has(id)) helpers.set(id, { defineModule, funcName, renamed: `zzRepack${helpers.size}` });
  }

  let js = snapshot().battleJs;
  // 1. Rename each helper's definition inside its own define() block.
  for (const { defineModule, funcName, renamed } of helpers.values()) {
    const [a, b] = defineRange(js, defineModule);
    const def = new RegExp(`(^|[^\\w$])${escapeRe(funcName)}(\\s*=\\s*function\\s*\\()`);
    const block = js.slice(a, b);
    assert.match(block, def, `helper ${funcName} not found in ${defineModule}`);
    js = js.slice(0, a) + block.replace(def, `$1${renamed}$2`) + js.slice(b);
  }
  // 2. In one pass, rename the X[Y. prefix of every status assignment (as a repack
  //    would) and the helper name at the decoded statuses' assignments.
  let sites = 0;
  js = js.replace(/([\w$]+)\[([\w$]+)\.([A-Z_0-9]+)\]=([\w$]+)\(/g, (whole, x, y, key, fn) => {
    const assignment = assignments[key];
    if (!assignment || assignment.funcName !== fn) return whole;
    sites++;
    const helper = decodedKeys.has(key) ? helpers.get(`${assignment.defineModule}|${fn}`) : null;
    return `Rp${x}[rp${y}.${key}]=${helper ? helper.renamed : fn}(`;
  });
  assert.ok(sites >= Object.keys(assignments).length, `renamed ${sites} assignment sites`);

  const repacked = await loadPage('status_decoder', { battleJs: js, gameData: false });
  const renamedHelpers = new Set([...helpers.values()].map(h => h.renamed));
  const sample = repacked.eval(`DB.statusAssignments[${JSON.stringify(before[0].codedName)}].funcName`);
  assert.ok(renamedHelpers.has(sample), `repack simulation didn't take effect (helper is still ${sample})`);

  assert.deepEqual(decodedRows(repacked), before);
});
