// Unit tests for the shared modules in app/javascript/ffrk.
import test from 'node:test';
import assert from 'node:assert/strict';
import './harness.mjs'; // registers the ffrk/* specifiers

// Dynamic imports: static ones would resolve before harness.mjs registers its hooks.
const { extractConstantMap, invert } = await import('ffrk/battle_js');
const { splitSheetsResponse } = await import('ffrk/server_data');

test('extractConstantMap merges every occurrence of a constant block', () => {
  const js = 'a={STATUS_AILMENTS_TYPE:{HASTE:10,PROTECT:20}};b={STATUS_AILMENTS_TYPE:{SHELL:30}};c={OTHER:{X:1}}';
  assert.deepEqual(extractConstantMap(js, 'STATUS_AILMENTS_TYPE'), { HASTE: 10, PROTECT: 20, SHELL: 30 });
});

test('extractConstantMap skips nested braces and returns {} when missing', () => {
  assert.deepEqual(extractConstantMap('x={ELEMENT_TYPE:{FIRE:100,NESTED:{ICE:101},WIND:102}}', 'ELEMENT_TYPE'),
                   { FIRE: 100, ICE: 101, WIND: 102 });
  assert.deepEqual(extractConstantMap('nothing here', 'ELEMENT_TYPE'), {});
});

test('invert swaps keys and values', () => {
  assert.deepEqual(invert({ FIRE: 100, ICE: 101 }), { 100: 'FIRE', 101: 'ICE' });
});

test('splitSheetsResponse separates the refresh time from the sheets', () => {
  const { sheets, lastRefreshedAt } = splitSheetsResponse({ status: [{ ID: '1' }], last_refreshed_at: '2026-01-01T00:00:00Z' });
  assert.deepEqual(sheets, { status: [{ ID: '1' }] });
  assert.equal(lastRefreshedAt, '2026-01-01T00:00:00Z');
  assert.equal(splitSheetsResponse({}).lastRefreshedAt, null);
});

const { realmName, REALM_NAMES } = await import('ffrk/names');

test('realm names match the Soul Breaks sheet Realm column', () => {
  assert.equal(realmName('FF7'), 'VII');
  assert.equal(realmName('FF16'), 'XVI');
  assert.equal(realmName('FF_TYPE0'), 'Type-0');
  assert.equal(realmName('FF_GAIDEN'), 'Beyond');
  assert.equal(realmName('JOB'), 'Core');
  assert.equal(realmName('NEW_SERIES'), 'NEW_SERIES');
});

test('every realm name is a value used in the Soul Breaks sheet', async () => {
  const { snapshot } = await import('./harness.mjs');
  const realms = new Set(snapshot().sheets.soul_breaks.map(r => r.Realm));
  for (const name of Object.values(REALM_NAMES)) assert.ok(realms.has(name), `${name} is not a Realm in the sheet`);
});
