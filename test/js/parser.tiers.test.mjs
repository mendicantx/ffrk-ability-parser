// The Ability Parser labels a soul break with no sheet row by its battle.js soul strike
// category (SOUL_STRIKE_TIER). When the game adds a category, this test fails until it
// gets a label, instead of new soul breaks quietly getting a blank Tier.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, snapshot } from './harness.mjs';

const { extractConstantMap } = await import('ffrk/battle_js');

test('every soul strike category in battle.js has a Tier label the sheet uses', async () => {
  const { battleJs, sheets } = snapshot();
  const categories = extractConstantMap(battleJs, 'SOUL_STRIKE_CATEGORY');
  assert.ok(Object.keys(categories).length > 20, 'SOUL_STRIKE_CATEGORY found in battle.js');

  const page = await loadPage('ability_parser', { gameData: false });
  const tiers = page.exports.SOUL_STRIKE_TIER;
  const sheetTiers = new Set(sheets.soul_breaks.map(r => r.Tier).filter(Boolean));

  for (const [key, id] of Object.entries(categories)) {
    assert.ok(tiers[id], `soul strike category ${id} (${key}) has no label in SOUL_STRIKE_TIER`);
    assert.ok(sheetTiers.has(tiers[id]), `category ${id} (${key}) is labelled "${tiers[id]}", which the Soul Breaks tab never uses`);
  }
});
