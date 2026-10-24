// Ability Parser page script, loaded as an ES module by
// app/views/ability_parser/index.html.erb via javascript_import_module_tag.

import { extractConstantMap, invert } from 'ffrk/battle_js';
import { refreshServerData, splitSheetsResponse } from 'ffrk/server_data';
import { realmName } from 'ffrk/names';

// ─── Data stores ────────────────────────────────────────────────────────────
let rawBattleJs = null;

const DB = {
  // battle.js reverse-lookup maps: ID (number) → name (string)
  elementTypes:       {},   // ELEMENT_TYPE
  exerciseTypes:      {},   // EXERCISE_TYPE
  abilityCategories:  {},   // ABILITY_CATEGORY_ID
  chainTypes:         {},   // COMBO_CONDITION_TYPE
  atkTypes:           {},   // ATK_TYPE
  targetRange:        {},   // TARGET_RANGE
  targetMethod:       {},   // TARGET_METHOD
  targetSegment:      {},   // TARGET_SEGMENT
  activeTargetMethod: {},   // ACTIVE_TARGET_METHOD
  subActionType:      {},   // SUB_ACTION_TYPE
  subActionTargetType:{},   // SUB_ACTION_TARGET_TYPE
  conditionTypes:     {},   // SUB_ACTION_CONDITION_TYPE
  controlStatementTypes:{}, // SUB_ACTION_CONTROL_STATEMENT_TYPE
  statusAilments:     {},   // STATUS_AILMENTS_TYPE  id → coded name
  statusBundles:      {},   // STATUS_AILMENTS_BUNDLE id → coded name
  bundleContents:     {},   // bundle_id → [status_id, ...]
  jobIds:             {},   // JOB_ID id → key (e.g. 600013 → 'WARRIOR_I')
  seriesIds:          {},   // SERIES_ID id → key (e.g. 108001 → 'FF8')
  soulStrikeCategories: {}, // SOUL_STRIKE_CATEGORY id → name

  abilityIdOf:        {},   // ABILITY_ID_OF: key → numeric id
  chaseAbilityIdToKey:{},   // numeric chase ability id → 'CHASE_ABILITY_FOR_...' key
  // Sheet data
  statusMap:     {},   // id (number) → { commonName, effects, duration }
  actionMap:     [],   // array of row objects {action_id, className, arg1..arg30}
  soulBreaksMap:      {},   // id (number) → soul break row
  soulBreakWeaponSkillMap: {}, // id (number) → a Tactical soul break's "(Weapon Skill)" row
  charactersMap:      {},   // id (number) → character row { Name, Realm, ... }
  otherMap:           [],   // array of other rows
  otherNameMap:       {},   // other ability id → name
  heroAbilitiesMap:   {},   // id (number) → hero ability row
  heroAbilityNameMap: {},   // id (number) → Name string
  extraMap:           {},   // id (number) → Extra sheet row
};

// ─── Utilities ──────────────────────────────────────────────────────────────
function setLoadState(key, state, detail) {
  const icon = document.getElementById(`li-${key}-icon`);
  const det  = document.getElementById(`li-${key}-detail`);
  icon.className = `load-icon ${state}`;
  icon.textContent = state === 'loading' ? '●' : state === 'ok' ? '✓' : state === 'err' ? '✗' : '○';
  if (detail !== undefined) det.textContent = detail;
}

function checkAllLoaded() {
  const allOk = ['battlejs','sheets']
    .every(k => document.getElementById(`li-${k}-icon`).classList.contains('ok'));
  document.getElementById('parse-btn').disabled = !allOk;
}

// ─── Load battle.js and extract constants ────────────────────────────────────
async function loadBattleJs() {
  setLoadState('battlejs', 'loading', 'fetching…');
  try {
    const resp = await fetch('/data/battle_js');
    if (!resp.ok) throw new Error(resp.status === 503 ? 'no cached data — run rake data:refresh' : `HTTP ${resp.status}`);
    rawBattleJs = await resp.text();
    const js = rawBattleJs;
    setLoadState('battlejs', 'loading', 'extracting constants…');

    const consts = [
      'ELEMENT_TYPE', 'EXERCISE_TYPE', 'ABILITY_CATEGORY_ID', 'COMBO_CONDITION_TYPE',
      'ATK_TYPE', 'TARGET_RANGE', 'TARGET_METHOD', 'TARGET_SEGMENT', 'ACTIVE_TARGET_METHOD',
      'SUB_ACTION_TYPE', 'SUB_ACTION_TARGET_TYPE', 'SUB_ACTION_CONDITION_TYPE',
      'SUB_ACTION_CONTROL_STATEMENT_TYPE', 'STATUS_AILMENTS_TYPE', 'STATUS_AILMENTS_BUNDLE',
      'JOB_ID', 'SERIES_ID', 'SOUL_STRIKE_CATEGORY',
    ];
    const maps = {};
    for (const c of consts) maps[c] = extractConstantMap(js, c);

    DB.elementTypes        = invert(maps.ELEMENT_TYPE);
    DB.exerciseTypes       = invert(maps.EXERCISE_TYPE);
    DB.abilityCategories   = invert(maps.ABILITY_CATEGORY_ID);
    DB.chainTypes          = invert(maps.COMBO_CONDITION_TYPE);
    DB.atkTypes            = invert(maps.ATK_TYPE);
    DB.targetRange         = invert(maps.TARGET_RANGE);
    DB.targetMethod        = invert(maps.TARGET_METHOD);
    DB.targetSegment       = invert(maps.TARGET_SEGMENT);
    DB.activeTargetMethod  = invert(maps.ACTIVE_TARGET_METHOD);
    DB.subActionType       = invert(maps.SUB_ACTION_TYPE);
    DB.subActionTargetType = invert(maps.SUB_ACTION_TARGET_TYPE);
    DB.conditionTypes      = invert(maps.SUB_ACTION_CONDITION_TYPE);
    DB.controlStatementTypes = invert(maps.SUB_ACTION_CONTROL_STATEMENT_TYPE);
    DB.statusAilments      = invert(maps.STATUS_AILMENTS_TYPE);
    DB.statusBundles       = invert(maps.STATUS_AILMENTS_BUNDLE);
    DB.jobIds              = invert(maps.JOB_ID);
    DB.seriesIds           = invert(maps.SERIES_ID);
    DB.soulStrikeCategories = invert(maps.SOUL_STRIKE_CATEGORY);
    DB.abilityIdOf         = extractConstantMap(js, 'ABILITY_ID_OF');
    DB.chaseAbilityIdToKey = {};
    DB.bundleContents      = {};
    for (const [k, v] of Object.entries(DB.abilityIdOf)) {
      if (k.startsWith('CHASE_ABILITY_FOR_')) DB.chaseAbilityIdToKey[v] = k;
    }

    // Extract bundle contents from StatusAilmentsConfig.setBundle calls
    // Pattern: setBundle(BUNDLE_ID,[id1,id2,...])
    for (const m of js.matchAll(/\.setBundle\s*\(\s*(\d+)\s*,\s*\[([^\]]+)\]/g)) {
      const bundleId = parseInt(m[1]);
      const ids = m[2].match(/\d+/g)?.map(Number) ?? [];
      if (ids.length) DB.bundleContents[bundleId] = ids;
    }

    const totalConsts = Object.values(maps).reduce((s, m) => s + Object.keys(m).length, 0);
    setLoadState('battlejs', 'ok', `${totalConsts} constants, ${Object.keys(DB.bundleContents).length} bundles`);
  } catch(e) {
    setLoadState('battlejs', 'err', e.message);
  }
  checkAllLoaded();
}

// ─── Load Sheet data from server ─────────────────────────────────────────────
async function loadSheets() {
  setLoadState('sheets', 'loading', 'fetching…');
  try {
    const resp = await fetch('/data/sheets');
    const raw = await resp.json();
    if (raw.error) throw new Error(raw.error);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const { sheets: data, lastRefreshedAt } = splitSheetsResponse(raw);

    // Start from empty maps so a reload never keeps rows removed from the sheet.
    DB.statusMap = {};
    DB.soulBreaksMap = {};
    DB.otherNameMap = {};
    DB.charactersMap = {};

    const statusRows       = data.status           || [];
    const actionRows       = data.action_args      || [];
    const sbRows           = data.soul_breaks      || [];
    const otherRows        = data.other            || [];
    const characterRows    = data.characters       || [];
    const heroAbilityRows  = data.hero_abilities   || [];
    const extraRows        = data.extra            || [];

    // Status map: id → { commonName, effects, duration }
    for (const r of statusRows) {
      const id = parseInt(r['ID']);
      if (!isNaN(id)) DB.statusMap[id] = { commonName: r['Common Name'], effects: r['Effects'], duration: r['Default Duration'] };
    }

    // Action map: array as-is
    DB.actionMap = actionRows;

    // Soul breaks map: ID → row
    // A Tactical soul break has two rows with the same ID: the mode and its
    // "(Weapon Skill)" row (docs/decisions.md "Tactical soul breaks").
    DB.soulBreakWeaponSkillMap = {};
    for (const r of sbRows) {
      const id = parseInt(r['ID']);
      if (isNaN(id)) continue;
      if (/\(Weapon Skill\)\s*$/.test(r['Name'] ?? '')) DB.soulBreakWeaponSkillMap[id] = r;
      else DB.soulBreaksMap[id] = r;
    }

    // Other sheet: keep as array and build id → name lookup
    DB.otherMap = otherRows;
    for (const r of otherRows) {
      const id = parseInt(r['ID']);
      if (!isNaN(id) && r['Name']) DB.otherNameMap[id] = r['Name'];
    }

    // Characters map: ID → row
    for (const r of characterRows) {
      const id = parseInt(r['ID']);
      if (!isNaN(id)) DB.charactersMap[id] = r;
    }

    // Hero Abilities map: ID → row + name lookup
    DB.heroAbilitiesMap = {};
    DB.heroAbilityNameMap = {};
    for (const r of heroAbilityRows) {
      const id = parseInt(r['ID']);
      if (!isNaN(id)) {
        DB.heroAbilitiesMap[id] = r;
        if (r['Name']) DB.heroAbilityNameMap[id] = r['Name'];
      }
    }

    // Extra sheet map: ID → row
    DB.extraMap = {};
    for (const r of extraRows) {
      const id = parseInt(r['ID']);
      if (!isNaN(id)) DB.extraMap[id] = r;
    }

    const refreshed = lastRefreshedAt ? ` · refreshed ${new Date(lastRefreshedAt).toLocaleString()}` : '';
    setLoadState('sheets', 'ok',
      `status:${statusRows.length} actions:${actionRows.length} sb:${sbRows.length} other:${otherRows.length} chars:${characterRows.length} hero:${heroAbilityRows.length} extra:${extraRows.length}${refreshed}`);
  } catch(e) {
    setLoadState('sheets', 'err', e.message);
  }
  checkAllLoaded();
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

// Local supplement for action_ids whose rows exist in the community sheet but whose action_id
// cell is dropped by the gviz CSV export (known gviz bug for late-sheet rows).
// Values copied directly from the sheet.
const ACTION_ARG_SUPPLEMENTS = {
  // 235 — CrystalShingiAction
  235: {
    arg1: 'wrappedAbilityId', arg2: 'crystalForceAbilityId', arg3: 'crystalForceAbilityId',
    arg11: 'attachElementLevel', arg12: 'attachElementAddMaxLevel',
    arg13: 'possibleAttachElement', arg14: 'possibleAttachElement', arg15: 'possibleAttachElement',
    arg16: 'possibleAttachElement', arg17: 'possibleAttachElement', arg18: 'possibleAttachElement',
    arg19: 'possibleAttachElement', arg20: 'possibleAttachElement', arg21: 'possibleAttachElement',
  },
  // 236 — CutinAbilityAction
  236: { arg1: 'wrappedAbilityId', arg2: 'cutinAbilityId' },
  // 239 — MasterShingiAction: arg2 is the follow-up cast when Master Mode ends ("North Star: …")
  239: { arg2: 'masterFinishAbilityId' },
};

function getActionFormula(actionId) {
  const fromSheet = DB.actionMap.find(r => String(r.action_id).replace('!','') === String(actionId));
  const supplement = ACTION_ARG_SUPPLEMENTS[Number(actionId)];
  if (!fromSheet) return supplement ?? null;
  if (!supplement) return fromSheet;
  // The sheet row wins; the supplement only fills arg names the sheet leaves blank.
  const merged = { ...fromSheet };
  for (const [arg, name] of Object.entries(supplement)) if (!merged[arg]) merged[arg] = name;
  return merged;
}

function lookupStatus(id) {
  const codedName = DB.statusAilments[id];
  const sheetInfo = DB.statusMap[id];
  return {
    id,
    codedName: codedName ?? `STATUS_${id}`,
    commonName: sheetInfo?.commonName ?? null,
    effects:    sheetInfo?.effects    ?? null,
    duration:   sheetInfo?.duration   ?? null,
  };
}

function expandBundle(bundleId) {
  const contents = DB.bundleContents[bundleId] ?? [];
  return contents.map(id => lookupStatus(id));
}

function resolveStatuses(idOrIds) {
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  const statuses = [];
  for (const id of ids.map(Number)) {
    if (DB.bundleContents[id]) {
      statuses.push(...expandBundle(id).map(s => ({ ...s, fromBundle: id })));
    } else {
      statuses.push(lookupStatus(id));
    }
  }
  return statuses;
}

// A Buster's Soul Breaks row describes its first use (Break Glint), whose own SB cost is
// in buster_shingi_abilities[0]; the Buster's consume_point is the later uses' cost.
function busterFirstUseCost(opts) {
  const firstUse = opts.buster_shingi_abilities?.[0]?.relational_ability;
  return firstUse && firstUse.consume_point !== undefined ? Number(firstUse.consume_point) : null;
}

// Sheet display name for an ability category: BLACK_MAGIC → "Black Magic".
function schoolName(category) {
  if (!category) return '';
  return String(category).toLowerCase().split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Name of the status whose chase ability this is (CHASE_ABILITY_FOR_<status key>), from
// the Status sheet — e.g. "Buster Chase Mode: Warrior of Light".
function chaseSourceName(abilityId) {
  const chaseKey = DB.chaseAbilityIdToKey[parseInt(abilityId)];
  if (!chaseKey) return '';
  const statusKey = chaseKey.replace(/^CHASE_ABILITY_FOR_/, '');
  const statusId = Object.keys(DB.statusAilments).find(id => DB.statusAilments[id] === statusKey);
  return DB.statusMap[statusId]?.commonName || '';
}

// Other-tab name for a Tactical Awoken Mode's TP MAX follow-up, as the sheet names
// them: "TPMAX<Character>" (e.g. "TPMAXGarland").
function tpMaxName(source) {
  const m = /^Tactical Awoken Mode: (.+)$/.exec(source ?? '');
  return m ? `TPMAX${m[1]}` : '';
}

// SB Ver: the sheet's value when the soul break has a row; otherwise the tier plus the
// next version number for that character (e.g. "Buster2" after "Buster1").
function soulBreakVersion(sbRow, character, tier) {
  if (sbRow?.['SB Ver']) return sbRow['SB Ver'];
  if (!tier) return '';
  const used = new Set(Object.values(DB.soulBreaksMap)
    .filter(r => r['Character'] === character && r['Tier'] === tier && r['SB Ver'])
    .map(r => r['SB Ver']));
  return `${tier}${used.size + 1}`;
}

function chaseAbilityName(codedName) {
  if (!codedName) return null;
  const id = DB.abilityIdOf['CHASE_ABILITY_FOR_' + codedName];
  return id ? (DB.otherNameMap[id] ?? null) : null;
}

function statusEffectsText(s) {
  let effects = s.effects ?? '';
  const chaseName = chaseAbilityName(s.codedName);
  if (chaseName) {
    effects = effects
      .replace(/,?\s*triggers? (?:a )?(?:crystal force )?chase abilit\w*/gi, '')
      .replace(/,\s*$/, '').trimEnd()
      + `. Triggers [${chaseName}] after using Crystal Force abilities (max 2)`;
  }
  return effects;
}

function statusTag(s) {
  const name    = s.commonName ? `[${s.commonName}]` : `[${s.codedName}]`;
  const effects = statusEffectsText(s);
  return `<span class="tag status" title="${effects.replace(/"/g, '&quot;')}">${name}</span>`;
}

function elementTag(name) {
  return `<span class="tag elem">${name}</span>`;
}

// DENA arg parser — newline-separated "key: value" pairs, with nested { } blocks
function parseDenaArg(str) {
  if (!str || !str.trim()) return {};
  const lines = str.trim().split(/\r?\n/);
  const result = {};
  let i = 0;

  function parseScalar(s) {
    s = s.trim();
    if (s === 'true')  return true;
    if (s === 'false') return false;
    if (s !== '' && !isNaN(s)) return Number(s);
    // inline array or object literal — try JSON parse
    if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'))) {
      try { return JSON.parse(s); } catch {}
    }
    return s;
  }

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line === '}') { i++; continue; }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) { i++; continue; }

    const key      = line.slice(0, colonIdx).trim();
    const valueStr = line.slice(colonIdx + 1).trim();

    if (valueStr === '{' || (valueStr.startsWith('{') && !valueStr.endsWith('}'))) {
      // Multi-line block — collect until balanced closing brace
      let depth = 0;
      for (const ch of valueStr) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      const blockLines = [valueStr];
      i++;
      while (i < lines.length && depth > 0) {
        const l = lines[i];
        for (const ch of l) { if (ch === '{') depth++; else if (ch === '}') depth--; }
        blockLines.push(l.trim());
        i++;
      }
      // Strip outer { } and recurse
      const inner = blockLines.join('\n').replace(/^\s*\{/, '').replace(/\}\s*$/, '').trim();
      result[key] = inner ? parseDenaArg(inner) : {};
    } else {
      result[key] = parseScalar(valueStr);
      i++;
    }
  }
  return result;
}

