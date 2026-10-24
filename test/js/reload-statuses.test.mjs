// "Reload Status & Other tabs" re-fetches only those two sheets, so names just added to
// the sheet show up without a full refresh (which also re-fetches battle.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadPage, snapshot, FIXTURES } from './harness.mjs';

const fixture = name => fs.readFileSync(path.join(FIXTURES, 'battles', name), 'utf8');

// Serves POST /data/refresh and a Status tab with one extra row; records every request.
function reloadingFetch(original, extraStatusRow) {
  const requests = [];
  const fetch = async (url, options = {}) => {
    requests.push(`${options.method ?? 'GET'} ${url}`);
    if (String(url).startsWith('/data/refresh')) return { ok: true, status: 200, json: async () => ({ refresh_errors: {} }) };
    if (String(url).startsWith('/data/sheets')) {
      const body = { ...snapshot().sheets, status: [...snapshot().sheets.status, extraStatusRow], last_refreshed_at: '2026-01-01T00:00:00Z' };
      return { ok: true, status: 200, json: async () => body };
    }
    return original(url, options);
  };
  return { fetch, requests };
}

test('the parser reloads only the Status and Other tabs and re-parses with the new names', async () => {
  const page = await loadPage('ability_parser', { gameData: false });
  page.document.getElementById('json-input').value = fixture('seymour-xsb.txt');
  page.eval(`processBattleJson(document.getElementById('json-input').value)`);
  // Status 6116 has no Status-tab row in the snapshot.
  assert.match(page.document.getElementById('results').innerHTML, /status-missing[^>]*>\[ATK, MAG and MND \+15%, DEF and RES \+25% \(25s\)\]/);

  const { fetch, requests } = reloadingFetch(globalThis.fetch, { 'ID': '6116', 'Common Name': 'Test Name From Sheet', 'Effects': 'x', 'Default Duration': '25' });
  globalThis.fetch = fetch;
  page.document.getElementById('reload-statuses-btn').dispatch('click');
  const deadline = Date.now() + 10000;
  while (!page.document.getElementById('results').innerHTML.includes('Test Name From Sheet')) {
    if (Date.now() > deadline) assert.fail('the re-parse did not use the reloaded Status tab');
    await new Promise(r => setTimeout(r, 5));
  }

  assert.equal(requests[0], 'POST /data/refresh?sheets=status,other');
  assert.ok(!requests.some(r => r.includes('battle_js')), `battle.js was fetched again: ${requests.join(', ')}`);
  assert.doesNotMatch(page.document.getElementById('results').innerHTML, /status-missing[^>]*>\[Test Name From Sheet\]/);
});

test('the Status Decoder reloads only the Status and Other tabs, then the page', async () => {
  const page = await loadPage('status_decoder', { gameData: false });
  let reloaded = false;
  globalThis.location = { reload() { reloaded = true; } };
  const { fetch, requests } = reloadingFetch(globalThis.fetch, {});
  globalThis.fetch = fetch;
  page.document.getElementById('reload-statuses-btn').dispatch('click');
  const deadline = Date.now() + 10000;
  while (!reloaded) {
    if (Date.now() > deadline) assert.fail('the page was not reloaded');
    await new Promise(r => setTimeout(r, 5));
  }
  assert.deepEqual(requests, ['POST /data/refresh?sheets=status,other']);
});
