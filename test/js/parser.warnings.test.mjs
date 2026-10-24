// When the parser can't fully read a soul break, it says so above the rows instead of
// quietly producing rows that look complete.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadPage, snapshot, FIXTURES } from './harness.mjs';

const fixture = name => fs.readFileSync(path.join(FIXTURES, 'battles', name), 'utf8');

function parse(page, text) {
  page.eval(`processBattleJson(${JSON.stringify(text)})`);
  return page.document.getElementById('results').innerHTML;
}

test('an action the Action Args sheet lacks is reported above the rows', async () => {
  const page = await loadPage('ability_parser', { gameData: false });
  // Rain's Zenith with its action (233) changed to one no sheet row describes.
  const html = parse(page, fixture('rain-zsb.txt').replace('"action_id": "233"', '"action_id": "999"'));
  assert.match(html, /class="parse-warning">⚠ Action 999 isn't in the Action Args sheet/);
  assert.match(html, /class="sbp-tsv-area"/, 'the rows are still shown');
});

test('a sub-action key the parser does not read is listed under Unrecognised Args', async () => {
  const page = await loadPage('ability_parser', { gameData: false });
  const html = parse(page, fixture('rain-zsb.txt').replace('"arg": "saId: 50349"', '"arg": "saId: 50349\\nbrandNewKey: 7"'));
  assert.match(html, /<th>sub-action brandNewKey<\/th>\s*<td class="val-str">7<\/td>/);
  assert.doesNotMatch(html, /sub-action minFactor/, 'keys the parser leaves out on purpose are not listed');
});

test('a Status Decoder that cannot start is reported, and the soul break still parses', async () => {
  // A battle.js where the module the decoder scans for status assignments was renamed.
  const battleJs = snapshot().battleJs.split('define("scenes/battle/StatusAilmentsConfig"').join('define("scenes/battle/StatusAilmentsConfigRenamed"');
  const page = await loadPage('ability_parser', { gameData: false, battleJs });
  const html = parse(page, fixture('seymour-xsb.txt'));
  assert.match(html, /class="parse-warning">⚠ The Status Decoder couldn't start/);
  assert.ok((html.match(/class="sbp-tsv-area"/g) ?? []).length > 0, 'the rows are still shown');
});

test('a normal parse shows no warnings', async () => {
  const page = await loadPage('ability_parser', { gameData: false });
  assert.doesNotMatch(parse(page, fixture('rain-zsb.txt')), /parse-warning/);
});