// ─── Core ability parser ─────────────────────────────────────────────────────
function parseAbility(ability, allAbilities, parsedSet) {
  if (parsedSet.has(ability.ability_id)) return null;
  parsedSet.add(ability.ability_id);

  const opts = ability.options ?? {};
  const formula = getActionFormula(ability.action_id);

  const result = {
    abilityId:    ability.ability_id,
    actionId:     ability.action_id,
    name:         opts.name ? (() => { try { return decodeURIComponent(opts.name.replace(/\+/g, ' ')); } catch(e) { return opts.name; } })() : 'Attack',
    exerciseType: DB.exerciseTypes[ability.exercise_type] ?? String(ability.exercise_type),
    category:     DB.abilityCategories[ability.category_id] ?? null,
    castTime:          opts.cast_time ? (opts.cast_time / 1000).toFixed(2) : null,
    sbCharge:          opts.ss_point ? Number(opts.ss_point) : 0,
    sbCost:            busterFirstUseCost(opts) ?? (opts.consume_point != null && opts.consume_point !== '' ? Number(opts.consume_point) : null),
    soulStrikeCategory:Number(opts.soul_strike_category_id) || null,
    nameJp:            opts.alias_name || opts.disp_name || null,
    counterable:       Number(opts.counter_enable) !== 0 ? 'Yes' : 'No',
    kiwamiAbilityId:               Number(ability.kiwamiAbilityId)         > 0 ? Number(ability.kiwamiAbilityId)         : null,
    replacePersonalAbilityId:      Number(ability.replacePersonalAbilityId) > 0 ? Number(ability.replacePersonalAbilityId) : null,
    extraZetsugiPersonalAbilityIds: [],  // populated below for EXTRA_ZETSUGI soul strikes
    attachElementLevel:       null,   // populated by formula switch (attachElementLevel arg type)
    attachElementAddMaxLevel: null,   // populated by formula switch (attachElementAddMaxLevel arg type)
    attachElements:           [],     // populated by formula switch (possibleAttachElement arg type)
    target: {
      range:  DB.targetRange[opts.target_range]         ?? opts.target_range,
      method: DB.targetMethod[opts.target_method]       ?? opts.target_method,
      segment:DB.targetSegment[opts.target_segment]     ?? opts.target_segment,
      active: DB.activeTargetMethod[opts.active_target_method] ?? opts.active_target_method,
    },
    formulaClass: formula?.className ?? formula?.classname ?? null,
    elements:     [],
    statuses:     [],
    removeStatuses:[],
    subAbilities: [],
    subActions:   [],
    props:        {},   // misc named props
    unknownArgs:  [],
    actionArgs:   [],   // raw [{argNum, type, value}] from action_args sheet
  };

  // Default status from options.status_ailments_id
  if (opts.status_ailments_id && Number(opts.status_ailments_id) > 0) {
    const statuses = resolveStatuses([Number(opts.status_ailments_id)]);
    const chance = Number(opts.status_ailments_factor ?? 0);
    result.statuses.push(...statuses.map(s => ({
      ...s,
      target: 'default',
      hitChance: chance,
      autoHit: chance === 998,
    })));
  }

  if (formula) {
    // Walk formula args
    for (let argNum = 1; argNum <= 30; argNum++) {
      const argKey = `arg${argNum}`;
      const argType = formula[argKey];
      if (!argType || argType === '-') continue;
      const rawVal = opts[argKey];
      if (rawVal === undefined || rawVal === '' || rawVal === null) continue;
      const numVal = Number(rawVal);

      switch (argType) {
        case 'damageFactor':
          if (numVal > 0) result.props.multiplier = numVal / 100;
          break;
        case 'physicalAttackDamageFactor':
          if (numVal > 0) result.props.physMultiplier = numVal;
          break;
        case 'magicalAttackDamageFactor':
          if (numVal > 0) result.props.magMultiplier = numVal;
          break;
        case 'factor':
          if (numVal > 0) result.props.healingFactor = numVal;
          break;
        case 'hpFactor':
          if (numVal > 0) result.props.removesKO = numVal;
          break;
        case 'atkElement':
        case 'matkElement':
        case 'args (elements)':
          if (numVal > 0) {
            const elemName = fmtElement(DB.elementTypes[numVal] ?? '');
            if (elemName && !result.elements.includes(elemName)) result.elements.push(elemName);
          }
          break;
        case 'atkExponentialFactor':
          if (numVal > 0) result.props.defPierce = numVal;
          break;
        case 'matkExponentialFactor':
          if (numVal > 0) result.props.resPierce = numVal;
          break;
        case 'atkType':
          if (numVal > 0) result.props.range = DB.atkTypes[numVal] ?? numVal;
          break;
        case 'barrageNum':
          if (numVal > 0) result.props.hits = numVal;
          break;
        case 'criticalRatio':
        case 'critical':
          if (numVal > 0) result.props.critRate = numVal;
          break;
        case 'damageRate':
          if (numVal > 0) {
            if (Number(opts['useMaxHp']) === 1) result.props.maxHpDamage = numVal;
            else result.props.currentHpDamage = numVal;
          }
          break;
        case 'fixedDamage':
          if (numVal > 0) result.props.fixedDamage = numVal;
          break;
        case 'minDamageFactor':
          if (numVal > 0) result.props.minDamageFactor = numVal;
          break;
        case 'barterRate':
          if (numVal > 0) result.props.hpCostPercent = numVal;
          break;
        case 'isSameTarget':
          if (numVal === 0) result.props.randomTarget = true;
          break;
        case 'absorbHpFactor':
          if (numVal > 0) result.props.lifesteal = (numVal / 10).toFixed(1);
          break;
        case 'forceHit':
          if (numVal === 1) result.props.autoHit = true;
          break;
        case 'ignoresStatusAilmentsBarrierArg':
          if (numVal > 0) result.props.ignoresAstra = true;
          break;
        case 'ignoresMirageAndMightyGuardArg':
          if (numVal > 0) { result.props.ignoresPhysBlink = true; result.props.ignoresMagBlink = true; }
          break;
        case 'ignoresReflectionArg':
          if (numVal > 0) result.props.ignoresReflect = true;
          break;
        case 'deathRate':
          if (numVal > 0) result.props.selfKOChance = numVal;
          break;
        case 'fixedHp':
          if (numVal > 0) result.props.fixedHeal = numVal;
          break;
        case 'comboType':
          if (numVal > 0) result.props.chainType = DB.chainTypes[numVal] ?? numVal;
          break;
        case 'comboCondition':
          if (numVal > 0) result.props.chainElement = DB.elementTypes[numVal] ?? numVal;
          break;
        case 'boostCoefficient':
          if (numVal > 0) result.props.chainFieldBoost = numVal > 100 ? numVal - 100 : numVal;
          break;
        case 'comboMaxNum':
          if (numVal > 0) result.props.chainMaxCount = numVal;
          break;
        case 'synchroAbilityId1':
          if (numVal > 0) result.props.synchroAbility1 = numVal;
          break;
        case 'synchroAbilityId2':
          if (numVal > 0) result.props.synchroAbility2 = numVal;
          break;
        case 'burstAbilityArgs':
        case 'wrappedAbilityId':
        case 'defaultAbility':
        case 'defaultAbilityId':
        case 'tpMaxAbilityId':
        case 'weaponSkillAbilityId':
        case 'repeatSkillAbilityId':
        case 'abilityId': {
          if (numVal > 0) {
            const sub = allAbilities.find(a => a.ability_id == rawVal);
            if (sub) {
              const parsed = parseAbility(sub, allAbilities, parsedSet);
              if (parsed) { parsed._label = argType; result.subAbilities.push(parsed); }
            }
          }
          break;
        }
        // Status-inflicting args
        case 'atkSa':
        case 'args':
        case 'args (setSa)':
        case 'bundleArgs':
        case 'bundleArgs (setSa)':
        case 'statusId':
        case 'makeStatusAilments':
        case 'id':
        case 'opponentStatusAilments':
        case 'statusAilmentsId': {
          if (numVal > 0) {
            const statuses = resolveStatuses([numVal]);
            result.statuses.push(...statuses.map(s => ({ ...s, target: 'default' })));
          }
          break;
        }
        case 'atkStatusAilments':
        case 'selfStatusAilments':
        case 'selfBundleAilments':
        case 'selfSaIds':
        case 'selfSaId':
        case 'optionalSelfSaId': {
          if (numVal > 0) {
            const statuses = resolveStatuses([numVal]);
            result.statuses.push(...statuses.map(s => ({ ...s, target: 'SELF' })));
          }
          break;
        }
        case 'partyStatusAilments': {
          if (numVal > 0) {
            const statuses = resolveStatuses([numVal]);
            result.statuses.push(...statuses.map(s => ({ ...s, target: 'ALL' })));
          }
          break;
        }
        case 'attachElementLevel':
          if (numVal > 0) result.attachElementLevel = numVal;
          break;
        case 'attachElementAddMaxLevel':
          if (numVal > 0) result.attachElementAddMaxLevel = numVal;
          break;
        case 'possibleAttachElement':
          if (numVal > 0) result.attachElements.push(numVal);
          break;
        case 'duration':
          if (numVal > 0) result.props.statusDuration = (numVal / 1000).toFixed(1) + 's';
          break;
        case 'rate':
        case 'boost':
        case 'value':
        case 'amount':
          if (rawVal) result.props[argType] = rawVal;
          break;
        default:
          if (rawVal && rawVal !== '0') result.unknownArgs.push({ type: argType, value: rawVal });
      }
    }
  }

  // Collect action args for display: scan all opts.arg1..arg30 with non-zero values.
  // Type labels come from the formula where available; shown as plain argN otherwise.
  for (let argNum = 1; argNum <= 30; argNum++) {
    const argKey  = `arg${argNum}`;
    const rawVal  = opts[argKey];
    if (rawVal === undefined || rawVal === null || rawVal === '' || rawVal === '0' || rawVal === 0) continue;
    const argType = formula?.[argKey];
    result.actionArgs.push({ argNum, type: (argType && argType !== '-') ? argType : null, value: rawVal });
  }

  // Fallback: some game data stores attach element info as top-level named fields
  // rather than (or in addition to) positional options args.
  if (result.attachElementLevel == null && Number(ability.attachElementLevel) > 0)
    result.attachElementLevel = Number(ability.attachElementLevel);
  if (result.attachElementAddMaxLevel == null && Number(ability.attachElementAddMaxLevel) > 0)
    result.attachElementAddMaxLevel = Number(ability.attachElementAddMaxLevel);
  if (result.attachElements.length === 0 && ability.possibleAttachElement != null) {
    const pae = ability.possibleAttachElement;
    (Array.isArray(pae) ? pae : [pae]).forEach(id => { if (Number(id) > 0) result.attachElements.push(Number(id)); });
  }

  // Heuristic: scan all option args for unlinked companion ability references.
  // Player ability IDs are 8-digit numbers (≥ 10,000,000); status/bundle IDs are much smaller.
  //
  // IMPORTANT: use a private copy of parsedSet so that companion abilities found
  // here are NOT removed from the actor-level abilities display.  Only abilities
  // consumed via the formula switch above are "owned" by the shared parsedSet.
  const heuristicSeen = new Set(parsedSet);
  for (let argNum = 1; argNum <= 30; argNum++) {
    const rawVal = opts[`arg${argNum}`];
    if (!rawVal || rawVal === '0') continue;
    const numVal = Number(rawVal);
    if (numVal < 10000000) continue;
    const sub = allAbilities.find(a => a.ability_id == rawVal);
    if (!sub) continue;
    const parsed = parseAbility(sub, allAbilities, heuristicSeen);
    if (!parsed) continue;
    const argTypeName = formula?.[`arg${argNum}`];
    parsed._label = argTypeName && argTypeName !== '-' ? argTypeName : `arg${argNum}`;
    result.subAbilities.push(parsed);
  }

  // Sub-actions
  if (ability.sub_actions) {
    for (const sa of ability.sub_actions) {
      const subArgs = parseDenaArg(sa.arg);
      const sub = {
        type:           DB.subActionType[parseInt(sa.type)]           ?? sa.type,
        target:         DB.subActionTargetType[parseInt(sa.target_type)] ?? sa.target_type,
        targetArgRaw:   sa.target_arg || '',
        processOrder:   parseInt(sa.process_order) || 0,
        conditionType:  DB.conditionTypes[parseInt(sa.condition_type)] ?? null,
        controlType:    DB.controlStatementTypes[parseInt(sa.control_statement_type)] ?? null,
        controlTypeRaw: parseInt(sa.control_statement_type) || 0,
        conditionArg:   sa.condition_arg,
        partyCondition: null,
        elements:       [],
        statuses:       [],
        props:          {},
        synchroConditions: [],
      };

      for (const [k, v] of Object.entries(subArgs)) {
        switch (k) {
          case 'factor':
            // HEAL_HP (type 7) stores the healing factor raw; all other types store per-hit damage factor (/100).
            if (sub.type === 'HEAL_HP' || String(sa.type) === '7') {
              sub.props.healFactor = Number(v);
            } else {
              sub.props.multiplier = Number(v) / 100;
            }
            break;
          case 'factorForHealHp':
            sub.props.healingMultiplier = Number(v);
            break;
          case 'hitNum':
            sub.props.hits = Number(v);
            break;
          case 'criticalRate':
            sub.props.critRate = Number(v);
            break;
          case 'elementId':
            { const en = fmtElement(DB.elementTypes[Number(v)] ?? ''); if (en) sub.elements.push(en); }
            break;
          case 'elementIds':
            for (const eid of (Array.isArray(v) ? v : [v])) {
              const en = fmtElement(DB.elementTypes[Number(eid)] ?? ''); if (en) sub.elements.push(en);
            }
            break;
          case 'saId':
          case 'saIds': {
            const ids = Array.isArray(v) ? v : [v];
            sub.statuses.push(...resolveStatuses(ids.map(Number)));
            break;
          }
          case 'shouldHitForcely':
            if (Number(v) === 1) sub.props.autoHit = true;
            break;
          case 'shouldEnableOverflow':
            if (Number(v) === 1) sub.props.overflow = true;
            break;
          case 'rateOfHp':
            sub.props.currentHpBarter = Number(v);
            break;
          case 'rateOfMaxHp':
            sub.props.maxHpBarter = Number(v);
            break;
          case 'damageThresholdLv':
            sub.props.damageCapBoost = Number(v) * 10000;
            break;
          case 'secondaryDamageThresholdLv':
            sub.props.secondaryDamageThresholdLv = Number(v);
            break;
          case 'shouldIgnoreDefAndMdef':
            if (Number(v) === 1) sub.props.piercing = true;
            break;
          case 'shouldIgnoreReflection':
            if (Number(v) === 1) sub.props.ignoresReflection = true;
            break;
          case 'isIndirectAttack':
            sub.props.ranged = true;
            break;
          case 'isFlightAttack':
            sub.props.jump = true;
            break;
          case 'partyCondition':
            sub.partyCondition = v;
            break;
          case 'maxLv':
            sub.props.maxLevel = Number(v);
            break;
          case 'increaseLv':
            sub.props.attachIncreaseLv = Number(v);
            break;
          case 'option':
            if (v?.synchroConditions) {
              for (const [slotKey, cond] of Object.entries(v.synchroConditions)) {
                const conditions = [];
                const catIds = cond.categoryIds ?? (cond.categoryId ? [cond.categoryId].flat() : []);
                const elemIds = cond.elementIds ?? (cond.elementId ? [cond.elementId].flat() : []);
                catIds.forEach(id => { const n = DB.abilityCategories[id]; if (n) conditions.push(n); });
                elemIds.forEach(id => { const n = fmtElement(DB.elementTypes[id] ?? ''); if (n) conditions.push(n); });
                sub.synchroConditions.push({ slot: Number(slotKey), conditions });
              }
            }
            if (v?.increaseLevel != null) sub.isStateLevelIncrement = true;
            break;
        }
      }

      result.subActions.push(sub);
    }
  }

  // For EXTRA_ZETSUGI soul strikes, store the personal (hero) ability IDs from
  // arg4/6/8/10/12 directly — they are not in allAbilities so the heuristic scan misses them.
  if (Number(opts.soul_strike_category_id) === 27) {
    for (const argKey of ['arg4','arg6','arg8','arg10','arg12']) {
      const id = parseInt(opts[argKey] ?? 0);
      if (id > 0) result.extraZetsugiPersonalAbilityIds.push(id);
    }
  }

  return result;
}

