// Runs the snapshot's battle.js through app/javascript/ffrk/battle_runtime.js and
// checks the game data it exposes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { snapshot, runBattleJsInVm, ROOT } from './harness.mjs';

const underscoreJs = fs.readFileSync(path.join(ROOT, 'public/vendor/underscore-umd-1.13.7.min.js'), 'utf8');
const { conf, statusParams, errors } = await runBattleJsInVm(snapshot().battleJs, underscoreJs);
const statusId = key => conf.STATUS_AILMENTS_TYPE[key];
const effectType = name => conf.STATUS_AILMENTS_PARAM_EFFECT_TYPE[name];

test('battle.js builds without module errors', () => {
  assert.deepEqual(errors, []);
});

test('exposes the battle constant tables', () => {
  assert.ok(Object.keys(conf).length > 150, `only ${Object.keys(conf).length} Conf tables`);
  assert.equal(Object.keys(conf.STATUS_AILMENTS_TYPE).length, 7965);
  assert.equal(conf.ELEMENT_TYPE.WIND, 104);
});

test('reads real status configs for most statuses', () => {
  const count = Object.keys(statusParams).length;
  assert.ok(count > 6500, `only ${count} statuses have a config`);
});

test('status configs carry the game values', () => {
  const haste = statusParams[statusId('HASTE')];
  assert.deepEqual(haste.effects.map(e => [e.type, e.atbTimeFactor]), [[effectType('INCREASE_ATB_TIME_FACTOR'), 200]]);

  const aerith = statusParams[statusId('LEARNING_MODE_AERITH_BANSHO')];
  const damage = aerith.effects.find(e => e.type === effectType('INCREASE_EXECUTED_DAMAGE'));
  assert.deepEqual(damage.abilityCondition, { anyElementIds: [conf.ELEMENT_TYPE.WIND] });
  assert.deepEqual(damage.generalValueToAbilityDamageRateMap.map(m => m.damageFactor), [130, 125, 120, 115, 110, 105]);
});
