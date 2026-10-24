import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadPage, pageScripts, JS_DIR } from './harness.mjs';

test('page scripts are extracted from both views', () => {
  assert.ok(pageScripts('ability_parser').length >= 1);
  // The decoder renders the shared constants partial before its own module.
  const decoder = pageScripts('status_decoder');
  assert.ok(decoder.length >= 2);
  assert.match(decoder[0].code, /window\.FFRK/);
});

const pageModules = fs.readdirSync(path.join(JS_DIR, 'pages')).filter(f => f.endsWith('.js'));

for (const file of pageModules) {
  const source = fs.readFileSync(path.join(JS_DIR, 'pages', file), 'utf8');

  test(`pages/${file} parses as an ES module`, () => {
    const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: source, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });

  test(`pages/${file}: inline handlers don't call module functions`, () => {
    // Module scope isn't global, so onclick="foo()" can't see the module's foo.
    const declared = new Set([...source.matchAll(/^(?:async\s+)?function\s+(\w+)|^(?:const|let|var)\s+(\w+)/gm)]
      .map(m => m[1] ?? m[2]));
    for (const [, body] of source.matchAll(/\son[a-z]+="([^"]*)"/g)) {
      // Only bare identifiers resolve to scope: skip string literals and property names (x.foo).
      const code = body.replace(/'[^']*'|`[^`]*`/g, "''");
      for (const [ident] of code.matchAll(/(?<![.\w$])[A-Za-z_$][\w$]*/g)) {
        assert.ok(!declared.has(ident), `inline handler uses module-scoped ${ident}: ${body.trim().slice(0, 80)}`);
      }
    }
  });
}

test('status decoder loads the snapshot and decodes a status', async () => {
  const page = await loadPage('status_decoder');
  const assignments = page.eval('Object.keys(DB.statusAssignments).length');
  assert.ok(assignments > 1000, `expected over 1000 status assignments, got ${assignments}`);

  const key = page.eval(`Object.keys(DB.statusAssignments).find(k => decodeStatus(k).decoded)`);
  assert.ok(key, 'no status key decoded');
  assert.equal(page.eval(`decodeStatus(${JSON.stringify(key)}).decoded`), true);
});

test('ability parser loads the snapshot and enables parsing', async () => {
  const page = await loadPage('ability_parser');
  assert.match(page.document.getElementById('li-battlejs-icon').className, /\bok\b/);
  assert.match(page.document.getElementById('li-sheets-icon').className, /\bok\b/);
  assert.equal(page.document.getElementById('parse-btn').disabled, false);
  assert.ok(page.eval('Object.keys(DB.soulStrikeCategories).length') > 20);
});

test('status decoder loads game data from battle.js', async () => {
  const page = await loadPage('status_decoder');
  for (let i = 0; i < 400 && !page.eval('DB.game'); i++) await new Promise(r => setTimeout(r, 25));
  assert.match(page.document.getElementById('li-game-icon').className, /\bok\b/);
  const id = page.eval(`DB.statusAilmentsForward.TACTICAL_AWAKE_MODE_GARLAND`);
  assert.match(page.eval(`formatGameParams(DB.game.statusParams[${id}])`), /Effect 2: REGISTER_SEQ_ABILITY_WHEN_ABILITY_DONE[\s\S]*repeatNum: 2/);
});