// ─── Element display name (shared across parser and renderer) ────────────────
// Maps battle.js ELEMENT_TYPE keys → EN display names where they differ from simple title-case.
const ELEMENT_NAME_CORRECTIONS = {
  THUNDER:  'Lightning',
  DARKNESS: 'Dark',
  SOIL:     'Earth',
};

// Title-case the raw ELEMENT_TYPE key; apply EN corrections and non-elemental normalisation.
function fmtElement(name) {
  if (!name) return '';
  const up = name.toUpperCase();
  if (up === 'NOTHING' || up === 'NON_ELEMENTAL' || up === 'NONELEMENTAL' || up === 'NE' || up === 'NON') return 'NE';
  if (ELEMENT_NAME_CORRECTIONS[up]) return ELEMENT_NAME_CORRECTIONS[up];
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

// Resolve a numeric element ID → display name via DB.elementTypes (battle.js ELEMENT_TYPE).
function elemDisplayName(id) {
  return fmtElement(DB.elementTypes[Number(id)] ?? '');
}

// ─── Effects text generator ──────────────────────────────────────────────────
function generateEffectsText(parsed) {

  // ── Shared utilities ──

  const NUM_WORDS = [
    '','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten',
    'Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen',
    'Eighteen','Nineteen','Twenty',
  ];
  function hitsWord(n) { return NUM_WORDS[n] ?? String(n); }
  // Attack wording, as in the sheet (docs/decisions.md "Attack wording"): attacks on
  // all enemies are "group" attacks, and "(x each)" is only used for more than one hit.
  function attackNoun(sa, hits) {
    const kind = sa?.target === 'OPPONENT_ALIVE_ALL' ? 'group' : 'single';
    return hits === 1 ? `${kind} attack` : `${kind} attacks`;
  }
  // "[A], [B] and [C]", as the sheet lists statuses.
  function joinWithAnd(items) {
    return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  }
  function perHitText(hits, factors) { return ` (${factors}${hits === 1 ? '' : ' each'})`; }

  // Damage cap for an attack sub-action.
  // overflow (shouldEnableOverflow) → 99,999
  // secondaryDamageThresholdLv     → 199,999
  // damageCapBoost                 → 9,999 + boost (e.g. +10,000 → 19,999)
  function atkCap(sa) {
    if (!sa) return 9999;
    if (sa.props.overflow) return 99999;
    if (sa.props.secondaryDamageThresholdLv) return 199999;
    return 9999 + (sa.props.damageCapBoost ?? 0);
  }

  // Best available display name for a status object
  function statusName(s) {
    return s.commonName ?? s.codedName ?? `STATUS_${s.id}`;
  }

  // True for mode-level tracker statuses that don't belong in a plain effects line
  // (Common Name matches "Status Level while under specific status ID" pattern)
  function isLevelTracker(s) {
    return (s.commonName ?? '').toLowerCase().startsWith('status level');
  }

  // Format a partyCondition object into a human-readable "if ..." clause.
  // Series ID → realm name as in the sheet's Realm column (e.g. 108001 → 'VIII')
  function seriesDisplayName(id) {
    const key = DB.seriesIds[id];
    return key ? realmName(key) : `Series #${id}`;
  }

  // Collect names (jobs + series) from a buddyCondition object.
  // Handles both direct fields and the `any: { ... }` OR wrapper.
  function buddyConditionNames(buddy) {
    const src = buddy.any ?? buddy;  // `any:` is OR logic — treat same as flat
    const names = [];
    const jobIds = Array.isArray(src.anyJobId) ? src.anyJobId : (src.anyJobId != null ? [src.anyJobId] : []);
    for (const id of jobIds) {
      const key = DB.jobIds[id];
      names.push(key ? key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : `Job #${id}`);
    }
    const serIds = Array.isArray(src.anyBuddySeriesId) ? src.anyBuddySeriesId : (src.anyBuddySeriesId != null ? [src.anyBuddySeriesId] : []);
    for (const id of serIds) names.push(seriesDisplayName(id));
    return names;
  }

  // Handles countMatchedByBuddyCondition with anyJobId/anyBuddySeriesId (OR via `any:`) and greaterEqual count.
  function formatPartyCondition(pc) {
    if (!pc) return '';
    const cbbc = pc.countMatchedByBuddyCondition;
    if (!cbbc) return '';
    const buddy     = cbbc.buddyCondition ?? {};
    const countCond = cbbc.countCondition  ?? {};
    const count = countCond.greaterEqual  != null ? countCond.greaterEqual
                : countCond.greaterThan   != null ? (countCond.greaterThan + 1)
                : null;
    if (count == null) return '';
    const names = buddyConditionNames(buddy);
    if (!names.length) return '';
    const below = count <= 1 ? '0' : `0-${count - 1}`;
    return `if there are ${below}/${count}+ ${names.join('/')} allies in the party`;
  }

  // Parse a partyCondition directly from a raw condition_arg string using regex.
  // More reliable than nested parseDenaArg for deeply-nested objects with inline arrays.
  // Handles anyJobId and anyBuddySeriesId (OR logic via `any:` wrapper is transparent to regex).
  // Returns "if there are 0-2/3+ Job/Series allies in the party" style string, or null.
  function parsePartyConditionLabel(condArgStr) {
    if (!condArgStr || !condArgStr.includes('partyCondition')) return null;
    const countM = condArgStr.match(/greaterEqual\s*:\s*(\d+)/);
    if (!countM) return null;
    const count = parseInt(countM[1]);
    const names = [];
    const jobM = condArgStr.match(/anyJobId\s*:\s*\[([^\]]+)\]/);
    if (jobM) {
      for (const id of (jobM[1].match(/\d+/g) ?? []).map(Number)) {
        const key = DB.jobIds[id];
        names.push(key ? key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : `Job #${id}`);
      }
    }
    const serM = condArgStr.match(/anyBuddySeriesId\s*:\s*\[([^\]]+)\]/);
    if (serM) {
      for (const id of (serM[1].match(/\d+/g) ?? []).map(Number)) names.push(seriesDisplayName(id));
    }
    if (!names.length) return null;
    const below = count <= 1 ? '0' : `0-${count - 1}`;
    return `if there are ${below}/${count}+ ${names.join('/')} allies in the party`;
  }

  // Human-readable target suffix, e.g. " to user" / " to all allies"
  // 'default' = SB activation re-tag → "to user".
  // Named sub-action targets use the same keyword matching as parseSubActionTarget (UPPERCASE).
  // Numeric fallbacks cover unmapped IDs.
  function targetLabel(target) {
    if (!target) return '';
    const raw = String(target);
    if (raw === 'default') return ' to the user';
    const t = raw.toUpperCase();
    const isEnemy = t.includes('OPPONENT') || t.includes('ENEMY');
    const isAlly  = t.includes('PARTY') || t.includes('ALLY') || t.includes('FRIEND') || t.includes('COLLEAGUE');
    const isSelf  = t === 'SELF' || t.startsWith('SELF_') || t.endsWith('_SELF') || t.startsWith('EXECUTER');
    const isAllT  = t.includes('_ALL') || (t.includes('ALL') && !t.includes('SINGLE'));
    if (isSelf)             return ' to the user';
    if (isAlly  && isAllT)  return ' to all allies';
    if (isAlly)             return ' to single ally';
    if (isEnemy && isAllT)  return ' to enemies';
    if (isEnemy)            return ' to enemy';
    // Numeric fallbacks for common IDs not in the DB map
    if (raw === '1001') return ' to the user';
    if (raw === '2001' || raw === '4001') return ' to all allies';
    if (raw === '3003') return ' to enemies';
    return '';
  }

  // Format a damage sub-action into sheet-style text, e.g.:
  //   "Seven single attacks (0.90 each) capped at 19999, ignores evasion"
  // factorOverride: explicit per-hit factor; used when the sub-action lacks 'factor' but the
  //   ability-level damageFactor supplies the total (totalFactor / hits = per-hit).
  function fmtAtk(sa, extraNote, factorOverride) {
    const hits    = sa.props.hits ?? 1;
    const fac     = factorOverride ?? sa.props.multiplier;
    const elemStr = '';
    const perHit  = fac ? perHitText(hits, fac.toFixed(2)) : '';
    const capVal  = sa.props.overflow ? 99999
                  : sa.props.secondaryDamageThresholdLv ? 199999
                  : sa.props.damageCapBoost ? 9999 + sa.props.damageCapBoost : null;
    const capStr  = capVal ? ` capped at ${capVal}` : '';
    const flags   = [
      // autoHit / ignores evasion is implied for all soul breaks — omitted intentionally
      sa.props.ranged   ? 'ranged'           : null,
      sa.props.jump     ? 'jump'             : null,
      extraNote         ?? null,
    ].filter(Boolean);
    const flagStr    = flags.length ? `, ${flags.join(', ')}` : '';
    const piercingStr = sa.props.piercing ? 'piercing ' : '';
    const atkWord    = attackNoun(sa, hits);
    return `${hitsWord(hits)} ${elemStr}${piercingStr}${atkWord}${perHit}${capStr}${flagStr}`;
  }

  // Collect statuses from an ability's sub-actions, tagged with their target.
  // HIT_ACTOR_OF_SPECIFIC_SUB_ACTION (5001): resolves to the target of the referenced sub-action.
  function subActionStatuses(ab) {
    const out = [];
    for (const sa of ab.subActions) {
      if (sa.isStateLevelIncrement) continue;
      let target = sa.target;
      if (String(sa.target).includes('HIT_ACTOR') || String(sa.target) === '5001') {
        const m = sa.targetArgRaw.match(/processOrder\s*:\s*(\d+)/);
        if (m) {
          const ref = ab.subActions.find(r => r.processOrder === parseInt(m[1]));
          if (ref) target = ref.target;
        }
      }
      for (const s of sa.statuses) out.push({ ...s, _target: target, _partyCondition: sa.partyCondition ?? null });
    }
    return out;
  }

  // HP costs from sub-actions
  function abilityHpCosts(ab) {
    const costs = [];
    for (const sa of ab.subActions) {
      if (sa.props.maxHpBarter)     costs.push(`${sa.props.maxHpBarter}% max HP`);
      if (sa.props.currentHpBarter) costs.push(`${sa.props.currentHpBarter}% HP`);
    }
    return costs;
  }

  // HP costs from sub-actions that execute unconditionally (depth 0, outside any IF block).
  // controlTypeRaw: 1=IF, 3=ELSE, 4=ENDIF
  function execHpCosts(sas) {
    const costs = [];
    let depth = 0;
    for (const sa of sas) {
      const raw = sa.controlTypeRaw ?? 0;
      if      (raw === 1) { depth++; }
      else if (raw === 4) { depth--; }
      else if (raw !== 3 && depth === 0) {
        if (sa.props.maxHpBarter)     costs.push(`${sa.props.maxHpBarter}% max HP`);
        if (sa.props.currentHpBarter) costs.push(`${sa.props.currentHpBarter}% HP`);
      }
    }
    return costs;
  }

  // Short description of a sub-ability (command or follow-up)
  function describeSubAbility(ab) {
    const parts = [];

    const costs = abilityHpCosts(ab);
    if (costs.length) parts.push(`costs ${costs.join(', ')}`);

    const atkSAs = ab.subActions.filter(sa => sa.props.hits != null || sa.props.multiplier != null);
    if (atkSAs.length > 0) {
      const main    = atkSAs[0];
      const condCap = atkSAs.some(sa => sa !== main && sa.props.damageCapBoost && !main.props.damageCapBoost);
      parts.push(fmtAtk(main, condCap ? 'cap raised at max level' : null));
    }

    const stats = [
      ...ab.statuses.map(s => ({ ...s, _target: 'default' })),
      ...subActionStatuses(ab),
    ].filter(s => !isLevelTracker(s));
    if (stats.length) {
      parts.push(stats.map(s => `[${statusName(s)}]${targetLabel(s._target)}`).join(', '));
    }

    return parts.join(', ');
  }

  // ── Main logic ──

  const segs = [];

  const wrappedLabels = new Set(['arg1', 'wrappedAbilityId', 'abilityId', 'defaultAbility', 'defaultAbilityId', 'burstAbilityArgs', 'crystalForceAbilityId']);
  const wrapped  = parsed.subAbilities.find(s => wrappedLabels.has(s._label));
  const commands = parsed.subAbilities.filter(s => !wrappedLabels.has(s._label));
  const exec     = wrapped ?? parsed;

  // ── 1. Main attack ──
  // Per-hit factor: prefer sub-action's own 'factor'; fall back to exec-level damageFactor / hits
  // (damageFactor is stored as total on exec.props.multiplier, so divide by hit count).
  function resolvePerHit(sa, abilityForFallback) {
    if (sa.props.multiplier != null) return sa.props.multiplier;
    const total = abilityForFallback.props.multiplier;
    if (total != null) return total / (sa.props.hits ?? 1);
    return null;
  }

  // Detect an IF/ELSE_IF/ELSE/ENDIF conditional attack block in a sub-action list.
  // Returns { ifAtk, elseIfAtks, elseAtk, conditionArg } or null.
  // Known controlTypeRaw values: 1=IF, 2=ELSE_IF, 3=ELSE, 4=ENDIF.
  // Tracks nesting depth to find top-level IF blocks that contain attacks.
  // Returns the first such block (skipping blocks with no attack sub-actions, e.g. isNormalRegistered guards).
  function findConditionalAtk(sas) {
    const isAtk = sa => sa.props.hits != null || sa.props.multiplier != null;
    let depth = 0, blockStart = -1, blockElse = -1, elseIfStarts = [];
    for (let i = 0; i < sas.length; i++) {
      const raw = sas[i].controlTypeRaw ?? 0;
      if (raw === 1) {                              // IF
        if (depth === 0) { blockStart = i; blockElse = -1; elseIfStarts = []; }
        depth++;
      } else if (raw === 2 && depth === 1) {        // ELSE_IF at top level
        elseIfStarts.push(i);
      } else if (raw === 3 && depth === 1) {        // ELSE at top level
        blockElse = i;
      } else if (raw === 4) {                       // ENDIF
        depth--;
        if (depth === 0 && blockStart >= 0) {
          const blockEnd   = i;
          const ifEnd      = elseIfStarts.length > 0 ? elseIfStarts[0] : (blockElse >= 0 ? blockElse : blockEnd);
          const ifAtk      = sas.slice(blockStart + 1, ifEnd).find(isAtk);
          const elseIfAtks = elseIfStarts.map((start, idx) => {
            const end = idx + 1 < elseIfStarts.length ? elseIfStarts[idx + 1] : (blockElse >= 0 ? blockElse : blockEnd);
            return { atk: sas.slice(start + 1, end).find(isAtk) ?? null,
                     conditionArg: sas[start].conditionArg ?? '' };
          });
          const elseAtk    = blockElse >= 0 ? sas.slice(blockElse + 1, blockEnd).find(isAtk) : null;
          if (ifAtk || elseAtk || elseIfAtks.some(e => e.atk)) {
            return { ifAtk: ifAtk ?? null, elseIfAtks, elseAtk: elseAtk ?? null,
                     conditionArg: sas[blockStart].conditionArg ?? '' };
          }
          blockStart = -1; blockElse = -1; elseIfStarts = [];
        }
      }
    }
    return null;
  }

  // Convert a stateLevel.greaterEqual condition to use-count range labels (bare, no "uses").
  // greaterEqual: N → ifLabel: "(N-1)+",  elseLabel: "0" or "0-(N-2)"
  // Caller appends " uses" after "elseLabel/ifLabel".
  function parseStateConditionLabel(condArgStr) {
    if (!condArgStr) return null;
    try {
      const cond = parseDenaArg(condArgStr);
      function findSL(obj) {
        if (!obj || typeof obj !== 'object') return null;
        if (obj.stateLevel?.greaterEqual != null) return Number(obj.stateLevel.greaterEqual);
        for (const v of Object.values(obj)) { const r = findSL(v); if (r != null) return r; }
        return null;
      }
      const n = findSL(cond);
      if (n != null) {
        const threshold = n - 1;
        const elseLabel = threshold <= 1 ? '0' : `0-${threshold - 1}`;
        return { ifLabel: `${threshold}+`, elseLabel };
      }
    } catch(e) {}
    return null;
  }

  // Parse isAParamLessThanBParam condition into a "based on X and Y" label string.
  function parseStatComparisonLabel(condArgStr) {
    if (!condArgStr) return null;
    try {
      const cond = parseDenaArg(condArgStr);
      function findParam(obj) {
        if (!obj || typeof obj !== 'object') return null;
        if (obj.isAParamLessThanBParam) return obj.isAParamLessThanBParam;
        for (const v of Object.values(obj)) { const r = findParam(v); if (r != null) return r; }
        return null;
      }
      const p = findParam(cond);
      const STAT_LABELS = { atk:'ATK', def:'DEF', matk:'MAG', mdef:'RES', mnd:'MND', spd:'SPD' };
      const fmt = s => STAT_LABELS[String(s).toLowerCase()] ?? String(s).toUpperCase();
      if (p?.a && p?.b) return `${fmt(p.a)} and ${fmt(p.b)}`;
    } catch(e) {}
    return null;
  }

  // Parse actorCondition enelement (infusion) checks → human-readable label.
  // Returns { label } or null.
  function parseEnElementLabel(condArgStr) {
    if (!condArgStr) return null;
    function enName(id) {
      const name = elemDisplayName(id);
      return (name && name !== 'NE') ? name : null;
    }
    // Use regex to avoid parseDenaArg's inline nested-object limitation
    const sidMatch = condArgStr.match(/hasAttachElementByElementId\s*:\s*(\d+)/);
    if (sidMatch) {
      const n = enName(sidMatch[1]) ?? `Element${sidMatch[1]}`;
      return { label: `En${n}` };
    }
    const aidsMatch = condArgStr.match(/hasAnyAttachElementByElementIds\s*:\s*\[([^\]]+)\]/);
    if (aidsMatch) {
      const ids   = aidsMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      const names = ids.map(id => { const n = enName(id); return n ? `En${n}` : `Element${id}`; }).join(' or ');
      const lvlMatch = condArgStr.match(/greaterEqual\s*:\s*(\d+)/);
      const lvl = lvlMatch ? lvlMatch[1] : null;
      return { label: (lvl != null ? `Level ${lvl}+ ` : '') + names };
    }
    return null;
  }

  // Parse actorCondition elementAtkAttributeLv (Elemental Buff level check).
  // Returns { label: '30%+ Lightning Elemental Buff' } or null.
  function parseElementAtkAttributeLvLabel(condArgStr) {
    if (!condArgStr || !condArgStr.includes('elementAtkAttributeLv')) return null;
    const elemM = condArgStr.match(/elementType\s*:\s*(\d+)/);
    const lvlM  = condArgStr.match(/greaterEqual\s*:\s*(\d+)/);
    if (!elemM) return null;
    const elemName = elemDisplayName(elemM[1]);
    const pctStr   = lvlM ? `${lvlM[1]}%+ ` : '';
    return { label: `${pctStr}${elemName} Elemental Buff` };
  }

  // Parse stateLevel.equal condition → number of uses before trigger.
  // stateLevel.equal: N means the counter == N when the check fires; since the counter
  // increments AFTER the check, the condition is true on use (N+1).
  function parseStateLevelEqualCondition(condArgStr) {
    if (!condArgStr) return null;
    const m = condArgStr.match(/stateLevel\s*:\s*\{[^}]*equal\s*:\s*(\d+)/);
    if (!m) return null;
    return Number(m[1]) + 1;
  }

  // Detect a nested conditional:
  //   Outer IF = stat comparison (e.g. isAParamLessThanBParam: atk < mnd)
  //   Each branch contains an inner IF/ELSE/ENDIF use-count conditional with attacks.
  // Returns { ifBranchCondAtk, elseBranchCondAtk, outerConditionArg } or null.
  function findNestedConditionalAtk(sas) {
    // True if the branch has attacks at depth 0 (not inside a nested IF).
    function hasDirectAtk(branch) {
      const isAtk = sa => sa.props.hits != null || sa.props.multiplier != null;
      let d = 0;
      for (const sa of branch) {
        const raw = sa.controlTypeRaw ?? 0;
        if      (raw === 1) { d++; }
        else if (raw === 4) { d--; }
        else if (raw !== 3 && d === 0 && isAtk(sa)) { return true; }
      }
      return false;
    }
    let depth = 0, blockStart = -1, blockElse = -1;
    for (let i = 0; i < sas.length; i++) {
      const raw = sas[i].controlTypeRaw ?? 0;
      if (raw === 1) {
        if (depth === 0) { blockStart = i; blockElse = -1; }
        depth++;
      } else if (raw === 3 && depth === 1) {
        blockElse = i;
      } else if (raw === 4) {
        depth--;
        if (depth === 0 && blockStart >= 0) {
          const blockEnd   = i;
          const elseIdx    = blockElse >= 0 ? blockElse : blockEnd;
          const ifBranch   = sas.slice(blockStart + 1, elseIdx);
          const elseBranch = blockElse >= 0 ? sas.slice(blockElse + 1, blockEnd) : [];
          if (!hasDirectAtk(ifBranch) && !hasDirectAtk(elseBranch) &&
              ifBranch.length > 0 && elseBranch.length > 0) {
            const innerIf   = findConditionalAtk(ifBranch);
            const innerElse = findConditionalAtk(elseBranch);
            if (innerIf && innerElse) {
              return { ifBranchCondAtk: innerIf, elseBranchCondAtk: innerElse,
                       outerConditionArg: sas[blockStart].conditionArg ?? '' };
            }
          }
          blockStart = -1; blockElse = -1;
        }
      }
    }
    return null;
  }

  // Find the first top-level IF/ELSE block where BOTH branches contain status (non-attack) sub-actions.
  // Returns { ifStatuses, elseStatuses, conditionArg } or null.
  // Skips blocks that contain any attacks (those are handled by the attack conditional logic).
  function findConditionalStatus(sas) {
    const isAtk = sa => sa.props.hits != null || sa.props.multiplier != null;
    let depth = 0, blockStart = -1, blockElse = -1;
    for (let i = 0; i < sas.length; i++) {
      const raw = sas[i].controlTypeRaw ?? 0;
      if (raw === 1) {
        if (depth === 0) { blockStart = i; blockElse = -1; }
        depth++;
      } else if (raw === 3 && depth === 1) {
        blockElse = i;
      } else if (raw === 4) {
        depth--;
        if (depth === 0 && blockStart >= 0) {
          const blockEnd   = i;
          const elseIdx    = blockElse >= 0 ? blockElse : blockEnd;
          const ifBranch   = sas.slice(blockStart + 1, elseIdx);
          const elseBranch = blockElse >= 0 ? sas.slice(blockElse + 1, blockEnd) : [];
          if (![...ifBranch, ...elseBranch].some(isAtk)) {
            const ifSA   = ifBranch.find(sa => (sa.controlTypeRaw ?? 0) === 0 && sa.statuses.length > 0);
            const elseSA = elseBranch.find(sa => (sa.controlTypeRaw ?? 0) === 0 && sa.statuses.length > 0);
            if (ifSA || elseSA) {
              return { ifStatuses: ifSA?.statuses ?? [], elseStatuses: elseSA?.statuses ?? [],
                       ifTarget: ifSA?.target, elseTarget: elseSA?.target,
                       conditionArg: sas[blockStart].conditionArg ?? '',
                       hasElse: !!elseSA };
            }
          }
          blockStart = -1; blockElse = -1;
        }
      }
    }
    return null;
  }

  const nestedCondAtk = findNestedConditionalAtk(exec.subActions);
  const condAtk       = nestedCondAtk ? null : findConditionalAtk(exec.subActions);
  const hpCosts = execHpCosts(exec.subActions);
  const hpStr   = hpCosts.length ? ` and damages the user for ${hpCosts.join(', ')}` : '';

  if (nestedCondAtk) {
    // Nested conditional: outer stat comparison (atk<mnd) with inner use-count IF in both branches.
    // "N attacks (atkBase/atkBoost or mndBase/mndBoost each) capped at X/Y after L1/L2 uses based on A and B"
    const { ifBranchCondAtk, elseBranchCondAtk, outerConditionArg } = nestedCondAtk;
    const statLabel  = parseStatComparisonLabel(outerConditionArg);
    const usageLabel = parseStateConditionLabel(ifBranchCondAtk.conditionArg);

    // ELSE of outer = when atk >= mnd → ATK formula (lower multipliers)
    const atkBase  = elseBranchCondAtk.elseAtk ?? elseBranchCondAtk.ifAtk;
    const atkBoost = elseBranchCondAtk.elseAtk ? elseBranchCondAtk.ifAtk : null;
    // IF of outer  = when atk < mnd  → MND formula (higher multipliers)
    const mndBase  = ifBranchCondAtk.elseAtk ?? ifBranchCondAtk.ifAtk;
    const mndBoost = ifBranchCondAtk.elseAtk ? ifBranchCondAtk.ifAtk : null;

    const hits           = atkBase?.props.hits ?? mndBase?.props.hits ?? 1;
    const atkPerHitBase  = resolvePerHit(atkBase, exec);
    const atkPerHitBoost = atkBoost ? resolvePerHit(atkBoost, exec) : null;
    const mndPerHitBase  = resolvePerHit(mndBase, exec);
    const mndPerHitBoost = mndBoost ? resolvePerHit(mndBoost, exec) : null;
    const baseCap  = atkCap(atkBase ?? mndBase);
    const boostCap = atkCap(atkBoost ?? mndBoost);

    const atkWord   = attackNoun(atkBase ?? mndBase, hits);
    const perHitStr = (atkPerHitBoost != null && mndPerHitBoost != null)
      ? perHitText(hits, `${atkPerHitBase.toFixed(2)}/${atkPerHitBoost.toFixed(2)} or ${mndPerHitBase.toFixed(2)}/${mndPerHitBoost.toFixed(2)}`)
      : (atkPerHitBase != null && mndPerHitBase != null)
        ? perHitText(hits, `${atkPerHitBase.toFixed(2)} or ${mndPerHitBase.toFixed(2)}`)
        : '';
    const capStr    = boostCap !== baseCap ? ` capped at ${baseCap}/${boostCap}` : (baseCap !== 9999 ? ` capped at ${baseCap}` : '');
    const afterStr  = usageLabel ? ` after ${usageLabel.elseLabel}/${usageLabel.ifLabel} uses` : '';
    const basedStr  = statLabel  ? ` based on ${statLabel}` : '';
    segs.push(`${hitsWord(hits)} ${atkWord}${perHitStr}${capStr}${afterStr}${basedStr}${hpStr}`);

  } else if (condAtk) {
    // Simple two-branch (or multi-branch) conditional: factor/cap difference, or element difference (same factor)
    const { ifAtk, elseIfAtks = [], elseAtk, conditionArg } = condAtk;
    const condLabel = parseStateConditionLabel(conditionArg);
    const statLabel = condLabel ? null : parseStatComparisonLabel(conditionArg);
    const enLabel   = (!condLabel && !statLabel) ? parseEnElementLabel(conditionArg) : null;
    const baseSA    = elseAtk ?? ifAtk;        // else = initial/base branch
    const boostSA   = elseAtk ? ifAtk : null;  // if  = enhanced branch
    const hits      = baseSA.props.hits ?? boostSA?.props.hits ?? 1;
    const basePerHit  = resolvePerHit(baseSA, exec);
    const boostPerHit = boostSA ? resolvePerHit(boostSA, exec) : null;
    const baseCap   = atkCap(baseSA);
    const boostCap  = boostSA ? atkCap(boostSA) : null;
    const atkWord   = attackNoun(baseSA, hits);
    // Detect element-conditional: all branches same factor, any element differences
    const elseIfAllSame = elseIfAtks.every(ei => {
      if (!ei.atk) return true;
      const f = resolvePerHit(ei.atk, exec);
      return f != null && basePerHit != null && Math.abs(f - basePerHit) < 0.001;
    });
    const sameFactors = boostSA && boostPerHit != null && basePerHit != null
      && Math.abs(boostPerHit - basePerHit) < 0.001 && elseIfAllSame;
    const ifElems   = ifAtk?.elements  ?? [];
    const elseElems = elseAtk?.elements ?? [];
    const elemsDiffer = JSON.stringify([...ifElems].sort()) !== JSON.stringify([...elseElems].sort());
    if (enLabel && sameFactors && elemsDiffer) {
      // "One Fire/NE or Ice/NE or Lightning/NE single attack (34.60 each) capped at 199,999 based on EnFire or EnIce"
      const fmtEL      = sa => sa?.elements?.map(fmtElement).filter(Boolean).join('/') || 'NE';
      const allBranches = [ifAtk, ...elseIfAtks.map(e => e.atk), elseAtk].filter(Boolean);
      const elemStrs   = [...new Set(allBranches.map(fmtEL))];
      const perHitStr  = basePerHit != null ? perHitText(hits, basePerHit.toFixed(2)) : '';
      const allEnLabels = [enLabel.label,
        ...elseIfAtks.map(ei => parseEnElementLabel(ei.conditionArg)?.label).filter(Boolean)];
      const capStr = baseCap !== 9999 ? ` capped at ${baseCap}` : '';
      segs.push(`${hitsWord(hits)} ${elemStrs.join(' or ')} ${atkWord}${perHitStr}${capStr} based on ${allEnLabels.join(' or ')}${hpStr}`);
    } else {
      const perHitStr = boostPerHit != null && basePerHit != null
        ? perHitText(hits, `${basePerHit.toFixed(2)} or ${boostPerHit.toFixed(2)}`)
        : basePerHit != null ? perHitText(hits, basePerHit.toFixed(2)) : '';
      const capStr    = boostCap != null && baseCap !== boostCap
        ? ` capped at ${baseCap}/${boostCap}`
        : (baseCap !== 9999 ? ` capped at ${baseCap}` : '');
      const afterStr  = condLabel ? ` after ${condLabel.elseLabel}/${condLabel.ifLabel} uses` : '';
      const basedStr  = statLabel ? ` based on ${statLabel}` : (enLabel ? ` based on ${enLabel.label}` : '');
      segs.push(`${hitsWord(hits)} ${atkWord}${perHitStr}${capStr}${afterStr}${basedStr}${hpStr}`);
    }

  } else {
    const atkSAs = exec.subActions.filter(sa => sa.props.hits != null || sa.props.multiplier != null);
    if (atkSAs.length > 0) {
      const main    = atkSAs[0];
      const condCap = atkSAs.some(sa => sa !== main && sa.props.damageCapBoost && !main.props.damageCapBoost);
      segs.push(fmtAtk(main, condCap ? 'cap raised at max level' : null, resolvePerHit(main, exec)) + hpStr);
    } else {
      const topAtkSAs = parsed.subActions.filter(sa => sa.props.hits != null || sa.props.multiplier != null);
      if (topAtkSAs.length) segs.push(fmtAtk(topAtkSAs[0], null, resolvePerHit(topAtkSAs[0], parsed)) + hpStr);
    }
  }

  // ── 1b. HEAL_HP sub-actions ──
  {
    const healSAs = exec.subActions.filter(sa => sa.props.healFactor != null);
    const effectiveHealSAs = healSAs.length > 0
      ? healSAs
      : parsed.subActions.filter(sa => sa.props.healFactor != null);
    for (const hsa of effectiveHealSAs) {
      segs.push(`Restores HP (${hsa.props.healFactor})`);
    }
  }

  // ── 2. Activation statuses ──
  if (wrapped) {
    // Soul break / wrapped ability: formula-level statuses activate on the user ('default');
    // sub-action statuses keep their own target (e.g. 4001=all allies, 1001=self).
    const attachLvStatuses = wrapped.subActions.flatMap(sa => {
      if (sa.props.attachIncreaseLv == null || sa.elements.length === 0) return [];
      const lv       = sa.props.attachIncreaseLv;
      const lvStr    = lv > 1 ? ` ${lv}` : '';
      const stackStr = sa.props.maxLevel === 5 ? ' with Secondary Stacking'
                     : sa.props.maxLevel === 3 ? ' with Stacking'
                     : '';
      return sa.elements.filter(e => e && e !== 'NE').map(e => ({
        id:              `_attach_${e}`,
        commonName:      `Attach ${e}${lvStr}${stackStr}`,
        _target:         'default',
        _partyCondition: null,
      }));
    });
    const activationStatuses = [
      ...parsed.statuses.map(s => ({ ...s, _target: s.target ?? 'default' })),
      ...subActionStatuses(wrapped),
      ...attachLvStatuses,
    ].filter(s => !isLevelTracker(s));
    const seenIds = new Set();
    const uniqueStatuses = activationStatuses.filter(s => {
      if (seenIds.has(s.id)) return false;
      seenIds.add(s.id); return true;
    });
    if (uniqueStatuses.length > 0) {
      // Unconditional statuses: one segment per target (existing behaviour)
      const unconditional = uniqueStatuses.filter(s => !s._partyCondition);
      const conditional   = uniqueStatuses.filter(s =>  s._partyCondition);

      const byTargetUnc = new Map();
      for (const s of unconditional) {
        const tLabel = targetLabel(s._target);
        if (!byTargetUnc.has(tLabel)) byTargetUnc.set(tLabel, []);
        byTargetUnc.get(tLabel).push(s);
      }
      for (const [tLabel, group] of byTargetUnc) {
        const statusStr = joinWithAnd(group.map(s => `[${statusName(s)}]`));
        if (tLabel.includes('enem')) {
          segs.push(`Causes ${statusStr}${tLabel.replace(' to ', ' on ')}`);
        } else {
          segs.push(`Grants ${statusStr}${tLabel}`);
        }
      }

      // Conditional statuses: group by condition, combine targets with '/', append "if ..." suffix
      const byCondition = new Map();
      for (const s of conditional) {
        const condKey = JSON.stringify(s._partyCondition);
        if (!byCondition.has(condKey)) byCondition.set(condKey, { cond: s._partyCondition, byTarget: new Map() });
        const bt = byCondition.get(condKey).byTarget;
        const tLabel = targetLabel(s._target);
        if (!bt.has(tLabel)) bt.set(tLabel, []);
        bt.get(tLabel).push(s);
      }
      for (const [, { cond, byTarget: bt }] of byCondition) {
        const condSuffix = ' ' + formatPartyCondition(cond);
        const enemyParts = [], allyParts = [];
        for (const [tLabel, group] of bt) {
          const statusStr = joinWithAnd(group.map(s => `[${statusName(s)}]`));
          if (tLabel.includes('enem')) enemyParts.push(`${statusStr}${tLabel.replace(' to ', ' on ')}`);
          else                         allyParts.push(`${statusStr}${tLabel}`);
        }
        if (enemyParts.length) segs.push(`Causes ${enemyParts.join('/')}${condSuffix}`);
        if (allyParts.length)  segs.push(`Grants ${allyParts.join('/')}${condSuffix}`);
      }
    }
  } else {
    // Direct ability (exec = parsed): depth-aware collection with conditional status support.
    // Collect unconditional statuses at depth 0, grouped by target.
    const byTarget = new Map();
    for (const s of parsed.statuses.filter(s => !isLevelTracker(s))) {
      const tLabel = targetLabel(s._target ?? 'default');
      if (!byTarget.has(tLabel)) byTarget.set(tLabel, []);
      byTarget.get(tLabel).push(s);
    }
    let statDepth = 0;
    for (const sa of exec.subActions) {
      const raw = sa.controlTypeRaw ?? 0;
      if      (raw === 1) { statDepth++; }
      else if (raw === 4) { statDepth--; }
      else if (raw !== 3 && statDepth === 0 && !sa.isStateLevelIncrement) {
        const tLabel = targetLabel(sa.target);
        for (const s of sa.statuses.filter(s => !isLevelTracker(s))) {
          if (!byTarget.has(tLabel)) byTarget.set(tLabel, []);
          byTarget.get(tLabel).push(s);
        }
      }
    }
    // Conditional status block: IF(/ELSE) where branches have status sub-actions.
    const condStat = findConditionalStatus(exec.subActions);
    const clauses = [];
    for (const [tLabel, statuses] of byTarget) {
      if (statuses.length > 0) clauses.push(statuses.map(s => `[${statusName(s)}]`).join(', ') + tLabel);
    }
    if (condStat) {
      const statLabel      = parseStatComparisonLabel(condStat.conditionArg)
                             ?? parseEnElementLabel(condStat.conditionArg)?.label;
      const elemBuffLabel  = parseElementAtkAttributeLvLabel(condStat.conditionArg);
      const pcLabel        = parsePartyConditionLabel(condStat.conditionArg);
      const ifStr      = condStat.ifStatuses.filter(s => !isLevelTracker(s)).map(s => `[${statusName(s)}]`).join(', ');
      if (pcLabel) {
        // Party condition: "Grants [X] to user/[X] to all allies if there are 0-2/3+ Job allies in the party"
        // ELSE branch listed first (fewer allies = lower threshold), IF branch second (more allies).
        const elseStr   = condStat.elseStatuses.filter(s => !isLevelTracker(s)).map(s => `[${statusName(s)}]`).join(', ');
        const ifLabel   = targetLabel(condStat.ifTarget);
        const elseLabel = targetLabel(condStat.elseTarget);
        const parts = [];
        if (elseStr) parts.push(`${elseStr}${elseLabel}`);
        if (ifStr)   parts.push(`${ifStr}${ifLabel}`);
        if (parts.length) clauses.push(parts.join('/') + ` ${pcLabel}`);
      } else if (condStat.hasElse) {
        const tLabel  = targetLabel(condStat.ifTarget) || targetLabel(condStat.elseTarget);
        const elseStr = condStat.elseStatuses.filter(s => !isLevelTracker(s)).map(s => `[${statusName(s)}]`).join(', ');
        if (elemBuffLabel) {
          // "grants [X] to all allies if 30%+ Lightning Elemental Buff, grants [Y] to all allies if not"
          const parts = [];
          if (ifStr)   parts.push(`${ifStr}${tLabel} if ${elemBuffLabel.label}`);
          if (elseStr) parts.push(`${elseStr}${tLabel} if not`);
          if (parts.length) clauses.push(parts.join(', grants '));
        } else {
          // Two-sided: "grants [X] or [Y] to self based on condition"
          const parts = [ifStr, elseStr].filter(Boolean);
          if (parts.length) clauses.push(parts.join(' or ') + tLabel + (statLabel ? ` based on ${statLabel}` : ''));
        }
      } else {
        // One-sided: "grants [X] to self if condition" or "after N uses" for stateLevel.equal
        const tLabel   = targetLabel(condStat.ifTarget) || targetLabel(condStat.elseTarget);
        const useCount = parseStateLevelEqualCondition(condStat.conditionArg);
        if (ifStr) clauses.push(ifStr + tLabel + (useCount != null ? ` after ${useCount} uses` : statLabel ? ` if ${statLabel}` : ''));
        // TACTICAL_AWAKE weapon skill: if the condition is an element infusion check without ELSE,
        // battle.js implies the else branch grants "Attach <elements> <level> with Stacking" to user.
        if (DB.soulStrikeCategories[parsed.soulStrikeCategory] === 'TACTICAL_AWAKE') {
          const anyM = condStat.conditionArg?.match(/hasAnyAttachElementByElementIds\s*:\s*\[([^\]]+)\]/);
          const oneM = !anyM && condStat.conditionArg?.match(/hasAttachElementByElementId\s*:\s*(\d+)/);
          if (anyM || oneM) {
            const ids   = anyM ? anyM[1].split(',').map(s => s.trim()) : [oneM[1]];
            const lvlM  = condStat.conditionArg?.match(/greaterEqual\s*:\s*(\d+)/);
            const level = lvlM ? parseInt(lvlM[1]) : 2;
            const lvlStr = level >= 2 ? ` ${level}` : '';
            const tags = ids.map(id => { const n = DB.elementTypes[Number(id)]; const name = n ? fmtElement(n) : `Element${id}`; return `[Attach ${name}${lvlStr} with Stacking]`; });
            clauses.push(`${tags.join('/')} to user if not`);
          }
        }
      }
    }
    if (clauses.length > 0) segs.push('Grants ' + clauses.join(', grants '));
  }

  // Pre-compute elements handled by section 3b (INFLICT_SA with increaseLv) so sections 3 and 3a
  // can skip them and avoid duplicating the same element with a different label.
  const ebmAttachElems = new Set();
  for (const sa of [...parsed.subActions, ...(exec !== parsed ? exec.subActions : [])]) {
    if (sa.props.attachIncreaseLv != null) {
      sa.elements.filter(e => e && e !== 'NE').forEach(e => ebmAttachElems.add(e));
    }
  }

  // ── 3. Attach Element grant (conditional on entry element when multiple options) ──
  // Suppressed for TACTICAL_AWAKE: attachElement args are reserved for internal use in that type.
  const isTacticalAwake = DB.soulStrikeCategories[parsed.soulStrikeCategory] === 'TACTICAL_AWAKE';
  if (!isTacticalAwake && parsed.attachElements && parsed.attachElements.length > 0) {
    const aeLevel      = parsed.attachElementLevel;
    const aeHasStack   = !!parsed.attachElementAddMaxLevel;
    const aeStatusName = (elemId) => {
      const elemName = DB.elementTypes[elemId] ? fmtElement(DB.elementTypes[elemId]) : `ELEMENT_${elemId}`;
      const levelStr = (aeLevel != null && aeLevel >= 2) ? ` ${aeLevel}` : '';
      const stackStr = aeHasStack ? ' with Stacking' : '';
      return `Attach ${elemName}${levelStr}${stackStr}`;
    };
    const filteredElems = parsed.attachElements.filter(id => {
      const name = DB.elementTypes[id] ? fmtElement(DB.elementTypes[id]) : null;
      return name && !ebmAttachElems.has(name);
    });
    if (filteredElems.length > 0) {
      const statusTags = filteredElems.map(id => `[${aeStatusName(id)}]`);
      if (filteredElems.length === 1) {
        segs.push(`Grants ${statusTags[0]}`);
      } else {
        const elemLabels = filteredElems
          .map(id => DB.elementTypes[id] ? fmtElement(DB.elementTypes[id]) : `ELEMENT_${id}`)
          .join('/');
        segs.push(`Grants ${statusTags.join('/')} based on if entry damage was ${elemLabels}`);
      }
    }
  }

  // ── 3a. ATTACH_ELEMENT_BY_ATTACK_ELEMENT sub-actions (type 18) ──
  // Grants [Attach <element>] or [Attach <element> with Secondary Stacking] (when maxLv is set).
  // Scans both parsed and exec sub-actions: type 18 may sit on the outer ability while the
  // inner (exec) wraps a chase ability — both need to be checked to avoid missed effects.
  const attachStrsSeen = new Set();
  for (const sa of [...parsed.subActions, ...(exec !== parsed ? exec.subActions : [])]) {
    if (sa.type === 'ATTACH_ELEMENT_BY_ATTACK_ELEMENT' || sa.type === '18') {
      // maxLv 5 → Secondary Stacking, 3 → Stacking (docs/decisions.md "increaseLv + maxLv").
      const stackStr = sa.props.maxLevel === 5 ? ' with Secondary Stacking'
                     : sa.props.maxLevel === 3 ? ' with Stacking'
                     : '';
      const elemTags = sa.elements.filter(e => e && e !== 'NE' && !ebmAttachElems.has(e)).map(e => `[Attach ${e}${stackStr}]`);
      if (elemTags.length) {
        const key = elemTags.join('/');
        if (!attachStrsSeen.has(key)) { attachStrsSeen.add(key); segs.push(`Grants ${key}`); }
      }
    }
  }

  // ── 3b. (handled in section 2 as synthetic statuses targeting user) ──

  // ── 3c. Ability Crash conditional (EXTRA_ZETSUGI only) ──
  if (DB.soulStrikeCategories[parsed.soulStrikeCategory] === 'EXTRA_ZETSUGI') {
    const abilityCrushSub = parsed.subAbilities.find(sub =>
      sub.soulStrikeCategory &&
      DB.soulStrikeCategories[sub.soulStrikeCategory] === 'EXTRA_ZETSUGI' &&
      !wrappedLabels.has(sub._label)
    );
    if (abilityCrushSub) {
      const crushName = DB.otherNameMap[abilityCrushSub.abilityId] || 'Ability Crash';
      const personalAbilityIds = parsed.extraZetsugiPersonalAbilityIds ?? [];
      const personalNames = personalAbilityIds.map(id =>
        DB.heroAbilityNameMap[id] || DB.otherNameMap[id] || String(id)
      );
      const condition = personalNames.length > 0
        ? personalNames.join(' or ') + ' is equipped'
        : 'a hero ability is equipped';
      segs.push(`Immediately casts [${crushName}] if ${condition}`);
    }
  }

  // ── 4. Follow-up sub-abilities — parsed but not included in SB tab effects ──
  // (Follow-ups belong in the Other tab; excluded here intentionally.)

  // ── 5. Commands — parsed but not included in SB tab effects ──
  // (Commands belong in their own tab; excluded here intentionally.)

  // One sentence, as in the sheet: "…capped at 19999, grants [X] to the user" — later
  // segments start lower-case when they open with a verb, and there is no final period
  // (docs/decisions.md "Effects punctuation").
  const SEGMENT_VERBS = /^(Grants|Causes|Removes|Heals|Restores|Damages|Dispels|Cures|Revives|Sets|Inflicts|Deals|Increases|Reduces|Immediately|Chases|Resets|Fills|Recovers|Reveals)\b/;
  const sentence = segs.map((seg, i) => (i > 0 && SEGMENT_VERBS.test(seg) ? seg.charAt(0).toLowerCase() + seg.slice(1) : seg));
  return segs.length ? sentence.join(', ') : '(No effects detected)';
}

