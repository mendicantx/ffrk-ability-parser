// Locks in the Ability Parser's output for every capture in test/fixtures/battles:
// <name>.json (any JSON shape the parser accepts) or <name>.txt (a raw paste,
// e.g. the mixed "{sb} abilities:[...]" format). For each one it stores:
//   golden/parser/<name>.tsv   every sheet-preview row (the text copied into the sheet)
//   golden/parser/<name>.html  the full rendered results, one tag per line
// Regenerate after an intended change with:
//   $env:UPDATE_GOLDEN='1'; node --test "test/js/*.test.mjs"

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadPage, checkGolden, FIXTURES } from './harness.mjs';

const BATTLES = path.join(FIXTURES, 'battles');
const captures = fs.readdirSync(BATTLES).filter(f => /\.(json|txt)$/.test(f)).sort();

function decodeEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// Every preview row: "<textarea id>\t<row text>", in render order.
export function tsvRows(html) {
  return [...html.matchAll(/<textarea class="sbp-tsv-area" id="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)]
    .map(m => `${m[1]}\t${decodeEntities(m[2])}`);
}

// One tag per line so golden diffs point at the changed element.
const prettyHtml = html => html.replace(/>\s*</g, '>\n<').trim() + '\n';

async function render(page, input) {
  page.document.getElementById('results').innerHTML = '';
  page.eval(`processBattleJson(${JSON.stringify(input)})`);
  // Let any async work started by the render (e.g. translation) settle.
  await new Promise(r => setTimeout(r, 0));
  return page.document.getElementById('results').innerHTML;
}

test('every battle capture has at least one fixture', () => {
  assert.ok(captures.length > 0, 'no captures in test/fixtures/battles');
});

for (const file of captures) {
  const name = file.replace(/\.(json|txt)$/, '');

  test(`parser output for ${name} matches golden files`, async () => {
    const page = await loadPage('ability_parser');
    const input = fs.readFileSync(path.join(BATTLES, file), 'utf8');
    const html = await render(page, input);
    const rows = tsvRows(html);
    assert.ok(rows.length > 0, `${name}: no sheet-preview rows rendered`);

    const tsvDiff = checkGolden(`parser/${name}.tsv`, rows.join('\n') + '\n');
    assert.equal(tsvDiff, null, tsvDiff ?? '');
    const htmlDiff = checkGolden(`parser/${name}.html`, prettyHtml(html));
    assert.equal(htmlDiff, null, htmlDiff ?? '');
  });

  // Full battle captures only: check the other input shapes give the same rows.
  if (!file.endsWith('.json')) continue;
  test(`${name}: a bare soul break and the mixed format give the same rows`, async () => {
    const page = await loadPage('ability_parser');
    const battle = JSON.parse(fs.readFileSync(path.join(BATTLES, file), 'utf8')).battle;
    if (!battle) return; // not a full capture
    const actors = [...(battle.supporter ?? []), ...(battle.buddy ?? [])];
    let checked = 0;
    for (const actor of actors) {
      for (const sb of actor.soul_strikes ?? []) {
        const abilities = actor.abilities ?? [];
        const asObject = await render(page, JSON.stringify({ ...sb, abilities }));
        const mixed = await render(page, `${JSON.stringify(sb)}\n\nabilities:${JSON.stringify(abilities)}`);
        assert.deepEqual(tsvRows(mixed), tsvRows(asObject), `${name}: mixed format differs for soul break ${sb.ability_id}`);
        checked++;
      }
    }
    assert.ok(checked > 0, `${name}: no soul breaks to check`);
  });
}
