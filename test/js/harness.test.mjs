import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, pageScripts } from './harness.mjs';

test('page scripts are extracted from both views', () => {
  assert.ok(pageScripts('ability_parser').length >= 1);
  // The decoder also renders the shared constants partial before its own script.
  const decoder = pageScripts('status_decoder');
  assert.ok(decoder.length >= 2);
  assert.match(decoder[0], /window\.FFRK/);
});

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