// ─── Soul break lookup ────────────────────────────────────────────────────────
function lookupSoulBreak(abilityId) {
  return DB.soulBreaksMap[abilityId] ?? null;
}

function lookupOtherAbility(abilityId) {
  return DB.otherMap.find(r => String(r['ID']) === String(abilityId)) ?? null;
}

function lookupHeroAbility(abilityId) {
  return DB.heroAbilitiesMap[abilityId] ?? null;
}

function lookupExtraAbility(abilityId) {
  return DB.extraMap[abilityId] ?? null;
}

// ─── Rendering ────────────────────────────────────────────────────────────────
function row(label, value, cls) {
  if (value === null || value === undefined || value === '' || value === false) return '';
  return `<tr><th>${label}</th><td class="${cls ?? ''}">${value}</td></tr>`;
}

// ─── JP → EN name translation (auto on render) ───────────────────────────────
async function translateSBName(abilityId, jpText) {
  const nameCell = document.getElementById(`sbp-name-${abilityId}`);
  const tsvArea  = document.getElementById(`sbp-tsv-${abilityId}`);
  if (!nameCell) return;
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=en&dt=t&q=${encodeURIComponent(jpText)}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const translated = data[0].map(c => c[0]).join('');
    const span = nameCell.querySelector('.sbp-name-val');
    if (span) span.textContent = translated;
    const indicator = nameCell.querySelector('.sbp-translating');
    if (indicator) indicator.remove();
    // Rebuild TSV from current table cell text content
    if (tsvArea) {
      const tbody = tsvArea.closest('.sb-preview').querySelector('.sb-preview-table tbody');
      tsvArea.value = [...tbody.rows].map(r => r.cells[1].textContent.trim()).join('\t');
    }
  } catch(e) {
    const indicator = nameCell.querySelector('.sbp-translating');
    if (indicator) indicator.textContent = '⚠';
  }
}

// ─── Sheet columns shared by every preview ───────────────────────────────────
// Type, Formula, Multiplier, Target, Auto Target, Element and Counter are derived
// the same way for every sheet tab (Soul Breaks, Crystal Commands, Extra, Other).
// Each rule follows the community sheet's most common convention (docs/decisions.md
// "Sheet conventions"); the preview builders only choose their tab's columns.

// Sub-ability labels that mean "this sub-ability is what actually executes".
const WRAPPED_LABELS = new Set(['arg1', 'wrappedAbilityId', 'abilityId', 'defaultAbility', 'defaultAbilityId', 'burstAbilityArgs', 'crystalForceAbilityId']);

// The ability whose sub-actions do the work: the wrapped sub-ability, or the ability itself.
function execAbility(parsed) {
  return parsed.subAbilities.find(s => WRAPPED_LABELS.has(s._label)) ?? parsed;
}

const isAttackSubAction = sa => sa.props.hits != null || sa.props.multiplier != null;

// Damage sub-actions, the executing ability's first.
function attackSubActions(parsed) {
  const exec = execAbility(parsed);
  const own = exec.subActions.filter(isAttackSubAction);
  return exec === parsed ? own : [...own, ...parsed.subActions.filter(isAttackSubAction)];
}

const ATK_TYPE_COLUMNS = {
  // Names as they appear in battle.js ATK_TYPE, plus aliases seen in class names
  PHYSICAL: { type: 'PHY', formula: 'Physical' }, INBORN:  { type: 'NAT', formula: '' },
  SUMMON:   { type: 'SUM', formula: 'Magical'  }, BLACK:   { type: 'BLK', formula: 'Magical' },
  WHITE:    { type: 'WHT', formula: 'Magical'  }, MAGIC:   { type: 'BLK', formula: 'Magical' },
  MAGICAL:  { type: 'BLK', formula: 'Magical'  }, HEALING: { type: 'WHT', formula: 'Magical' },
  HYBRID:   { type: 'NAT', formula: ''         }, NATURAL: { type: 'NAT', formula: '' },
};

function typeAndFormula(parsed) {
  const exec        = execAbility(parsed);
  const atkTypeName = String(exec.props.range ?? parsed.props.range ?? '').toUpperCase();
  if (ATK_TYPE_COLUMNS[atkTypeName]) return ATK_TYPE_COLUMNS[atkTypeName];

  // Fallback: substring matching over every available signal — handles class names like
  // 'PhysAttack' or 'BlackMagicAttack' and SUB_ACTION_TYPE names like 'PHYSICAL_ATTACK'.
  const hay = [parsed.formulaClass, parsed.category, attackSubActions(parsed)[0]?.type, atkTypeName,
               exec.exerciseType ?? parsed.exerciseType].map(v => String(v ?? '')).join(' ').toUpperCase();
  // More specific checks first to avoid mis-classification
  if (hay.includes('INBORN') || hay.includes('HYBRID')) return { type: 'NAT', formula: ''         };
  if (hay.includes('SUMMON'))                            return { type: 'SUM', formula: 'Magical'  };
  if (hay.includes('WHITE')  || hay.includes('HEAL'))   return { type: 'WHT', formula: 'Magical'  };
  if (hay.includes('BLACK'))                             return { type: 'BLK', formula: 'Magical'  };
  if (hay.includes('PHYS'))                              return { type: 'PHY', formula: 'Physical' };
  if (hay.includes('MAGIC'))                             return { type: 'BLK', formula: 'Magical'  };
  return { type: '', formula: '' };
}

// Who a SUB_ACTION_TARGET_TYPE name (or similar) points at.
function targetKind(targetStr) {
  const t       = String(targetStr ?? '').toUpperCase();
  const isEnemy = t.includes('OPPONENT') || t.includes('ENEMY');
  const isAlly  = t.includes('PARTY') || t.includes('ALLY') || t.includes('FRIEND') || t.includes('COLLEAGUE');
  const isSelf  = !isEnemy && !isAlly && (t.startsWith('EXECUTER') || t === 'SELF' || t.startsWith('SELF_') || t.endsWith('_SELF'));
  const isAll   = t.includes('_ALL') || (t.includes('ALL') && !t.includes('SINGLE'));
  let target = '';
  if      (isSelf)            target = 'Self';
  else if (isEnemy && isAll)  target = 'All enemies';
  else if (isEnemy)           target = 'Single enemy';
  else if (isAlly  && isAll)  target = 'All allies';
  else if (isAlly)            target = 'Single ally';
  else if (isAll)             target = 'All';
  return { t, isEnemy, target };
}

// Target and Auto Target for a sub-action target name. Auto Target repeats the Target
// unless the game picks a specific one (docs/decisions.md "Target and Auto Target").
function targetLabels(targetStr) {
  const { t, isEnemy, target } = targetKind(targetStr);
  const who = isEnemy ? 'enemy' : 'ally';
  let autoTarget = target;
  if      (t.includes('LOW_HP_RATE'))  autoTarget = `Lowest HP% ${who}`;
  else if (t.includes('HIGH_HP_RATE')) autoTarget = `Highest HP% ${who}`;
  else if (t.includes('LOW_HP'))       autoTarget = `Lowest HP ${who}`;
  else if (t.includes('HIGH_HP'))      autoTarget = `Highest HP ${who}`;
  else if (t.includes('RANDOM'))       autoTarget = `Random ${who}`;
  return { target, autoTarget };
}

function targetColumns(parsed) {
  // An attack's target decides it.
  const atk = attackSubActions(parsed)[0];
  if (atk) return targetLabels(atk.target);

  // No attack: the widest target among the sub-actions.
  const exec = execAbility(parsed);
  const found = new Set();
  for (const sa of exec !== parsed ? [...parsed.subActions, ...exec.subActions] : parsed.subActions) {
    if ((sa.controlTypeRaw ?? 0) !== 0 || !sa.target || String(sa.target) === '0') continue;
    const { target } = targetKind(sa.target);
    if (target) found.add(target);
  }
  for (const target of ['All enemies', 'Single enemy', 'All allies', 'Single ally', 'Self']) {
    if (found.has(target)) return { target, autoTarget: target };
  }

  // Nothing else: the ability's own range and segment.
  const range  = String(parsed.target.range ?? '').toUpperCase();
  const seg    = String(parsed.target.segment ?? '').toUpperCase();
  const isAll  = range.includes('ALL') || range === '4' || range === '5';
  const isAlly = seg.includes('ALLY') || seg.includes('FRIEND') || seg.includes('PARTY');
  const target = isAlly ? (isAll ? 'All allies' : 'Single ally') : (isAll ? 'All enemies' : 'Single enemy');
  return { target, autoTarget: target };
}

function multiplierColumn(parsed) {
  const exec = execAbility(parsed);
  const sa   = attackSubActions(parsed)[0];
  if (!sa) return exec.props.multiplier != null ? exec.props.multiplier.toFixed(2) : '';
  // sa.props.multiplier is per hit (factor/100); exec.props.multiplier is the total (damageFactor/100)
  if (sa.props.multiplier != null) return ((sa.props.hits ?? 1) * sa.props.multiplier).toFixed(2);
  if (exec.props.multiplier != null) return exec.props.multiplier.toFixed(2);
  return '';
}

// Every element the attacks hit with, NE included whenever an attack hits for NE
// (docs/decisions.md "Element column includes NE"); blank when there is no attack.
function elementColumn(parsed) {
  const attacks = attackSubActions(parsed);
  if (!attacks.length) return '';
  const named = new Set();
  let hasNE = false;
  for (const sa of attacks) {
    const elems = sa.elements.map(fmtElement).filter(Boolean);
    if (!elems.length) hasNE = true;
    for (const e of elems) (e === 'NE' ? (hasNE = true) : named.add(e));
  }
  if (hasNE) named.add('NE');
  return [...named].join(', ');
}

// N when the attack ignores reflection or counter_enable is 0 (docs/decisions.md "Counter column").
function counterColumn(parsed) {
  const exec = execAbility(parsed);
  const subActions = exec !== parsed ? [...parsed.subActions, ...exec.subActions] : parsed.subActions;
  return parsed.counterable === 'Yes' && !subActions.some(sa => sa.props.ignoresReflection) ? 'Y' : 'N';
}

// What kind of damage the attacks deal, from their SUB_ACTION_TYPE.
const PHYSICAL_ATTACKS = new Set(['PHYSICAL_ATTACK']);
const MAGICAL_ATTACKS  = new Set(['BLACK_MAGIC_ATTACK', 'WHITE_MAGIC_ATTACK', 'SUMMON_ATTACK', 'NINJUTSU_ATTACK']);
function damageFormula(parsed) {
  const kinds = attackSubActions(parsed).map(sa => String(sa.type));
  const physical = kinds.some(k => PHYSICAL_ATTACKS.has(k));
  const magical  = kinds.some(k => MAGICAL_ATTACKS.has(k));
  if ((physical && magical) || kinds.includes('INBORN')) return 'Hybrid';
  return physical ? 'Physical' : magical ? 'Magical' : null;
}

function combatColumns(parsed) {
  const { type, formula } = typeAndFormula(parsed);
  const multiplier = multiplierColumn(parsed);
  const columns = { type, formula, multiplier, ...targetColumns(parsed), element: elementColumn(parsed), counter: counterColumn(parsed) };
  // Type is the ability's class; Formula is the damage its attacks deal. Hybrid means
  // two damage types and shows Multiplier "-" (docs/decisions.md "Hybrid formula").
  if (type === 'NAT') {
    const damage = multiplier ? damageFormula(parsed) : null;
    Object.assign(columns, damage === 'Hybrid' ? { formula: 'Hybrid', multiplier: '-' }
                         : damage ? { formula: damage } : { formula: '', multiplier: '' });
  }
  return columns;
}

// Renders one sheet-tab preview: a "Copy row" button with the tab-separated row to
// paste into the sheet, and a table of the columns. Shared by every tab's builder.
// columns: [{ col, val, rawVal?, src?, tdId?, tdExtra? }] in sheet order. val is plain
// text unless rawVal is given, in which case val is markup and rawVal its text.
// src marks values taken from the sheet itself rather than derived from the JSON.
function renderSheetPreview({ title, idPrefix, id, columns }) {
  const escapeHtml = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const text = c => String(c.rawVal ?? c.val ?? '');
  const tsvRow = columns.map(c => text(c).replace(/[\t\n\r]/g, ' ')).join('\t');

  let html = `<details class="sb-preview-details"><summary>${title}</summary>`;
  html += `<div class="sb-preview">`;
  html += `<div class="sbp-copy-row">`;
  html += `<button class="sbp-copy-btn" onclick="
    const v = this.nextElementSibling.value;
    navigator.clipboard.writeText(v).then(
      () => { this.textContent = 'Copied!'; setTimeout(() => this.textContent = 'Copy row', 1500); },
      () => { this.nextElementSibling.select(); document.execCommand('copy');
              this.textContent = 'Copied!'; setTimeout(() => this.textContent = 'Copy row', 1500); }
    )">Copy row</button>`;
  html += `<textarea class="sbp-tsv-area" id="${idPrefix}-tsv-${id}" rows="1" readonly>${escapeHtml(tsvRow)}</textarea>`;
  html += `</div>`;
  html += `<table class="sb-preview-table">`;
  html += `<thead><tr><th>Column</th><th>Value</th></tr></thead><tbody>`;
  for (const c of columns) {
    const cls   = text(c) === '' ? 'sbp-empty' : c.src ? 'sbp-sheet' : 'sbp-derived';
    const attrs = (c.tdId ? ` id="${c.tdId}"` : '') + (c.tdExtra ? ` ${c.tdExtra}` : '');
    const shown = c.rawVal != null ? c.val : escapeHtml(c.val ?? '');
    html += `<tr><td class="sbp-col">${c.col}</td><td class="${cls}"${attrs}>${shown}</td></tr>`;
  }
  html += `</tbody></table>`;
  html += `<div class="sbp-legend"><span class="sbp-sheet-badge">■</span> from sheet &nbsp; <span class="sbp-derived-badge">■</span> derived from JSON</div>`;
  html += `</div></details>`;
  return html;
}

// ─── SB sheet column preview ──────────────────────────────────────────────────
// sheetAs: { id, name, sbVer } when the row is listed under another ID and name — a
// Tactical soul break's weapon skill is "<soul break> (Weapon Skill)" under the soul
// break's ID. Its on-page ids get a "-ws" suffix so the two rows stay distinct.
function renderSBSheetPreview(parsed, sb, actorName, genEffects, sheetElement, actorRealm = '', sheetAs = null) {
  const { type, formula, multiplier, target, autoTarget, element, counter } = combatColumns(parsed);
  const id                     = sheetAs?.id ?? parsed.abilityId;
  const domId                  = sheetAs ? `${id}-ws` : id;
  const imgFormula             = `=image(CONCATENATE("https://dff.sp.mbga.jp/dff/static/lang/image/soulstrike/",${id},"/",${id},"_256.png"),4,64,64)`;

  // ── Per-column value/src for all columns we know how to derive ──
  // Name: use sheet English name if present; otherwise show JP name and auto-translate.
  const nameEntry = (() => {
    const sheetName = sb?.['Name'];
    if (sheetName) {
      return { val: sheetName, rawVal: sheetName, src: true };
    }
    if (sheetAs?.name) return { val: sheetAs.name };
    const jpText = parsed.nameJp || parsed.name || '';
    const safe   = jpText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const jpAttr = jpText.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return {
      val:    `<span class="sbp-name-val">${safe}</span><span class="sbp-translating">⟳</span>`,
      rawVal: jpText,
      src:    false,
      tdId:   `sbp-name-${domId}`,
      tdExtra: `data-translate-jp="${jpAttr}"`,
    };
  })();

  const SOUL_STRIKE_TIER = {
     1: 'Default',            2: 'Shared',  3: 'SB',    4: 'SSB',   5: 'BSB',
     6: 'OSB',                7: 'USB',     8: 'CSB',   9: 'AOSB', 10: 'G',
    11: 'AASB',              12: 'SASB',   13: 'LBO',  14: 'LIMIT_BREAK_SENGI', 15: 'LBG',
    16: 'LBG',               17: 'DASB',  18: 'LBC',  19: 'ZSB',  20: 'OZSB',
    21: 'CASB',              22: 'ASB',   23: 'MASB',  24: 'LBSD', 25: 'TASB',
    26: 'Buster',            27: 'XSB',
  };

  // Tier: the sheet's when the soul break has a row (docs/decisions.md "Naming").
  const tier = sb?.['Tier'] || SOUL_STRIKE_TIER[parsed.soulStrikeCategory] || '';

  const colValues = {
    'Realm':          { val: sb?.['Realm']     || actorRealm || '',                                                             src: !!sb?.['Realm'] },
    'Character':      { val: sb?.['Character'] || actorName || '',                                                             src: !!sb?.['Character'] },
    'Name':           nameEntry,
    'Tier':           { val: tier,                                                                                        src: !!sb?.['Tier'] },
    'SB Ver':         { val: sb?.['SB Ver'] || sheetAs?.sbVer || soulBreakVersion(sb, sb?.['Character'] || actorName, tier), src: !!sb?.['SB Ver'] },
    'Type':           { val: type,                                                                                        src: false },
    'Target':         { val: target,                                                                                      src: false },
    'Formula':        { val: formula,                                                                                     src: false },
    'Multiplier':     { val: multiplier,                                                                                  src: false },
    'Element':        { val: element,                                                                                     src: false },
    'Time':           { val: parsed.castTime ?? '',                                                                      src: false },
    'Effects':        { val: genEffects,                                                                                  src: false },
    'Counter':        { val: counter,                                                                                     src: false },
    'Auto Target':    { val: autoTarget,                                                                                  src: false },
    'Points':         { val: parsed.sbCost ?? '',                                                                        src: false },
    'Mastery Bonus':  { val: '',                                                                                          src: false },
    'Honing Effects': { val: '',                                                                                          src: false },
    'Relic':          { val: sb?.['Relic'] || '',                                                                         src: !!sb?.['Relic'] },
    'Name (JP)':      { val: parsed.nameJp || parsed.name,                                                               src: false },
    'ID':             { val: id,                                                                                          src: false },
    'Anima':          { val: '',                                                                                          src: false },
    'GL':             { val: '',                                                                                          src: false },
  };

  const COLUMN_ORDER = ['Realm', 'Character', 'Img', 'Name', 'Tier', 'SB Ver', 'Type', 'Target', 'Formula', 'Multiplier', 'Element', 'Time', 'Effects', 'Counter', 'Auto Target', 'Points', 'Mastery Bonus', 'Honing Effects', 'Relic', 'Name (JP)', 'ID', 'Anima', 'GL', '✓'];
  return renderSheetPreview({
    title: 'Soul Break tab columns', idPrefix: 'sbp', id: domId,
    columns: COLUMN_ORDER.map(col => col === 'Img' ? { col, val: imgFormula } : { col, ...(colValues[col] ?? { val: String(sb?.[col] ?? ''), src: !!sb?.[col] }) }),
  });
}

function renderStatusList(statuses, label) {
  if (!statuses || statuses.length === 0) return '';
  const tags = statuses.map(s => {
    const idLabel = s.id != null ? ` <span style="color:#888;font-size:11px;">(${s.id})</span>` : '';
    return statusTag(s) + idLabel;
  }).join('');
  return `<tr><th>${label}</th><td>${tags}</td></tr>`;
}

function renderProps(props) {
  if (!props) return '';
  let html = '';
  const labels = {
    multiplier:     ['Multiplier', 'val-num'],
    physMultiplier: ['Physical Multiplier', 'val-num'],
    magMultiplier:  ['Magical Multiplier', 'val-num'],
    healingFactor:  ['Healing Factor', 'val-num'],
    removesKO:      ['Removes KO', 'val-num'],
    hits:           ['Hits', 'val-num'],
    critRate:       ['Critical Rate %', 'val-num'],
    maxHpDamage:    ['Max HP Damage %', 'val-num'],
    currentHpDamage:['Current HP Damage %', 'val-num'],
    fixedDamage:    ['Fixed Damage', 'val-num'],
    minDamageFactor:['Min Damage Factor', 'val-num'],
    defPierce:      ['DEF Pierce Factor', 'val-num'],
    resPierce:      ['RES Pierce Factor', 'val-num'],
    hpCostPercent:  ['HP Cost %', 'val-num'],
    lifesteal:      ['Lifesteal %', 'val-num'],
    selfKOChance:   ['Self KO Chance %', 'val-num'],
    fixedHeal:      ['Fixed Heal HP', 'val-num'],
    chainType:      ['Chain Type', 'val-str'],
    chainElement:   ['Chain Element', 'val-str'],
    chainFieldBoost:['Chain Field Boost %', 'val-num'],
    chainMaxCount:  ['Chain Max Count', 'val-num'],
    range:          ['Range', 'val-str'],
    synchroAbility1:['Synchro Slot 1 ID', 'val-num'],
    synchroAbility2:['Synchro Slot 2 ID', 'val-num'],
    autoHit:        ['Auto-Hit', 'val-str'],
    randomTarget:   ['Random Target', 'val-str'],
    ignoresAstra:   ['Ignores Astra', 'val-str'],
    ignoresPhysBlink:['Ignores Phys Blink','val-str'],
    ignoresMagBlink: ['Ignores Mag Blink', 'val-str'],
    ignoresReflect: ['Ignores Reflect', 'val-str'],
    statusDuration: ['Status Duration', 'val-str'],
    damageCapBoost: ['Damage Cap Boost', 'val-num'],
    overflow:       ['Overflow', 'val-str'],
    currentHpBarter:['HP Barter (current) %', 'val-num'],
    maxHpBarter:    ['HP Barter (max) %', 'val-num'],
    ranged:         ['Ranged', 'val-str'],
    jump:           ['Jump', 'val-str'],
  };
  for (const [k, [label, cls]] of Object.entries(labels)) {
    if (props[k] !== undefined && props[k] !== false) html += row(label, props[k], cls);
  }
  const shown = new Set(Object.keys(labels));
  for (const [k, v] of Object.entries(props)) {
    if (!shown.has(k) && v !== undefined && v !== false) html += row(k, v, 'val-str');
  }
  return html;
}

// ─── Crystal Commands sheet column preview ────────────────────────────────────
function renderCFSheetPreview(parsed, cfParent, genEffects) {
  // Shared helpers (same logic as renderSBSheetPreview, closed over this parsed)

  const id                        = parsed.abilityId;
  const { type, formula, multiplier, target, autoTarget, element, counter } = combatColumns(parsed);
  const imgFormula                = `=IMAGE("https://dff.sp.mbga.jp/dff/static/lang/image/crystal_force/crystal_force.png")`;

  const colValues = {
    'Character':   { val: cfParent?.character || '' },
    'Source':      { val: cfParent?.sbName    || '' },
    'SB Ver':      { val: cfParent?.sbVer || 'CASB'  },
    'Name':        { val: 'Crystal Force I'         },
    'Type':        { val: type                      },
    'Target':      { val: target                    },
    'Formula':     { val: formula                   },
    'Multiplier':  { val: multiplier                },
    'Element':     { val: element                   },
    'Time':        { val: parsed.castTime ?? ''     },
    'Effects':     { val: genEffects                },
    'Counter':     { val: counter                   },
    'Auto Target': { val: autoTarget                },
    'SB':          { val: '-'                       },
    'School':      { val: schoolName(parsed.category) },
    'Name (JP)':   { val: parsed.name               },
    'ID':          { val: id                        },
    'GL':          { val: ''                        },
    '✓':           { val: ''                        },
  };

  const COLUMN_ORDER = ['Character', 'Source', 'SB Ver', 'Img', 'Name', 'Type', 'Target', 'Formula', 'Multiplier', 'Element', 'Time', 'Effects', 'Counter', 'Auto Target', 'SB', 'School', 'Name (JP)', 'ID', 'GL', '✓'];
  return renderSheetPreview({
    title: 'Crystal Commands tab columns', idPrefix: 'cfp', id,
    columns: COLUMN_ORDER.map(col => col === 'Img' ? { col, val: imgFormula } : { col, ...(colValues[col] ?? { val: '' }) }),
  });
}

// ─── Extra sheet column preview (Extra Kiwami abilities) ─────────────────────
function renderExtraSheetPreview(parsed, ekParent, genEffects) {

  const id         = parsed.abilityId;
  const { type, formula, multiplier, target, autoTarget, element, counter } = combatColumns(parsed);
  const heroRow    = lookupHeroAbility(id);
  const otherRow   = lookupOtherAbility(id);
  const extraRow   = lookupExtraAbility(id);
  const nameEn     = (extraRow ?? heroRow ?? otherRow)?.['Name'] || '';
  const imgFormula = `=IMAGE("https://dff.sp.mbga.jp/dff/static/lang/image/ability/${id}/${id}_128.png")`;

  const colValues = {
    'Character':  {val: ekParent?.character||''},
    'Source':     {val: ekParent?.sbName||''},
    'SB Ver':     {val: ekParent?.sbVer || 'XSB'},
    'Name':       {val: nameEn},
    'Type':       {val: type},
    'Target':     {val: target},
    'Formula':    {val: formula},
    'Multiplier': {val: multiplier},
    'Element':    {val: element},
    'Time':       {val: parsed.castTime??''},
    'Effects':    {val: genEffects},
    'Counter':    {val: counter},
    'Auto Target':{val: autoTarget},
    'SB':         {val: String(parsed.sbCharge || '')},
    'School':     {val: schoolName(parsed.category)},
    'Name (JP)':  {val: parsed.name},
    'ID':         {val: id},
    '✓':     {val: ''},
  };

  const COLUMN_ORDER = ['Character','Source','SB Ver','Img','Name','Type','Target', 'Formula','Multiplier','Element','Time','Effects','Counter', 'Auto Target','SB','School','Name (JP)','ID','✓'];
  return renderSheetPreview({
    title: 'Extra tab columns', idPrefix: 'ekp', id,
    columns: COLUMN_ORDER.map(col => col === 'Img' ? { col, val: imgFormula } : { col, ...(colValues[col] ?? { val: '' }) }),
  });
}

// ─── Follow-Up Ability: Other tab column preview ─────────────────────────────
function renderFollowUpSheetPreview(parsed, genEffects, source = '') {

  const id = parsed.abilityId;
  const otherRow = lookupOtherAbility(id);
  const { type, formula, multiplier, target, autoTarget, element, counter } = combatColumns(parsed);

  const colValues = {
    'Source Type': { val: 'Follow-Up Status' },
    'Source':      { val: otherRow?.['Source'] || source || chaseSourceName(id), src: !!otherRow?.['Source'] },
    'Name':        { val: otherRow?.['Name']   || tpMaxName(source) || parsed.name, src: !!otherRow?.['Name'] },
    'Type':        { val: type               },
    'Target':      { val: target             },
    'Formula':     { val: formula            },
    'Multiplier':  { val: multiplier         },
    'Element':     { val: element            },
    'Time':        { val: '0.01'             },
    'Effects':     { val: genEffects         },
    'Counter':     { val: counter            },
    'Auto Target': { val: autoTarget         },
    'SB':          { val: '0'               },
    'School':      { val: schoolName(parsed.category) },
    'ID':          { val: String(id)        },
    'GL':          { val: ''               },
    '✓':           { val: '✓'             },
  };

  const imgFormula = ''; // Other-tab follow-up rows leave the image blank
  const COLUMN_ORDER = ['Source Type', 'Source', 'Img', 'Name', 'Type', 'Target', 'Formula', 'Multiplier', 'Element', 'Time', 'Effects', 'Counter', 'Auto Target', 'SB', 'School', 'ID', 'GL', '✓'];
  return renderSheetPreview({
    title: 'Other tab columns (Follow-Up)', idPrefix: 'fup', id,
    columns: COLUMN_ORDER.map(col => col === 'Img' ? { col, val: imgFormula } : { col, ...(colValues[col] ?? { val: '' }) }),
  });
}

// Returns the top-level parsed ability followed by all sub-abilities, depth-first.
function collectChain(parsed) {
  const chain = [parsed];
  for (const sub of parsed.subAbilities) chain.push(...collectChain(sub));
  return chain;
}

// Renders the parsed-info table + sub-actions for a single ability object.
function renderParsedInfoSection(p) {
  let html = '';
  const pElemTags = p.elements.map(elementTag).join('');

  html += `<table style="table-layout:fixed;width:100%"><colgroup><col style="width:240px"><col></colgroup>`;
  html += `<tr><td colspan="2" class="section-header">Identification</td></tr>`;
  html += row('Name', p.name, 'val-str');
  html += row('Ability ID', p.abilityId, 'val-num');
  html += row('Action ID', p.actionId, 'val-num');
  html += row('Formula Class', p.formulaClass, 'val-str');
  html += row('Exercise Type', p.exerciseType, 'val-str');
  html += row('Ability Class', p.category, 'val-str');
  html += row('Cast Time (s)', p.castTime, 'val-num');
  html += row('SB Charge', p.sbCharge || null, 'val-num');
  html += row('Counterable', p.counterable, 'val-str');
  if (p.soulStrikeCategory) {
    const catName = DB.soulStrikeCategories[p.soulStrikeCategory] ?? null;
    html += row('Soul Strike Category ID',   p.soulStrikeCategory, 'val-num');
    html += row('Soul Strike Category Name', catName, 'val-str');
  }
  if (p.attachElements && p.attachElements.length > 0) {
    const atElemTags = p.attachElements.map(id => elementTag(DB.elementTypes[id] ?? `ELEMENT_${id}`)).join('');
    html += `<tr><th>Possible Attach Element(s)</th><td>${atElemTags}</td></tr>`;
  }
  html += row('Attach Element Level', p.attachElementLevel, 'val-num');
  html += row('Attach Element Add Max Level', p.attachElementAddMaxLevel, 'val-num');
  if (p.kiwamiAbilityId) {
    const kiwamiSb = DB.soulBreaksMap[p.kiwamiAbilityId];
    const kiwamiLabel = kiwamiSb ? `${p.kiwamiAbilityId} — ${kiwamiSb['Name'] ?? ''}` : String(p.kiwamiAbilityId);
    html += row('Kiwami Ability ID', kiwamiLabel, 'val-num');
  }
  if (p.replacePersonalAbilityId) {
    const replaceSb   = DB.soulBreaksMap[p.replacePersonalAbilityId];
    const replaceHero = DB.heroAbilitiesMap[p.replacePersonalAbilityId];
    const replaceName = (replaceSb ?? replaceHero)?.['Name'] ?? '';
    const replaceLabel = replaceName ? `${p.replacePersonalAbilityId} — ${replaceName}` : String(p.replacePersonalAbilityId);
    html += row('Replace Personal Ability ID', replaceLabel, 'val-num');
  }

  if (p.actionArgs.length > 0) {
    html += `<tr><td colspan="2" class="section-header">Action Args</td></tr>`;
    for (const a of p.actionArgs) html += row(a.type ?? `arg${a.argNum}`, a.value, 'val-str');
  }

  html += `<tr><td colspan="2" class="section-header">Targeting</td></tr>`;
  html += row('Range',  p.target.range,   'val-str');
  html += row('Method', p.target.method,  'val-str');
  html += row('Segment',p.target.segment, 'val-str');
  html += row('Active Target', p.target.active, 'val-str');

  if (pElemTags) {
    html += `<tr><td colspan="2" class="section-header">Elements</td></tr>`;
    html += `<tr><th>Element(s)</th><td>${pElemTags}</td></tr>`;
  }

  html += `<tr><td colspan="2" class="section-header">Properties</td></tr>`;
  html += renderProps(p.props);

  if (p.statuses.length > 0) {
    html += `<tr><td colspan="2" class="section-header">Status Effects Applied</td></tr>`;
    for (const s of p.statuses) {
      const label = s.target ? `${s.target}` : 'default target';
      const dur = s.duration ? ` · ${s.duration}` : '';
      const effText = statusEffectsText(s);
      const effects = effText ? `<br><span style="color:#888;font-size:11px;">${effText}</span>` : '';
      const idLabel = s.id != null ? ` <span style="color:#888;font-size:11px;">(${s.id})</span>` : '';
      html += `<tr><th>Status (${label}${dur})</th><td>${statusTag(s)}${idLabel}${effects}</td></tr>`;
      if (s.fromBundle) html += row('  (from bundle)', DB.statusBundles[s.fromBundle] ?? s.fromBundle, 'val-str');
    }
  }

  if (p.unknownArgs.length > 0) {
    html += `<tr><td colspan="2" class="section-header">Unrecognised Args</td></tr>`;
    for (const u of p.unknownArgs) html += row(u.type, u.value, 'val-str');
  }

  html += `</table>`;

  if (p.subActions.length > 0) {
    html += `<div class="section-header" style="margin-top:8px;">Sub-actions (${p.subActions.length})</div>`;
    p.subActions.forEach((sa, i) => {
      html += `<div class="subaction-block"><b>Sub-action ${i+1}</b><table style="table-layout:fixed;width:100%"><colgroup><col style="width:240px"><col></colgroup>`;
      html += row('Type', sa.type, 'val-str');
      html += row('Target', sa.target, 'val-str');
      if (sa.conditionType) html += row('Condition Type', sa.conditionType, 'val-str');
      if (sa.controlType)   html += row('Control Statement', sa.controlType, 'val-str');
      if (sa.conditionArg)  html += row('Condition Arg', sa.conditionArg, 'val-str');
      html += renderProps(sa.props);
      if (sa.elements.length) html += `<tr><th>Elements</th><td>${sa.elements.map(elementTag).join('')}</td></tr>`;
      if (sa.statuses.length) {
        for (const s of sa.statuses) {
          const effText = statusEffectsText(s);
          const effects = effText ? `<br><span style="color:#888;font-size:11px;">${effText}</span>` : '';
          const idLabel = s.id != null ? ` <span style="color:#888;font-size:11px;">(${s.id})</span>` : '';
          html += `<tr><th>Status</th><td>${statusTag(s)}${idLabel}${effects}</td></tr>`;
        }
      }
      if (sa.synchroConditions.length) {
        for (const sc of sa.synchroConditions) {
          html += row(`Synchro Slot ${sc.slot}`, sc.conditions.join(', ') || '(any)', 'val-str');
        }
      }
      html += `</table></div>`;
    });
  }

  return html;
}

// ctx: { actorName, actorRealm, relations } — see recordRelations().
function renderAbility(parsed, depth, ctx) {
  const { actorName, actorRealm, relations } = ctx;
  depth = depth ?? 0;
  const sb = lookupSoulBreak(parsed.abilityId);
  const other = !sb ? lookupOtherAbility(parsed.abilityId) : null;

  let html = '';

  // Soul Break / Other sheet match
  if (sb) {
    html += `<div class="sb-row">`;
    html += `<span class="sb-name">${sb['Name'] ?? ''}</span> `;
    html += `<span class="sb-meta">${sb['Character'] ?? ''} · ${sb['Realm'] ?? ''} · ${sb['Tier'] ?? ''}</span>`;
    html += `</div>`;
  } else if (other) {
    html += `<div class="sb-row" style="border-left-color:#c586c0">`;
    html += `<span class="sb-name">${other['Name'] ?? ''}</span>`;
    if (other['Source']) html += ` <span class="sb-meta">from: ${other['Source']}</span>`;
    html += `</div>`;
  } else {
    html += `<div class="sb-row" style="border-left-color:#555">`;
    html += `<span class="sb-name">${parsed.name}</span>`;
    html += ` <span class="sb-meta">ID: ${parsed.abilityId}</span>`;
    html += `</div>`;
  }

  // Effects comparison block
  const sheetEffects  = sb?.['Effects'] ?? other?.['Effects'] ?? null;
  const sheetElement  = sb?.['Element'] ?? other?.['Element'] ?? null;
  const genText = generateEffectsText(parsed);
  html += `<div class="effects-block">`;
  html += `<div class="effects-gen"><span class="effects-label">Generated:</span>${genText}</div>`;
  if (sheetEffects) {
    html += `<div class="effects-sheet"><span class="effects-label">Sheet:</span>${sheetEffects}</div>`;
  }
  html += `</div>`;

  // Soul Break sheet column preview — only for depth-0 soul strikes
  // (sheet match present, or soul_strike_category_id indicates it's a soul strike without a sheet entry)
  // Also forced for BUSTER_SHINGI sub-abilities (defaultAbilityId / repeatSkillAbilityId) via relations.busterParent.
  // Not for an Extra soul break's Ability Crash: it has a soul strike category but
  // belongs only on the Other tab (docs/decisions.md "Ability Crush (arg2)").
  const busterShingiParent = relations.busterParent[parseInt(parsed.abilityId)];
  const isAbilityCrash = relations.extraCrushSource[parseInt(parsed.abilityId)] !== undefined;
  const masterFinishSource = relations.masterFinish[parseInt(parsed.abilityId)];
  if (depth === 0 && !isAbilityCrash && masterFinishSource === undefined && (sb !== null || parsed.soulStrikeCategory !== null || busterShingiParent)) {
    const weaponSkillOf = relations.weaponSkillParent[parseInt(parsed.abilityId)];
    const wsParent = weaponSkillOf ?? busterShingiParent;
    const sbActorName  = wsParent?.character || actorName;
    const sbActorRealm = wsParent?.realm     || actorRealm;
    const sheetAs = weaponSkillOf?.parentId ? {
      id:    weaponSkillOf.parentId,
      name:  `${weaponSkillOf.parentName} (Weapon Skill)`,
      sbVer: weaponSkillOf.sbVer,
      row:   DB.soulBreakWeaponSkillMap[weaponSkillOf.parentId] ?? null,
    } : null;
    html += renderSBSheetPreview(parsed, sheetAs ? sheetAs.row : sb, sbActorName, genText, sheetElement, sbActorRealm, sheetAs);
  }

  // Crystal Commands sheet column preview — for Crystal Force abilities
  const cfParent = relations.cfParent[parsed.abilityId];
  if (cfParent) {
    html += renderCFSheetPreview(parsed, cfParent, genText);
  }

  // Other tab column preview — for follow-up (chase) abilities
  if (DB.chaseAbilityIdToKey[parseInt(parsed.abilityId)]) {
    html += renderFollowUpSheetPreview(parsed, genText);
  }

  // Other tab column preview — for TAM tpMaxAbilityId / weaponSkillAbilityId
  const tamSource = relations.tamSource[parseInt(parsed.abilityId)];
  if (tamSource !== undefined) {
    html += renderFollowUpSheetPreview(parsed, genText, tamSource);
  }

  // Other tab column preview — for BUSTER_SHINGI chase/other sub-abilities
  const busterOtherSource = relations.busterOtherSource[parseInt(parsed.abilityId)];
  if (busterOtherSource !== undefined && !DB.chaseAbilityIdToKey[parseInt(parsed.abilityId)]) {
    html += renderFollowUpSheetPreview(parsed, genText, busterOtherSource);
  }

  // Extra tab column preview — for EXTRA_ZETSUGI extra kiwami abilities
  const ekParent = relations.extraKiwamiParent[parseInt(parsed.abilityId)];
  if (ekParent) {
    html += renderExtraSheetPreview(parsed, ekParent, genText);
  }

  // Other tab column preview — for a Master soul break's closing follow-up
  if (masterFinishSource !== undefined) {
    html += renderFollowUpSheetPreview(parsed, genText, masterFinishSource);
  }

  // Other tab column preview — for EXTRA_ZETSUGI ability crush (arg2)
  const ekCrushSource = relations.extraCrushSource[parseInt(parsed.abilityId)];
  if (ekCrushSource !== undefined) {
    html += renderFollowUpSheetPreview(parsed, genText, ekCrushSource);
  }

  // Parsed Info collapsible — shows info for this ability and all wrapped sub-abilities
  const chain = collectChain(parsed);
  html += `<details><summary>Parsed info — ${parsed.name} (ID: ${parsed.abilityId})</summary>`;
  html += `<div class="parsed-info">`;
  for (const p of chain) {
    if (chain.length > 1) {
      html += `<div class="chain-header">${p.name} <span class="chain-ids">ID: ${p.abilityId} · Action: ${p.actionId}</span></div>`;
    }
    html += renderParsedInfoSection(p);
  }
  html += `</div></details>`;

  return html;
}

// ─── Relations between abilities in one actor's kit ──────────────────────────
// Sub-abilities that belong on another sheet tab (Crystal Commands, Extra, Other)
// need their parent soul break's character, realm or name. recordRelations()
// collects these while the actor's abilities are processed (soul_strikes come
// before abilities, so parents are seen first); renderAbility() reads them.
function newRelations() {
  return {
    cfParent:          {}, // CF ability ID → { character, sbName }
    tamSource:         {}, // TAM tpMaxAbilityId → label
    weaponSkillParent: {}, // weaponSkillAbilityId → { character, realm } from parent SB
    busterParent:      {}, // BUSTER_SHINGI defaultAbilityId/repeatSkillAbilityId → { character, realm }
    busterOtherSource: {}, // BUSTER_SHINGI chase/other sub-abilities → source label (chase mode status name)
    extraKiwamiParent: {}, // EXTRA_ZETSUGI extra kiwami ability IDs (arg3/5/7/9/11) → { character, realm, sbName }
    extraCrushSource:  {}, // EXTRA_ZETSUGI ability crush ID (arg2) → source label (parent SB name)
    masterFinish:      {}, // MASB masterFinishAbilityId → source label ("Master Mode: <character>")
  };
}

// Records what parsed (a top-level ability card; ability is its raw JSON) says
// about its sub-abilities into ctx.relations.
function recordRelations(parsed, ability, ctx) {
  const { actorName, actorRealm, relations } = ctx;
  // Record parent SB info for any Crystal Force sub-abilities
  const sbRow = lookupSoulBreak(parsed.abilityId);
  if (sbRow) {
    for (const sub of parsed.subAbilities) {
      if (sub._label === 'crystalForceAbilityId') {
        relations.cfParent[sub.abilityId] = {
          character: sbRow['Character'] || actorName,
          sbName:    sbRow['Name']      || '',
          sbVer:     soulBreakVersion(sbRow, sbRow['Character'] || actorName, sbRow['Tier'] || 'CASB'),
        };
      }
    }
  }

  // Record TAM other-tab ability (tpMaxAbilityId only)
  // Record weapon skill parent context for character/realm inheritance
  const defaultAb = parsed.subAbilities.find(s => s._label === 'defaultAbilityId' || s._label === 'arg1');
  let tamModeName = '';
  if (defaultAb) {
    outer: for (const sa of defaultAb.subActions) {
      for (const s of sa.statuses) {
        if ((s.commonName ?? '').startsWith('Tactical Awoken Mode')) { tamModeName = s.commonName; break outer; }
      }
    }
  }
  for (const sub of parsed.subAbilities) {
    if (sub._label === 'tpMaxAbilityId') {
      relations.tamSource[sub.abilityId] = tamModeName;
    }
    if (sub._label === 'weaponSkillAbilityId') {
      relations.weaponSkillParent[sub.abilityId] = {
        character:  sbRow?.['Character'] || actorName,
        realm:      sbRow?.['Realm']     || actorRealm,
        // A Tactical soul break's weapon skill is listed under the soul break's own ID
        // as "<name> (Weapon Skill)", with the soul break's version.
        parentId:   parsed.abilityId,
        parentName: sbRow?.['Name'] || parsed.name,
        sbVer:      soulBreakVersion(sbRow, sbRow?.['Character'] || actorName, sbRow?.['Tier'] || 'TASB'),
      };
    }
    if (sub._label === 'defaultAbilityId' || sub._label === 'repeatSkillAbilityId') {
      if (DB.soulStrikeCategories[parsed.soulStrikeCategory] === 'BUSTER_SHINGI') {
        relations.busterParent[sub.abilityId] = {
          character: sbRow?.['Character'] || actorName,
          realm:     sbRow?.['Realm']     || actorRealm,
        };
        // Chase/other sub-abilities of defaultAbilityId go to the Other tab.
        // Source = first CHASE_MODE_* status found in defaultAbilityId's sub-actions.
        if (sub._label === 'defaultAbilityId') {
          let chaseModeSource = '';
          outer: for (const sa of sub.subActions) {
            for (const s of sa.statuses) {
              const ck = (s.codedName ?? '').toUpperCase();
              const cn = s.commonName ?? '';
              if (ck.startsWith('CHASE') || cn.toLowerCase().includes('chase')) {
                chaseModeSource = cn || ck;
                break outer;
              }
            }
          }
          for (const chase of sub.subAbilities) {
            relations.busterOtherSource[chase.abilityId] = chaseModeSource;
          }
        }
      }
    }
  }

  // Master soul break: the follow-up cast when Master Mode ends belongs on the Other tab,
  // sourced from the "Master Mode: <character>" status the soul break grants.
  const masterFinish = parsed.subAbilities.find(sub => sub._label === 'masterFinishAbilityId');
  if (masterFinish) {
    const modeName = parsed.subAbilities.flatMap(sub => sub.subActions).flatMap(sa => sa.statuses)
      .map(st => st.commonName ?? '').find(n => n.startsWith('Master Mode: ')) ?? '';
    relations.masterFinish[masterFinish.abilityId] = modeName;
  }

  // Populate relations.extraKiwamiParent and relations.extraCrushSource from raw args.
  if (DB.soulStrikeCategories[parsed.soulStrikeCategory] === 'EXTRA_ZETSUGI') {
    const crushId = parseInt(ability.options?.arg2 ?? 0);
    if (crushId > 0) {
      relations.extraCrushSource[crushId] = sbRow?.['Name'] || parsed.name;
    }
    for (const argKey of ['arg3','arg5','arg7','arg9','arg11']) {
      const ekId = parseInt(ability.options?.[argKey] ?? 0);
      if (ekId > 0) {
        relations.extraKiwamiParent[ekId] = {
          character: sbRow?.['Character'] || actorName,
          realm:     sbRow?.['Realm']     || actorRealm,
          sbName:    sbRow?.['Name']      || parsed.name,
          sbVer:     soulBreakVersion(sbRow, sbRow?.['Character'] || actorName, sbRow?.['Tier'] || 'XSB'),
        };
      }
    }
  }
}

// Marks sub-abilities whose standalone cards are suppressed as already rendered.
function markSuppressedSubAbilities(parsed, renderedIds) {
  // Suppress standalone cards only for pure wrapper/visual sub-abilities.
  // Independent abilities (crystalForceAbilityId etc.) keep their own cards.
  // For BUSTER_SHINGI, defaultAbilityId is covered by the parent SB card.
  const suppressLabels = new Set(['wrappedAbilityId', 'cutinAbilityId']);
  if (DB.soulStrikeCategories[parsed.soulStrikeCategory] === 'BUSTER_SHINGI') {
    suppressLabels.add('defaultAbilityId');
  }
  function suppressChain(p) {
    for (const sub of p.subAbilities) {
      if (suppressLabels.has(sub._label)) {
        renderedIds.add(sub.abilityId);
        suppressChain(sub);
      }
    }
  }
  suppressChain(parsed);
}

// ─── Mixed-format parser: { soul_break_json }\n\nabilities:[...] ─────────────
// The pasted format has the soul break as a valid JSON object followed by an
// unquoted `abilities:[...]` block (JavaScript object literal syntax, not JSON).
//
// Key insight: JSON string values encode newlines as the two-character escape \n,
// not as a literal newline byte. So a literal newline followed by "abilities:" in
// the raw text can only appear BETWEEN the two blocks, never inside a JSON string.
function parseMixedFormat(text) {
  // Find where the abilities block starts — look for a literal newline + "abilities:"
  const abKeyIdx = text.search(/[\r\n]"?abilities"?\s*:/);
  if (abKeyIdx === -1) return null;

  const sbText  = text.slice(0, abKeyIdx).trim();
  const abBlock = text.slice(abKeyIdx).replace(/^[\s\S]*?abilities"?\s*:\s*/, '').trim();

  if (!abBlock.startsWith('[')) return null;

  let sb, abilities;
  try { sb        = JSON.parse(sbText);  } catch { return null; }
  try { abilities = JSON.parse(abBlock); } catch { return null; }

  return { ...sb, abilities };
}

// ─── Main parse entry point ───────────────────────────────────────────────────
function processBattleJson(jsonText) {
  let json;
  try {
    json = JSON.parse(jsonText);
  } catch {
    // Try mixed format: { soul_break_json }\n\nabilities:[...]
    json = parseMixedFormat(jsonText);
    if (!json) throw new Error('Invalid JSON — expected a battle object, a soul break, or the FFRK mixed format ({ soul_break }\\nabilities:[...])');
  }

  // Normalise: support top-level battle object, buddy/supporter wrapper, or single ability
  if (!json.battle) {
    if (json.buddy || json.supporter) {
      json = { battle: json };
    } else {
      // Single soul break, possibly with a companion abilities[] list from the mixed format
      const companionAbilities = Array.isArray(json.abilities) ? json.abilities : [];
      const sb = { ...json };
      delete sb.abilities;
      json = { battle: { buddy: [{ id: 0, params: [{ disp_name: 'Unknown' }], soul_strikes: [sb], abilities: companionAbilities }] } };
    }
  }

  const actors = [...(json.battle.supporter ?? []), ...(json.battle.buddy ?? [])];
  const allAbilities = actors.flatMap(a => [...(a.soul_strikes ?? []), ...(a.abilities ?? [])]);

  const resultsEl = document.getElementById('results');
  resultsEl.innerHTML = '';

  for (const actor of actors) {
    const actorCharRow = DB.charactersMap[actor.id];
    const actorName  = actorCharRow?.['Name']  ?? actor.params?.[0]?.disp_name ?? `Actor ${actor.id}`;
    const actorRealm = actorCharRow?.['Realm'] ?? '';
    const parsedSet = new Set();

    let html = `<div class="ability-block">`;
    html += `<div class="actor-name">${actorName}</div>`;

    // All abilities (soul_strikes + abilities) rendered flat in one section.
    // Each gets a fresh parsedSet so internal sub-ability parsing for one card
    // doesn't consume IDs needed by subsequent cards.
    // renderedIds prevents the same ability_id appearing twice.
    const allActorAbilities = [
      ...(actor.soul_strikes ?? []),
      ...(actor.abilities    ?? []),
    ];
    const renderedIds = new Set();
    const ctx = { actorName, actorRealm, relations: newRelations() };
    if (allActorAbilities.length > 0) {
      html += `<h3>Abilities (${allActorAbilities.length})</h3>`;
      for (const ability of allActorAbilities) {
        if (renderedIds.has(ability.ability_id)) continue;
        renderedIds.add(ability.ability_id);
        const parsed = parseAbility(ability, allAbilities, new Set());
        if (parsed) {
          recordRelations(parsed, ability, ctx);
          markSuppressedSubAbilities(parsed, renderedIds);
          html += renderAbility(parsed, 0, ctx);
        }
      }
    }

    html += `</div>`;
    resultsEl.innerHTML += html;
  }

  // Auto-translate all JP names that were rendered
  resultsEl.querySelectorAll('[data-translate-jp]').forEach(cell => {
    const id = cell.id.replace('sbp-name-', '');
    translateSBName(id, cell.dataset.translateJp);
  });
}

// ─── Wire up UI ───────────────────────────────────────────────────────────────
document.getElementById('parse-btn').addEventListener('click', () => {
  const errEl = document.getElementById('parse-error');
  errEl.textContent = '';
  try {
    processBattleJson(document.getElementById('json-input').value.trim());
  } catch(e) {
    errEl.textContent = `Parse error: ${e.message}`;
  }
});


document.getElementById('reload-btn').addEventListener('click', async () => {
  const btn = document.getElementById('reload-btn');
  const errEl = document.getElementById('parse-error');
  btn.disabled = true;
  errEl.textContent = '';
  const refreshError = await refreshServerData();
  await Promise.all([loadBattleJs(), loadSheets()]);
  btn.disabled = false;
  if (refreshError) errEl.textContent = `Refresh skipped: ${refreshError} (using cached data)`;
  const json = document.getElementById('json-input').value.trim();
  if (json) {
    try { processBattleJson(json); }
    catch(e) { errEl.textContent = `Parse error: ${e.message}`; }
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
loadBattleJs();
loadSheets();

// Exposed for the Node tests (test/js); the page itself doesn't import anything from here.
export { DB, processBattleJson, parseAbility };
