// Status Decoder page script, loaded as an ES module by
// app/views/status_decoder/index.html.erb via javascript_import_module_tag.

import { extractConstantMap, invert } from 'ffrk/battle_js';
import { refreshServerData, splitSheetsResponse } from 'ffrk/server_data';
import { realmName, schoolName } from 'ffrk/names';
import { startBattleRuntime } from 'ffrk/battle_runtime';
import { describeStatus } from 'ffrk/status_text';

// ─── DB ──────────────────────────────────────────────────────────────────────
const DB = {
  // battle.js forward maps: name → id
  statusAilmentsForward: {},   // STATUS_KEY → id
  abilityIdOf:           {},   // ABILITY_KEY → id
  elementTypeForward:    {},   // ELEMENT_KEY → id

  // battle.js reverse maps: id → name
  elementTypes:          {},   // id → ELEMENT_KEY
  abilityCategories:     {},   // id → CATEGORY_KEY

  // Derived
  statusById:            {},   // id → STATUS_KEY
  damageFactor:          {},   // SIZE_NAME → numeric value
  statusAssignments:     {},   // STATUS_KEY → { funcName, argsText, defineModule, block }
  game:                  null, // { conf, statusParams } from running battle.js (ffrk/battle_runtime)
  helperBodies:          {},   // 'module|helperName' → helper source (for decoder fingerprints)
  // NOTE: funcName is local to its define() block's namespace.
  // The same name in a different define() block is a completely different function.
  // Always resolve function bodies using the block stored with the assignment.

  // Sheets
  statusMap:             {},   // id → { commonName, effects, duration, codedName }
  otherNameMap:          {},   // other ability id → name
  otherNamesBySource:    {},   // Other-tab Source → [ability names] (e.g. a mode's follow-ups)
  otherNamesByIdAndSource: {}, // 'id|Source' → name (one ability can be listed under several modes)
  otherSourcesById:      {},   // other ability id → [Sources] (e.g. a Spirit Attack → its Zenith Mode)
  otherEffectsBySource:  {},   // Other-tab Source → [Effects] of the abilities listed under it
  extraByCharacter:      {},   // character name → [ability Name strings] from Extra sheet
  charRealm:             {},   // character name → realm (Characters sheet)
  characterNames:        {},   // lower-case name → Characters sheet name
  learningModeCounts:    null, // camelCase name part → number of Learning Mode statuses (lazy)
};

// ─── Load state helpers ──────────────────────────────────────────────────────
let battleJsReady = false;
let sheetsReady   = false;
let parseReady    = false;

function setLoadState(key, state, detail) {
  const icon = document.getElementById(`li-${key}-icon`);
  const det  = document.getElementById(`li-${key}-detail`);
  if (icon) { icon.className = `load-icon ${state}`; icon.textContent = state === 'ok' ? '✓' : state === 'err' ? '✗' : state === 'loading' ? '…' : '○'; }
  if (det)  det.textContent = detail ?? '';
}

function checkAllLoaded() {
  if (battleJsReady && sheetsReady) {
    setLoadState('parse', 'loading', 'parsing status assignments…');
    setTimeout(() => {
      try {
        const t0 = performance.now();
        buildStatusAssignments();
        const ms = Math.round(performance.now() - t0);
        setLoadState('parse', 'ok', `${Object.keys(DB.statusAssignments).length} assignments in ${ms}ms`);
      } catch(e) {
        setLoadState('parse', 'err', e.message);
      }
      parseReady = true;
      enableSearch();
    }, 10); // yield to browser before heavy parse
  }
}

function enableSearch() {
  document.getElementById('status-input').disabled = false;
  document.getElementById('decode-btn').disabled   = false;
  document.getElementById('status-input').focus();
}

// ─── battle.js stored raw ────────────────────────────────────────────────────
let _rawBattleJs = '';

async function loadBattleJs() {
  setLoadState('battlejs', 'loading', 'fetching…');
  try {
    const resp = await fetch('/data/battle_js');
    if (!resp.ok) throw new Error(resp.status === 503 ? 'no cached data — run rake data:refresh' : `HTTP ${resp.status}`);
    _rawBattleJs = await resp.text();
    setLoadState('battlejs', 'loading', 'extracting constants…');

    const SAT  = extractConstantMap(_rawBattleJs, 'STATUS_AILMENTS_TYPE');
    const ELEM = extractConstantMap(_rawBattleJs, 'ELEMENT_TYPE');
    const CAT  = extractConstantMap(_rawBattleJs, 'ABILITY_CATEGORY_ID');

    DB.statusAilmentsForward = SAT;
    DB.statusById            = invert(SAT);
    DB.elementTypeForward    = ELEM;
    DB.elementTypes          = invert(ELEM);
    DB.abilityCategories     = invert(CAT);

    // Extract ABILITY_ID_OF — merge all occurrences (spread across multiple define() blocks)
    DB.abilityIdOf = extractConstantMap(_rawBattleJs, 'ABILITY_ID_OF');

    // Extract DAMAGE_FACTOR map
    const dfMatch = _rawBattleJs.match(/DAMAGE_FACTOR:\{([^}]+)\}/);
    if (dfMatch) {
      for (const m of dfMatch[1].matchAll(/([A-Z][A-Z0-9_]*):(\d+)/g)) {
        DB.damageFactor[m[1]] = parseInt(m[2]);
      }
    }

    const statCount = Object.keys(SAT).length;
    setLoadState('battlejs', 'ok', `${statCount} statuses, ${Object.keys(DB.abilityIdOf).length} abilities`);
    battleJsReady = true;
    loadGameData();
  } catch(e) {
    setLoadState('battlejs', 'err', e.message);
  }
  checkAllLoaded();
}

// ─── Game data: battle.js run in a Web Worker ──────────────────────────────────
// Gives every status's real config (effects, durations, values) as the game defines it.
async function loadGameData() {
  setLoadState('game', 'loading', 'running battle.js…');
  try {
    const t0 = performance.now();
    const { conf, statusParams, errors } = await startBattleRuntime(_rawBattleJs);
    DB.game = { conf, statusParams };
    const ms = Math.round(performance.now() - t0);
    const note = errors.length ? ` · ${errors.length} module errors` : '';
    setLoadState('game', errors.length ? 'err' : 'ok', `${Object.keys(statusParams).length} status configs in ${ms}ms${note}`);
  } catch (e) {
    setLoadState('game', 'err', e.message);
  }
}

// Game names for a status config's numeric enums, from battle.js's Conf tables.
const GAME_ENUMS = {
  effects:   'STATUS_AILMENTS_PARAM_EFFECT_TYPE',
  durations: 'STATUS_AILMENTS_PARAM_DURATION_TYPE',
};

// A status config as readable text: one line per effect and duration, with enum
// names (effect/duration types, elements, statuses) spelled out.
function formatGameParams(params) {
  const conf = DB.game.conf;
  const nameOf = (table, value) => Object.keys(conf[table] ?? {}).find(k => conf[table][k] === value);
  const show = (key, value) => {
    if (key === 'anyElementIds' || key === 'elementId') {
      return [].concat(value).map(v => nameOf('ELEMENT_TYPE', v) ?? v).join(', ');
    }
    if (key === 'saId' || key === 'saIds') return [].concat(value).map(v => DB.statusById[v] ?? v).join(', ');
    return typeof value === 'object' ? JSON.stringify(value, (k, v) => (k === 'anyElementIds' ? v.map(id => nameOf('ELEMENT_TYPE', id) ?? id) : v)) : String(value);
  };
  const lines = [];
  for (const [part, table] of Object.entries(GAME_ENUMS)) {
    for (const entry of params[part] ?? []) {
      const fields = Object.entries(entry).filter(([k]) => k !== 'key' && k !== 'type')
        .map(([k, v]) => `${k}: ${show(k, v)}`);
      lines.push(`${part === 'effects' ? 'Effect' : 'Duration'} ${entry.key}: ${nameOf(table, entry.type) ?? entry.type}${fields.length ? `\n    ${fields.join('\n    ')}` : ''}`);
    }
  }
  const flags = Object.entries(params).filter(([k]) => !(k in GAME_ENUMS)).map(([k, v]) => `${k}: ${show(k, v)}`);
  if (flags.length) lines.unshift(flags.join(', '));
  return lines.join('\n');
}

// ─── Sheet data (served from the server's cache; see Refresh data) ───────────
async function loadSheets() {
  setLoadState('sheets', 'loading', 'fetching…');
  try {
    const resp = await fetch('/data/sheets?names=status,other,extra,characters');
    const raw = await resp.json();
    if (raw.error) throw new Error(raw.error);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const { sheets: data, lastRefreshedAt } = splitSheetsResponse(raw);

    for (const r of (data.status || [])) {
      const id = parseInt(r['ID']);
      if (!isNaN(id)) DB.statusMap[id] = {
        commonName: r['Common Name'] || '',
        effects:    r['Effects']      || '',
        duration:   r['Default Duration'] || '',
        codedName:  r['Coded Name']   || '',
      };
    }

    DB.otherNamesBySource = {};
    DB.otherNamesByIdAndSource = {};
    DB.otherSourcesById = {};
    DB.otherEffectsBySource = {};
    for (const r of (data.other || [])) {
      const id = parseInt(r['ID']);
      if (!isNaN(id) && r['Name']) DB.otherNameMap[id] = r['Name'];
      if (r['Source'] && r['Name']) (DB.otherNamesBySource[r['Source']] ??= []).push(r['Name']);
      if (r['Source'] && r['Effects']) (DB.otherEffectsBySource[r['Source']] ??= []).push(r['Effects']);
      if (r['Source'] && r['Name'] && !isNaN(id)) DB.otherNamesByIdAndSource[`${id}|${r['Source']}`] = r['Name'];
      if (r['Source'] && !isNaN(id)) (DB.otherSourcesById[id] ??= []).push(r['Source']);
    }

    // Characters sheet: name → realm (e.g. 'VII'), for series qualifiers in names
    DB.charRealm = {};
    DB.characterNames = {};
    for (const r of (data.characters || [])) {
      const name = (r['Name'] || '').trim();
      if (!name) continue;
      DB.characterNames[name.toLowerCase()] = name;
      if (r['Realm']) DB.charRealm[name] = r['Realm'].trim();
    }

    // Extra sheet: build character → [ability names] lookup for extraRepeat descriptions
    DB.extraByCharacter = {};
    for (const r of (data.extra || [])) {
      const char = (r['Character'] || '').trim();
      const name = (r['Name'] || '').trim();
      if (char && name) {
        if (!DB.extraByCharacter[char]) DB.extraByCharacter[char] = [];
        if (!DB.extraByCharacter[char].includes(name)) DB.extraByCharacter[char].push(name);
      }
    }

    const refreshed = lastRefreshedAt ? ` · refreshed ${new Date(lastRefreshedAt).toLocaleString()}` : '';
    setLoadState('sheets', 'ok', `${Object.keys(DB.statusMap).length} status rows${refreshed}`);
    sheetsReady = true;
  } catch(e) {
    setLoadState('sheets', 'err', e.message);
  }
  checkAllLoaded();
}

// ─── Extract a single define() block's factory function body ──────────────────
// Returns { defineModule, block } or null.
// IMPORTANT: funcName values found in `block` are LOCAL to this namespace only.
function extractDefineBlock(moduleName) {
  const marker = `define("${moduleName}"`;
  const blockStart = _rawBattleJs.indexOf(marker);
  if (blockStart === -1) return null;

  // Walk forward to find the opening { of the factory function body
  let funcBodyStart = -1, parenDepth = 0;
  for (let i = blockStart; i < _rawBattleJs.length; i++) {
    const c = _rawBattleJs[i];
    if (c === '(') parenDepth++;
    else if (c === ')') parenDepth--;
    else if (c === '{' && parenDepth > 0) { funcBodyStart = i; break; }
  }
  if (funcBodyStart === -1) return null;

  // Bracket-count to find the matching }
  let depth = 0, blockEnd = funcBodyStart;
  for (let i = funcBodyStart; i < _rawBattleJs.length; i++) {
    if (_rawBattleJs[i] === '{') depth++;
    else if (_rawBattleJs[i] === '}') { depth--; if (depth === 0) { blockEnd = i; break; } }
  }

  return { defineModule: moduleName, block: _rawBattleJs.slice(funcBodyStart, blockEnd + 1) };
}

// ─── Parse status assignments — scoped to their define() block ────────────────
const MAIN_MODULE   = 'scenes/battle/StatusAilmentsConfig';
const CBM_MODULE    = 'scenes/battle/statusAilmentsConfig/CrystalBuddyMode';
const TAM_MODULE    = 'scenes/battle/statusAilmentsConfig/TacticalAwakeMode';
const BUSTER_MODULE = 'scenes/battle/statusAilmentsConfig/BusterAttack';
const EBM_MODULE    = 'scenes/battle/statusAilmentsConfig/ExtraBuddyMode';

// Status assignments look like  X[Y.STATUS_KEY]=helper(args).  X, Y and helper are
// minified names that change on every battle.js repack, so the X[Y. prefix is
// detected per block: the one used most often with known STATUS_AILMENTS_TYPE keys.
const ASSIGNMENT_RE = /([a-zA-Z$_][\w$]*)\[([a-zA-Z$_][\w$]*)\.([A-Z_0-9]+)\]=([a-zA-Z$_][\w$]*)\(/g;

function detectAssignmentPrefix(text, keyFilter = () => true) {
  const counts = new Map();
  for (const m of text.matchAll(ASSIGNMENT_RE)) {
    if (!(m[3] in DB.statusAilmentsForward) || !keyFilter(m[3])) continue;
    const prefix = `${m[1]}[${m[2]}.`;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  let best = null, bestCount = 0;
  for (const [prefix, count] of counts) if (count > bestCount) { best = prefix; bestCount = count; }
  return best;
}

// RegExp capturing [KEY, helperName] for assignments with the given X[Y. prefix,
// positioned just after the opening '(' of the args.
function assignmentRegex(prefix, keyPattern = '[A-Z_0-9]+') {
  const escaped = prefix.replace(/[[\].$]/g, '\\$&');
  return new RegExp(`${escaped}(${keyPattern})\\]=([a-zA-Z$_][a-zA-Z0-9$_]*)\\(`, 'g');
}

// Returns the argument text of a call whose '(' ends just before argsStart.
function callArgs(text, argsStart) {
  let pdepth = 1, i = argsStart;
  while (i < text.length && pdepth > 0) {
    const ch = text[i];
    if (ch === '(') pdepth++;
    else if (ch === ')') pdepth--;
    i++;
  }
  return text.slice(argsStart, i - 1);
}

function buildStatusAssignments() {
  DB.helperBodies = {};
  DB.learningModeCounts = null;

  // Scans one define() block for status assignments and adds them to DB.statusAssignments.
  function scanBlock(moduleName) {
    const src = extractDefineBlock(moduleName);
    if (!src) return 0;
    const { defineModule, block } = src;
    const prefix = detectAssignmentPrefix(block);
    if (!prefix) return 0;
    let count = 0;
    for (const m of block.matchAll(assignmentRegex(prefix))) {
      const argsText = callArgs(block, m.index + m[0].length);
      DB.statusAssignments[m[1]] = { funcName: m[2], argsText, defineModule, block };
      count++;
    }
    return count;
  }

  const mainCount = scanBlock(MAIN_MODULE);
  if (mainCount === 0) throw new Error('StatusAilmentsConfig block not found or empty');
  scanBlock(CBM_MODULE);
  scanBlock(TAM_MODULE);
  scanBlock(BUSTER_MODULE);

  // Extra Buddy Mode — scan raw JS directly for EXTRA_BUDDY_MODE_* assignments.
  // extractDefineBlock is unreliable for finding these assignments; the key prefix is
  // unique enough that a raw scan won't pick up false positives.
  const isEbmKey = key => key.startsWith('EXTRA_BUDDY_MODE_');
  const ebmPrefix = detectAssignmentPrefix(_rawBattleJs, isEbmKey);
  if (ebmPrefix) {
    for (const m of _rawBattleJs.matchAll(assignmentRegex(ebmPrefix, 'EXTRA_BUDDY_MODE_[A-Z_0-9]+'))) {
      const argsText = callArgs(_rawBattleJs, m.index + m[0].length);
      DB.statusAssignments[m[1]] = { funcName: m[2], argsText, defineModule: EBM_MODULE, block: '' };
    }
  }
}

// ─── Character names ─────────────────────────────────────────────────────────
// Turns a name derived from a coded status key into the Characters sheet's name
// (docs/decisions.md "Naming"): known JP-romanisation corrections first, then a
// case-insensitive match against the sheet (e.g. FuSoYa → Fusoya).
function canonicalCharacterName(name) {
  const corrected = window.FFRK?.CHAR_CORRECTIONS?.[name] ?? name;
  return DB.characterNames[corrected.toLowerCase()] ?? corrected;
}

// ─── Argument splitting ───────────────────────────────────────────────────────
function splitTopLevelArgs(argsText) {
  const args = [];
  let depth = 0, current = '';
  for (let i = 0; i < argsText.length; i++) {
    const c = argsText[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

// ─── Display name helpers ─────────────────────────────────────────────────────
const ELEM_DISPLAY = {
  FIRE: 'Fire', ICE: 'Ice', LIGHTNING: 'Lightning', EARTH: 'Earth',
  WIND: 'Wind', WATER: 'Water', HOLY: 'Holy', DARK: 'Dark', POISON: 'Poison',
  NON_ELEMENTAL: 'NE', NOTHING: 'NE', NON: 'NE',
};

function elementDisplayName(key) {
  return ELEM_DISPLAY[key] ?? titleCase(key);
}

// Ability category as the sheet names it (SHOOTER is "Sharpshooter").
function categoryDisplayName(key) {
  return schoolName(key);
}

function titleCase(key) {
  return key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// Look up a status ID and return its [Common Name] tag
function statusTag(id) {
  const sheet = DB.statusMap[id];
  if (sheet?.commonName) return `<span class="status-tag">[${sheet.commonName}]</span>`;
  const key = DB.statusById[id];
  if (key) return `<span class="status-tag">[${titleCase(key)}]</span>`;
  return `<span class="status-tag">[Status #${id}]</span>`;
}

// ─── Hardcoded ability names ──────────────────────────────────────────────────
// Special-case abilities that won't appear in the Other sheet tab.
const HARDCODED_ABILITY_NAMES = {
  31545795: '111% ATB 1',
  31547024: '200% ATB 1',
};

// Look up a display name for any ability ID: Other sheet first, then hardcoded map.
function abilityDisplayName(id) {
  if (id == null) return null;
  return DB.otherNameMap[id] ?? HARDCODED_ABILITY_NAMES[id] ?? null;
}

// ─── Chase ability name lookup ────────────────────────────────────────────────
function chaseAbilityName(statusKey) {
  const id = DB.abilityIdOf['CHASE_ABILITY_FOR_' + statusKey];
  if (id == null) return null;
  return abilityDisplayName(id) ?? '<ability missing from Other Tab>';
}

// ─── nt decoder ──────────────────────────────────────────────────────────────
// nt(damageFactor, turns, condition?)
// → turn-based damage increase
function decodeNt(statusKey, statusId, argsText, block) {
  // `block` is the StatusAilmentsConfig factory body — available for future
  // use if we need to resolve helper functions called from within nt().
  const args = splitTopLevelArgs(argsText);
  if (args.length < 2) return null;

  // Arg 1: damage factor — e.g. S[w.INCREASE_EXECUTED_DAMAGE].DAMAGE_FACTOR.EXTRA_SMALL
  const factorMatch = args[0].match(/DAMAGE_FACTOR\.([A-Z_0-9]+)/);
  const sizeName    = factorMatch?.[1] ?? null;
  const factorValue = sizeName != null ? DB.damageFactor[sizeName] : null;
  const pct         = factorValue != null ? factorValue - 100 : null;
  const pctStr      = pct != null ? `${pct}%` : '?%';

  // Arg 2: turns
  const turns   = parseInt(args[1]);
  const turnStr = `${turns} turn${turns !== 1 ? 's' : ''}`;

  // Arg 3: condition object
  const condText = args[2] ?? '';

  // condPartsBase: weakness / elements / category — NOT abilityType (kept separate)
  const condPartsBase = [];
  let abilityType = '';
  let abilityTypeExplicit = false;
  if (/isWeaponSkill\s*:\s*!0/.test(condText))  { abilityType = 'Weapon Skill'; abilityTypeExplicit = true; }
  else if (/isAbility\s*:\s*!0/.test(condText)) { abilityType = 'Ability';      abilityTypeExplicit = true; }

  if (/hasWeakness\s*:\s*!0/.test(condText)) condPartsBase.push('vs Weakness');
  if (/isPhysicalAttack\s*:\s*!0/.test(condText)) condPartsBase.push('Physical');
  if (/isMagicalAttack\s*:\s*!0/.test(condText))  condPartsBase.push('Magical');
  if (/isSoulStrike\s*:\s*!0/.test(condText))     condPartsBase.push('Soul Break');
  if (/isIndirectAttack\s*:\s*!0/.test(condText)) condPartsBase.push('Ranged');

  const elemMatch = condText.match(/\belementId\b[^,}]*?ELEMENT_TYPE\.([A-Z_]+)/);
  if (elemMatch) condPartsBase.push(elementDisplayName(elemMatch[1]));

  const anyElemMatch = condText.match(/anyElementIds\s*:\s*\[([^\]]+)\]/);
  if (anyElemMatch) {
    const names = [...anyElemMatch[1].matchAll(/ELEMENT_TYPE\.([A-Z_]+)/g)].map(m => elementDisplayName(m[1]));
    condPartsBase.push(names.join(', '));
  }

  let hasCategory = false;

  const catMatch = condText.match(/categoryId\s*:[^,}]*?ABILITY_CATEGORY_ID\.([A-Z_]+)/);
  if (catMatch) {
    condPartsBase.push(categoryDisplayName(catMatch[1]));
    if (!abilityType) abilityType = 'Ability';
    hasCategory = true;
  }

  const anyCatMatch = condText.match(/anyCategoryIds\s*:\s*\[([^\]]+)\]/);
  if (anyCatMatch) {
    const names = [...anyCatMatch[1].matchAll(/ABILITY_CATEGORY_ID\.([A-Z_]+)/g)].map(m => categoryDisplayName(m[1]));
    condPartsBase.push(names.join(', '));
    if (!abilityType) abilityType = 'Ability';
    hasCategory = true;
  }

  // Realm (executerCondition.buddySeriesId)
  let realmName = null;
  const realmMatch = condText.match(/buddySeriesId\s*:\s*[a-zA-Z$_][a-zA-Z0-9$_.]*\.SERIES_ID\.([A-Z0-9_]+)/);
  if (realmMatch) {
    realmName = realmName(realmMatch[1]);
    condPartsBase.push(realmName);
  }

  const condBase       = condPartsBase.join(' ');
  const condBasePrefix = condBase ? `${condBase} ` : '';

  // Common Name: [condition incl. abilityType] +[pct]% Boost [N]
  // abilityType appended only when explicit (isAbility/isWeaponSkill) AND no school is present —
  // a school already implies Ability, so "Thief Ability" → just "Thief"
  const allCondParts = (abilityType && abilityTypeExplicit && !hasCategory) ? [...condPartsBase, abilityType] : [...condPartsBase];
  const condDesc   = allCondParts.join(' ');
  const condPrefix = condDesc ? `${condDesc} ` : '';
  const commonName = `${condPrefix}+${pctStr} Boost ${turns}`.replace(/\s+/g, ' ').trim();

  // Effects — realm condition uses a different sentence structure
  const pctNum = pct != null ? pct : '?';
  let effects;
  if (realmName) {
    effects = `Increases damage dealt by ${pctNum}% if the character's Realm is ${realmName}`;
  } else {
    let effectsSubject;
    if (abilityType === 'Ability')           effectsSubject = `${condBasePrefix}Abilities`;
    else if (abilityType === 'Weapon Skill') effectsSubject = `${condBasePrefix}Weapon Skills`;
    else                                     effectsSubject = condBase ? `${condBasePrefix}attacks` : 'Attacks';
    effects = `${effectsSubject} deal ${pctNum}% more damage`.replace(/\s+/g, ' ').trim();
  }

  return {
    id: statusId,
    codedName:       statusKey,
    commonName,
    effects,
    defaultDuration: turnStr,
    mndModifier:     '-',
    exclusiveStatus: '-',
    notes:           '',
    funcName:        'nt',
    decoded:         true,
  };
}

// ─── Crystal Buddy Mode p() decoder ──────────────────────────────────────────
// p(abilityCondition, options?) → Crystal Force Mode status
//   Standard 4 effects: ABILITY_BOOST (rank 1-5: 5/10/15/20/30%), REGISTER_SEQ_ABILITY (follow-up),
//   NO_CONSUMPTION_ABILITY_NUM (no use consumption), DEF_AND_MDEF_PENETRATION (25% pierce).
//   options.repeatNum defaults to 1 (number of follow-up triggers).
//   options.effects may add a chase ability on top of the standard set.
const CBM_ELEMENT_KEYS = new Set(['FIRE','ICE','LIGHTNING','EARTH','WIND','WATER','HOLY','DARK','POISON']);
const CBM_ALL_ELEMENTS = ['FIRE','ICE','LIGHTNING','EARTH','WIND','WATER','HOLY','DARK','POISON'];

function decodeCbmP(statusKey, statusId, argsText) {
  // ── 1. Character name and key-level element qualifier from the status key ──
  const suffix = statusKey.replace(/^CRYSTAL_BUDDY_MODE_/, '');
  const parts = suffix.split('_');
  // A character's second Crystal Force mode ends in II: "Nabaat (Dark) II", as in the sheet.
  const numeral = parts.length > 1 && /^(II|III)$/.test(parts[parts.length - 1]) ? ` ${parts.pop()}` : '';
  const keyElemKeys = [];
  // Strip trailing element tokens (always leave at least one part for the char name)
  while (parts.length > 1 && CBM_ELEMENT_KEYS.has(parts[parts.length - 1])) {
    keyElemKeys.unshift(parts.pop());
  }
  const MINOR_WORDS = new Set(['of', 'the', 'a', 'an']);
  const charRaw = parts.map((p, i) => {
    const w = p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    return (i > 0 && MINOR_WORDS.has(w.toLowerCase())) ? w.toLowerCase() : w;
  }).join(' ');
  const charName = canonicalCharacterName(charRaw);

  const elemQualifier = keyElemKeys.length > 0
    ? ` (${keyElemKeys.map(e => elementDisplayName(e)).join('/')})`
    : '';
  const commonName = `Crystal Force Mode: ${charName}${elemQualifier}${numeral}`;

  // ── 2. Ability condition descriptor (for effects text) from p() first arg ──
  const args = splitTopLevelArgs(argsText);
  if (args.length < 1) return null;
  const condText = args[0];

  let condDesc = '';
  const anyElemM = condText.match(/anyElementIds\s*:\s*\[([^\]]+)\]/);
  if (anyElemM) {
    const keys = [...anyElemM[1].matchAll(/ELEMENT_TYPE\.([A-Z_]+)/g)].map(m => m[1]);
    condDesc = keys.length >= CBM_ALL_ELEMENTS.length
      ? 'Elemental'
      : keys.map(k => elementDisplayName(k)).join('/');
  }
  const anyCatM = condText.match(/anyCategoryIds\s*:\s*\[([^\]]+)\]/);
  if (anyCatM) {
    const names = [...anyCatM[1].matchAll(/ABILITY_CATEGORY_ID\.([A-Z_]+)/g)].map(m => categoryDisplayName(m[1]));
    condDesc = names.join('/');
  }
  const catM = condText.match(/\bcategoryId\b[^,}]*?ABILITY_CATEGORY_ID\.([A-Z_]+)/);
  if (catM) condDesc = categoryDisplayName(catM[1]);

  // ── 3. Effects ──
  const hasChase = args.length > 1 && args[1].includes('REGISTER_CHASE_ABILITY');
  const baseEffects = `${condDesc} abilities don't consume uses and deal 5/10/15/20/30% more damage at ability rank 1/2/3/4/5, ${condDesc} abilities trigger 1 additional time, [DEF and RES 25% Piercing (15s)], removed if user hasn't Crystal Force Mode`;
  let effects = baseEffects;
  if (hasChase) {
    const chaseName = chaseAbilityName(statusKey);
    const chaseText  = args[1];
    const multipleM  = chaseText.match(/abilityUseCountCondition\s*:\s*\{[^}]*multiple\s*:\s*(\d+)/);
    const doneCountM = chaseText.match(/chaseAbilityDoneCountForIsDone\s*:\s*(\d+)/);
    const every  = multipleM  ? Number(multipleM[1])  : 1;
    const maxUse = doneCountM ? Number(doneCountM[1]) : null;
    const everyStr = every > 1 ? ` every ${every} Crystal Force abilities` : ' after using Crystal Force abilities';
    const maxStr   = maxUse != null ? ` (max ${maxUse})` : '';
    const chaseStr = chaseName
      ? `, triggers [${chaseName}]${everyStr}${maxStr}`
      : `, triggers a Crystal Force chase ability${everyStr}${maxStr}`;
    effects = baseEffects + chaseStr;
  }

  return {
    id:              statusId,
    codedName:       statusKey,
    commonName,
    effects,
    defaultDuration: '-',
    mndModifier:     '-',
    exclusiveStatus: '-',
    notes:           '',
    funcName:        'p (CBM)',
    decoded:         true,
  };
}

// ─── Crystal Buddy Mode d() decoder ──────────────────────────────────────────
// d(abilityCondition, options?) → Crystal Force Mode status (support / cast speed)
//   2 base effects:
//     INCREASE_CAST_TIME_FACTOR  — Quick Cast N for matching abilities
//     NO_CONSUMPTION_ABILITY_NUM — matching abilities don't consume uses
//   options.castTimeFactor overrides the default (CAST_TIME_FACTOR.MEDIUM = 200 → Quick Cast 2)
//   options.effects may append additional effects (e.g. chase ability)
//
//   CAST_TIME_FACTOR values from battle.js:
//   EXTEND_SMALL:70, SMALL_110:110, SMALL_125:125, SMALL:150, MEDIUM:200, MEDIUM_250:250, LARGE:300, MAX:1e7
function decodeCbmD(statusKey, statusId, argsText) {
  // ── 1. Character name (same logic as decodeCbmP) ──
  const suffix = statusKey.replace(/^CRYSTAL_BUDDY_MODE_/, '');
  const parts = suffix.split('_');
  // A character's second Crystal Force mode ends in II: "Nabaat (Dark) II", as in the sheet.
  const numeral = parts.length > 1 && /^(II|III)$/.test(parts[parts.length - 1]) ? ` ${parts.pop()}` : '';
  const keyElemKeys = [];
  while (parts.length > 1 && CBM_ELEMENT_KEYS.has(parts[parts.length - 1])) {
    keyElemKeys.unshift(parts.pop());
  }
  const MINOR_WORDS = new Set(['of', 'the', 'a', 'an']);
  const charRaw = parts.map((p, i) => {
    const w = p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    return (i > 0 && MINOR_WORDS.has(w.toLowerCase())) ? w.toLowerCase() : w;
  }).join(' ');
  const charName = canonicalCharacterName(charRaw);
  const elemQualifier = keyElemKeys.length > 0
    ? ` (${keyElemKeys.map(e => elementDisplayName(e)).join('/')})`
    : '';
  const commonName = `Crystal Force Mode: ${charName}${elemQualifier}${numeral}`;

  // ── 2. Ability condition descriptor ──
  const args = splitTopLevelArgs(argsText);
  if (args.length < 1) return null;
  const condText = args[0];

  let condDesc = '';
  const anyElemM = condText.match(/anyElementIds\s*:\s*\[([^\]]+)\]/);
  if (anyElemM) {
    const keys = [...anyElemM[1].matchAll(/ELEMENT_TYPE\.([A-Z_]+)/g)].map(m => m[1]);
    condDesc = keys.length >= CBM_ALL_ELEMENTS.length
      ? 'Elemental'
      : keys.map(k => elementDisplayName(k)).join('/');
  }
  const anyCatM = condText.match(/anyCategoryIds\s*:\s*\[([^\]]+)\]/);
  if (anyCatM) {
    const names = [...anyCatM[1].matchAll(/ABILITY_CATEGORY_ID\.([A-Z_]+)/g)].map(m => categoryDisplayName(m[1]));
    condDesc = names.join('/');
  }
  const catM = condText.match(/\bcategoryId\b[^,}]*?ABILITY_CATEGORY_ID\.([A-Z_]+)/);
  if (catM) condDesc = categoryDisplayName(catM[1]);

  // ── 3. Cast time factor → Cast Speed label ──
  const CTF_VALUES = { EXTEND_SMALL:70, SMALL_110:110, SMALL_125:125, SMALL:150, MEDIUM:200, MEDIUM_250:250, LARGE:300, MAX:10000000 };
  let castTimeFactor = 200; // default MEDIUM
  if (args.length > 1) {
    const ctfM = args[1].match(/CAST_TIME_FACTOR\.([A-Z_0-9]+)/);
    if (ctfM) castTimeFactor = CTF_VALUES[ctfM[1]] ?? 200;
  }
  const castSpeedRaw = castTimeFactor / 100;
  const castSpeedLabel = `Cast Speed x${castSpeedRaw >= 100 ? castSpeedRaw : castSpeedRaw.toFixed(2)}`;

  // ── 4. Chase ability (from options.effects if present) ──
  const hasChase = args.length > 1 && args[1].includes('REGISTER_CHASE_ABILITY');
  const condPrefix = condDesc ? `${condDesc} ` : '';
  let effects = `${condPrefix}abilities don't consume uses and have ${castSpeedLabel}, removed if user hasn't Crystal Force Mode`;
  if (hasChase) {
    const chaseName  = chaseAbilityName(statusKey);
    const chaseText  = args[1];
    const multipleM  = chaseText.match(/abilityUseCountCondition\s*:\s*\{[^}]*multiple\s*:\s*(\d+)/);
    const doneCountM = chaseText.match(/chaseAbilityDoneCountForIsDone\s*:\s*(\d+)/);
    const every  = multipleM  ? Number(multipleM[1])  : 1;
    const maxUse = doneCountM ? Number(doneCountM[1]) : null;
    const everyStr = every > 1 ? ` every ${every} Crystal Force abilities` : ' after using Crystal Force abilities';
    const maxStr   = maxUse != null ? ` (max ${maxUse})` : '';
    const chaseStr = chaseName
      ? `, triggers [${chaseName}]${everyStr}${maxStr}`
      : `, triggers a Crystal Force chase ability${everyStr}${maxStr}`;
    effects += chaseStr;
  }

  return {
    id:              statusId,
    codedName:       statusKey,
    commonName,
    effects,
    defaultDuration: '-',
    mndModifier:     '-',
    exclusiveStatus: '-',
    notes:           '',
    funcName:        'd (CBM)',
    decoded:         true,
  };
}

// ─── Tactical Awoken Mode shared helpers ──────────────────────────────────────
// Extract char name and key-level element qualifier from a TAM status key.
function tamCharInfo(statusKey) {
  const suffix = statusKey.replace(/^TACTICAL_AWAKE_MODE_/, '');
  const parts = suffix.split('_');
  const keyElemKeys = [];
  while (parts.length > 1 && CBM_ELEMENT_KEYS.has(parts[parts.length - 1])) {
    keyElemKeys.unshift(parts.pop());
  }
  const MINOR_WORDS = new Set(['of', 'the', 'a', 'an']);
  const charRaw = parts.map((p, i) => {
    const w = p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    return (i > 0 && MINOR_WORDS.has(w.toLowerCase())) ? w.toLowerCase() : w;
  }).join(' ');
  const charName = canonicalCharacterName(charRaw);
  return { charName, keyElemKeys };
}

// Parse element condition desc from a TAM abilityCondition arg string.
function tamCondDesc(condText) {
  const anyElemM = condText.match(/anyElementIds\s*:\s*\[([^\]]+)\]/);
  if (anyElemM) {
    const keys = [...anyElemM[1].matchAll(/ELEMENT_TYPE\.([A-Z_]+)/g)].map(m => m[1]);
    if (keys.length >= CBM_ALL_ELEMENTS.length) return 'All elemental';
    return keys.map(k => elementDisplayName(k)).join('/');
  }
  const elemM = condText.match(/\belementId\b[^,}]*?ELEMENT_TYPE\.([A-Z_]+)/);
  if (elemM) return elementDisplayName(elemM[1]);
  return 'All';
}

// Standard effects from p() — shared by both v and d.
// ABILITY_BOOST MEDIUM (5/10/15/20/30%), REGISTER_SEQ (repeatNum additional triggers),
// INFINITY_ABILITY_NUM, INCREASE_DAMAGE_THRESHOLD_LV:1 (+10k cap),
// INCREASE_EXECUTED_DAMAGE MEDIUM (30%).
// repeatNum defaults to 2 (p()'s default s.repeatNum).
function tamBaseEffects(condDesc, repeatNum = 2) {
  const times = repeatNum === 1 ? '1 additional time' : `${repeatNum} additional times`;
  return `${condDesc} abilities deal 30% more damage, have +10,000 damage cap, deal 5/10/15/20/30% more damage at ability rank 1/2/3/4/5, trigger ${times}, have zero hone cost`;
}

// ─── decodeTamV: v() — ATB chase variant ──────────────────────────────────────
// v(abilityCondition, options?)
//   Adds REGISTER_CHASE_ABILITY_WHEN_ABILITY_DONE (default: EXTRA_SMALL 111% ATB 1)
//   after using matching abilities while the character has TACTICAL_AWAKE_MODE.
//   Then calls p() for the standard TAM effects.
function decodeTamV(statusKey, statusId, argsText) {
  const { charName, keyElemKeys } = tamCharInfo(statusKey);
  const args     = splitTopLevelArgs(argsText);
  const condText = args[0] ?? '';
  const optsText = args[1] ?? '';

  const condDesc      = tamCondDesc(condText);
  const elemQualifier = keyElemKeys.length > 0
    ? ` (${keyElemKeys.map(e => elementDisplayName(e)).join('/')})`
    : '';
  const commonName = `Tactical Awoken Mode: ${charName}${elemQualifier}`;

  // Chase ability — options may override the default (EXTRA_SMALL = 111% ATB 1).
  let chaseId = DB.abilityIdOf['CHASE_ABILITY_FOR_INCREASE_ATB_TIME_EXTRA_SMALL_WHILE_TACTICAL_AWAKE_MODE'];
  const chaseKeyM = optsText.match(/chaseAbilityId\s*:\s*[a-zA-Z$_]\w*\.([A-Z_0-9]+)/);
  if (chaseKeyM) chaseId = DB.abilityIdOf[chaseKeyM[1]];
  const chaseName = abilityDisplayName(chaseId);
  const chaseStr = chaseName
    ? `, triggers [${chaseName}] after using ${condDesc} abilities while in Tactical Awoken Mode`
    : '';

  // repeatNum — p() defaults to 2; parse override from options if present
  const repeatM  = optsText.match(/repeatNum\s*:\s*(\d+)/);
  const repeatNum = repeatM ? parseInt(repeatM[1]) : 2;

  // Flight (e.g. Kain): flightDuration:N means character can take flight for N turns
  const flightM   = optsText.match(/flightDuration\s*:\s*(\d+)/);
  const flightStr = flightM ? ', No air time for jump abilities' : '';

  const effects = `${tamBaseEffects(condDesc, repeatNum)}${chaseStr}${flightStr}; removed if the character hasn't [Tactical Awoken Mode]`;

  return {
    id:              statusId,
    codedName:       statusKey,
    commonName,
    effects,
    defaultDuration: '-',
    mndModifier:     '-',
    exclusiveStatus: '-',
    notes:           '',
    funcName:        'v (TAM)',
    decoded:         true,
  };
}

// ─── decodeTamD: d() — DEF/MDEF penetration variant ──────────────────────────
// d(abilityCondition, options?)
//   Adds DEF_AND_MDEF_PENETRATION (default SMALL = 20%) for matching abilities.
//   Then calls p() for the standard TAM effects.
function decodeTamD(statusKey, statusId, argsText) {
  const { charName, keyElemKeys } = tamCharInfo(statusKey);
  const args     = splitTopLevelArgs(argsText);
  const condText = args[0] ?? '';
  const optsText = args[1] ?? '';

  const condDesc      = tamCondDesc(condText);
  const elemQualifier = keyElemKeys.length > 0
    ? ` (${keyElemKeys.map(e => elementDisplayName(e)).join('/')})`
    : '';
  const commonName = `Tactical Awoken Mode: ${charName}${elemQualifier}`;

  // Penetration % — default SMALL=20; parse override if present
  const PEN_FACTOR = { SMALL: 20, MEDIUM: 25, EXTRA_MEDIUM: 30, LARGE: 50, EXTRA_LARGE: 75 };
  let penPct = 20;
  const penM = optsText.match(/PENETRATION_FACTOR\.([A-Z_]+)/);
  if (penM) penPct = PEN_FACTOR[penM[1]] ?? 20;

  // repeatNum — p() defaults to 2; parse override from options if present
  const repeatM  = optsText.match(/repeatNum\s*:\s*(\d+)/);
  const repeatNum = repeatM ? parseInt(repeatM[1]) : 2;

  // Flight (same as v-type)
  const flightM   = optsText.match(/flightDuration\s*:\s*(\d+)/);
  const flightStr = flightM ? ', No air time for jump abilities' : '';

  const effects = `${tamBaseEffects(condDesc, repeatNum)}, penetrate ${penPct}% DEF and RES${flightStr}; removed if the character hasn't [Tactical Awoken Mode]`;

  return {
    id:              statusId,
    codedName:       statusKey,
    commonName,
    effects,
    defaultDuration: '-',
    mndModifier:     '-',
    exclusiveStatus: '-',
    notes:           '',
    funcName:        'd (TAM)',
    decoded:         true,
  };
}

// ─── Or decoder ───────────────────────────────────────────────────────────────
// Or("learningModeXxx", condition?) → character-specific Learning Mode status
// Number of Learning Mode statuses for one character, keyed by the camelCase name
// part of their "learningMode…" argument with the variant suffix removed.
function learningModeCount(namePart) {
  if (!DB.learningModeCounts) {
    DB.learningModeCounts = {};
    for (const a of Object.values(DB.statusAssignments)) {
      const m = a.argsText.match(/^"learningMode([A-Za-z]+?)(Bansho|Bansyo|Koki|Tenmei)?"/);
      if (m) DB.learningModeCounts[m[1]] = (DB.learningModeCounts[m[1]] ?? 0) + 1;
    }
  }
  return DB.learningModeCounts[namePart] ?? 0;
}

function decodeOr(statusKey, statusId, argsText, _block, helperBody = '') {
  const args = splitTopLevelArgs(argsText);
  if (args.length < 1) return null;

  // Arg 1: internal camelCase name, e.g. "learningModeRozaBansho"
  const nameMatch = args[0].match(/^"learningMode(.+)"$/);
  if (!nameMatch) return null;
  let namePart = nameMatch[1]; // e.g. "RozaBansho"

  // Strip known camelCase suffixes — order matters (longest first for safety).
  // Only strip if something remains (e.g. "Lightning" alone = Lightning the character, not an element suffix).
  for (const suffix of ['Bansho', 'Bansyo', 'Koki', 'Tenmei', 'Water', 'Ice', 'Fire', 'Lightning', 'Wind', 'Earth', 'Dark', 'Holy', 'Poison']) {
    if (namePart.endsWith(suffix) && namePart.length > suffix.length) { namePart = namePart.slice(0, -suffix.length); break; }
  }

  // Split CamelCase to words, lowercase minor words (not first word)
  const words = namePart.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ');
  const MINOR = new Set(['of', 'the', 'a', 'an']);
  let charName = words.map((w, i) => (i > 0 && MINOR.has(w.toLowerCase())) ? w.toLowerCase() : w).join(' ');

  // Apply corrections from shared constant (see shared/_ffrk_constants.html.erb)
  charName = canonicalCharacterName(charName);

  // Qualifier from abilityCondition (element or category) — KOKI statuses have no condition arg
  // so qualifier will be null and they are treated as blanket (all-damage) buffs
  const condText = args[1] ?? '';
  let qualifier = null;
  const anyElemM = condText.match(/anyElementIds\s*:\s*\[([^\]]+)\]/);
  if (anyElemM) {
    const names = [...anyElemM[1].matchAll(/ELEMENT_TYPE\.([A-Z_]+)/g)].map(m => elementDisplayName(m[1]));
    qualifier = names.join(', ');
  }
  const elemM = condText.match(/\belementId\b[^,}]*?ELEMENT_TYPE\.([A-Z_]+)/);
  if (elemM) qualifier = elementDisplayName(elemM[1]);
  const catM = condText.match(/categoryId\s*:[^,}]*?ABILITY_CATEGORY_ID\.([A-Z_]+)/);
  if (catM) qualifier = categoryDisplayName(catM[1]);
  const anyCatM = condText.match(/anyCategoryIds\s*:\s*\[([^\]]+)\]/);
  if (anyCatM) {
    const names = [...anyCatM[1].matchAll(/ABILITY_CATEGORY_ID\.([A-Z_]+)/g)].map(m => categoryDisplayName(m[1]));
    qualifier = names.join(', ');
  }

  // Name, as in the Status sheet: the conditional variant gets its qualifier ("(Wind)")
  // when the character has more than one Learning Mode; otherwise the plain name
  // (docs/decisions.md "Decoder wording follows the sheet").
  const baseName = `Learning Mode: ${charName}`;
  const hasVariants = learningModeCount(nameMatch[1].replace(/(Bansho|Bansyo|Koki|Tenmei)$/, '')) > 1;
  const commonName = qualifier && hasVariants ? `${baseName} (${qualifier})` : baseName;

  // Damage map — try to parse a custom one from the condition arg, else use Or() defaults.
  // Default: level 0→+5%, 1→+10%, 2→+15%, 3→+20%, 4→+25%, 5→+30%
  const OR_DEFAULT_MAP = [
    { level: 0, sizeName: 'EXTRA_SMALL_105' },
    { level: 1, sizeName: 'EXTRA_SMALL_110' },
    { level: 2, sizeName: 'SMALL' },
    { level: 3, sizeName: 'SMALL_120' },
    { level: 4, sizeName: 'SMALL_125' },
    { level: 5, sizeName: 'MEDIUM' },
  ];
  // {numberCondition:{greaterEqual:N},damageFactor:…DAMAGE_FACTOR.SIZE} entries, from the
  // args if they pass a table, else from the helper's own default, else OR_DEFAULT_MAP.
  const tableOf = text => [...text.matchAll(/greaterEqual\s*:\s*(\d+)\s*\}\s*,\s*damageFactor\s*:[^,}\]]*?DAMAGE_FACTOR\.([A-Z_0-9]+)/g)]
    .map(m => ({ level: parseInt(m[1]), sizeName: m[2] })).sort((a, b) => a.level - b.level);
  const argsTable = tableOf(argsText);
  const helperTable = tableOf(helperBody);
  const damageMap = argsTable.length ? argsTable : helperTable.length ? helperTable : OR_DEFAULT_MAP;
  const pcts   = damageMap.map(e => { const v = DB.damageFactor[e.sizeName]; return v != null ? (v - 100) : '?'; });
  const levels = damageMap.map(e => e.level);

  const damageClause = qualifier
    ? `${qualifier} attacks deal ${pcts.join('/')}% more damage`
    : `increases damage dealt by ${pcts.join('/')}%`;
  const levelRange = `(${Math.min(...levels)}~${Math.max(...levels)})`;
  const effects = `Keeps track of ${baseName} level ${levelRange}, ${damageClause} at ${baseName} level ${levels.join('/')}`;

  return {
    id: statusId,
    codedName:       statusKey,
    commonName,
    effects,
    defaultDuration: '-',
    mndModifier:     '-',
    exclusiveStatus: '-',
    notes:           '',
    funcName:        'Or',
    decoded:         true,
  };
}

// ─── decodeXr: Xr() — SS gauge cost reduction for a specific Soul Strike ──────
// Xr(gauges, parentSaKey, soulStrikeIdKey)
//   gauges:        number of SS gauges to reduce cost by (e.g. 1)
//   parentSaKey:   v.ENHANCE_* key this status is tied to (duration condition)
//   soulStrikeIdKey: p.Conf.SOUL_STRIKE_ID_OF.KEY — the Soul Strike whose cost is reduced
function decodeXr(statusKey, statusId, argsText) {
  const args      = splitTopLevelArgs(argsText);
  const gauges    = parseInt(args[0] ?? '1') || 1;
  const ssKeyM    = (args[2] ?? '').match(/SOUL_STRIKE_ID_OF\.([A-Z_0-9]+)/);
  const ssKeyName = ssKeyM ? ssKeyM[1] : null;
  const ssId      = ssKeyName ? DB.abilityIdOf[ssKeyName] : null;
  const ssName    = abilityDisplayName(ssId) ?? ssKeyName ?? '?';

  // Derive a human-readable name from the status key
  // e.g. REDUCE_CONSUME_POINT_SHIN_OUGI_FOR_GORDON → "Gordon"
  const MINOR_WORDS = new Set(['of', 'the', 'a', 'an', 'for']);
  const suffix    = statusKey.replace(/^REDUCE_CONSUME_POINT_/, '');
  const charParts = suffix.split('_');
  const commonName = 'Reduced SS Cost: ' + charParts.map((p, i) => {
    const w = p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    return (i > 0 && MINOR_WORDS.has(w.toLowerCase())) ? w.toLowerCase() : w;
  }).join(' ');

  const gaugeStr = gauges === 1 ? '1 gauge' : `${gauges} gauges`;
  const effects  = `Reduces SS gauge cost by ${gaugeStr} for [${ssName}]`;

  return {
    id:              statusId,
    codedName:       statusKey,
    commonName,
    effects,
    defaultDuration: '-',
    mndModifier:     '-',
    exclusiveStatus: '-',
    notes:           '',
    funcName:        'Xr',
    decoded:         true,
  };
}

// ─── decodeBusterP: p() — BusterAttack chase mode ────────────────────────────
// p(abilityCondition, options?)
//   abilityCondition: { anyElementIds: [ELEMENT_TYPE.X, ...] }
//   options:          { chaseAbilityId: ABILITY_ID_OF.CHASE_ABILITY_FOR_BUSTER_ATTACK_* }
//   chaseAbilityDoneCountForIsDone always defaults to 5 (never overridden).
//   Duration wraps via h() → STATUS_AILMENTS_PARAM_DURATION_TYPE.TIME → TIME.MEDIUM = 15s.
function decodeBusterP(statusKey, statusId, argsText) {
  // ── Character name from key ──
  const suffix = statusKey.replace(/^CHASE_MODE_FOR_BUSTER_ATTACK_/, '');
  const parts  = suffix.split('_');
  const keyElemKeys = [];
  while (parts.length > 1 && CBM_ELEMENT_KEYS.has(parts[parts.length - 1])) {
    keyElemKeys.unshift(parts.pop());
  }
  const MINOR_WORDS = new Set(['of', 'the', 'a', 'an']);
  const charRaw = parts.map((p, i) => {
    const w = p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    return (i > 0 && MINOR_WORDS.has(w.toLowerCase())) ? w.toLowerCase() : w;
  }).join(' ');
  const charName = canonicalCharacterName(charRaw);
  const elemQualifier = keyElemKeys.length > 0
    ? ` (${keyElemKeys.map(k => elementDisplayName(k)).join('/')})`
    : '';
  const commonName = `Buster Chase Mode: ${charName}${elemQualifier}`;

  // ── Ability condition — anyElementIds ──
  const args     = splitTopLevelArgs(argsText);
  const condText = args[0] ?? '';
  const optsText = args[1] ?? '';
  const anyElemM = condText.match(/anyElementIds\s*:\s*\[([^\]]+)\]/);
  const elemKeys = anyElemM
    ? [...anyElemM[1].matchAll(/ELEMENT_TYPE\.([A-Z_]+)/g)].map(m => m[1])
    : [];
  const condDesc = elemKeys.length >= CBM_ALL_ELEMENTS.length
    ? 'all elemental'
    : elemKeys.map(k => elementDisplayName(k)).join('/');

  // ── Chase ability ──
  const chaseKeyM = optsText.match(/chaseAbilityId\s*:\s*[a-zA-Z$_]\w*\.([A-Z_0-9]+)/);
  const chaseId   = chaseKeyM ? DB.abilityIdOf[chaseKeyM[1]] : null;
  const chaseName = abilityDisplayName(chaseId) ?? chaseKeyM?.[1] ?? '?';

  // ── Max count (always 5, but check for explicit override) ──
  const maxM     = optsText.match(/chaseAbilityDoneCountForIsDone\s*:\s*(\d+)/);
  const maxCount = maxM ? parseInt(maxM[1]) : 5;

  const effects = `Triggers [${chaseName}] when using ${condDesc} abilities (max ${maxCount})`;

  return {
    id:              statusId,
    codedName:       statusKey,
    commonName,
    effects,
    defaultDuration: '15 seconds',
    mndModifier:     '-',
    exclusiveStatus: '-',
    notes:           '',
    funcName:        'p (BusterAttack)',
    decoded:         true,
  };
}

// ─── Extra Buddy Mode p() decoder ────────────────────────────────────────────
// p({attachElementIds, abilityCondition, repeatNum?, extraRepeat?, increaseExecutedDamage?,
//    increaseCastTimeFactor?, chaseAbilityAtb?, flightDuration?})
// p() is a thin wrapper that adds repeatNum:1 as default then calls h().
// All per-character statuses: attach elements to extra kiwami abilities, trigger once extra.
// Optional: extra kiwami re-trigger (extraRepeat), damage boost, quick cast, ATB chase, flight.
function decodeEbmP(statusKey, statusId, argsText) {
  // ── 1. Character name from status key (strip EXTRA_BUDDY_MODE_ prefix) ──
  const suffix = statusKey.replace(/^EXTRA_BUDDY_MODE_/, '');
  const parts  = suffix.split('_');
  const keyElemKeys = [];
  while (parts.length > 1 && CBM_ELEMENT_KEYS.has(parts[parts.length - 1])) {
    keyElemKeys.unshift(parts.pop());
  }
  const MINOR_WORDS = new Set(['of', 'the', 'a', 'an']);
  const charRaw = parts.map((w, i) => {
    const word = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    return (i > 0 && MINOR_WORDS.has(word.toLowerCase())) ? word.toLowerCase() : word;
  }).join(' ');
  const charName      = canonicalCharacterName(charRaw);
  const elemQualifier = keyElemKeys.length > 0
    ? ` (${keyElemKeys.map(k => elementDisplayName(k)).join('/')})`
    : '';
  const commonName    = `Extra Mode: ${charName}${elemQualifier}`;

  // ── 2. Ability condition (anyElementIds inside abilityCondition:{...}) ──
  const anyElemM     = argsText.match(/abilityCondition\s*:\s*\{[^}]*anyElementIds\s*:\s*\[([^\]]+)\]/);
  const condElemKeys = anyElemM
    ? [...anyElemM[1].matchAll(/ELEMENT_TYPE\.([A-Z_]+)/g)].map(m => m[1])
    : [];
  const condDesc = condElemKeys.length >= CBM_ALL_ELEMENTS.length
    ? 'all elemental'
    : condElemKeys.map(k => elementDisplayName(k)).join('/');

  // ── 3. attachElementIds ──
  const attachM    = argsText.match(/attachElementIds\s*:\s*\[([^\]]+)\]/);
  const attachKeys = attachM
    ? [...attachM[1].matchAll(/ELEMENT_TYPE\.([A-Z_]+)/g)].map(m => m[1])
    : [];
  const attachDesc = attachKeys.map(k => elementDisplayName(k)).join('/');

  // ── 4. Build effects list ──
  const effectParts = [];

  // Always (ATTACH_ELEMENT_EXTRA_KIWAMI): damage boost based on element attachment level
  if (attachDesc) {
    const ekMapM = _rawBattleJs.match(/ATTACH_ELEMENT_EXTRA_KIWAMI\s*\]\s*=\s*\{[^}]*DAMAGE_FACTOR_MAP\s*:\s*\{([^}]+)\}/);
    let ekPcts = '10/20/30/40/50';
    if (ekMapM) {
      const entries = [...ekMapM[1].matchAll(/\d+\s*:\s*(\d+)/g)].map(m => m[1]);
      if (entries.length) ekPcts = entries.join('/');
    }
    effectParts.push(`Increases ${attachDesc} ability damage by ${ekPcts}% at Attach ${attachDesc} level 1/2/3/4/5`);
  }

  // Always (repeatNum:1 from p, REGISTER_SEQ_ABILITY_WHEN_ABILITY_DONE):
  // condition is t.abilityCondition (e.g. anyElementIds:[EARTH]) — not extra-kiwami-specific
  effectParts.push(`${condDesc} abilities trigger 1 additional time`);

  // extraRepeat: seq trigger for isExtraKiwamiAbility (default repeatNum:1, max 5)
  // Condition is isExtraKiwamiAbility:true — fires only for the extra kiwami abilities,
  // not all element abilities. Look up their names from the Extra sheet by character.
  if (/extraRepeat\s*:\s*!0/.test(argsText) || /extraRepeat\s*:\s*\{/.test(argsText)) {
    const rptM     = argsText.match(/extraRepeat\s*:\s*\{[^}]*repeatNum\s*:\s*(\d+)/);
    const maxM     = argsText.match(/extraRepeat\s*:\s*\{[^}]*seqAbilityDoneCountForIsDone\s*:\s*(\d+)/);
    const rptNum   = rptM ? parseInt(rptM[1])   : 1;
    const maxCount = maxM ? parseInt(maxM[1])   : 5;
    const timesStr = rptNum === 1 ? '1 additional time' : `${rptNum} additional times`;
    effectParts.push(`Extra Abilities trigger ${timesStr} (max ${maxCount})`);
  }

  // increaseExecutedDamage: MEDIUM (+30%) for matching element abilities (+ isAbility)
  if (/increaseExecutedDamage\s*:\s*!0/.test(argsText) || /increaseExecutedDamage\s*:\s*\{/.test(argsText)) {
    const sizeM    = argsText.match(/increaseExecutedDamage\s*:\s*\{[^}]*DAMAGE_FACTOR\.([A-Z_0-9]+)/);
    const sizeName = sizeM?.[1] ?? 'MEDIUM';
    const factorVal = DB.damageFactor[sizeName];
    const pct      = factorVal != null ? factorVal - 100 : 30;
    effectParts.push(`${condDesc} abilities deal ${pct}% more damage`);
  }

  // increaseCastTimeFactor: Quick Cast MAX for matching element abilities (+ isAbility)
  if (/increaseCastTimeFactor\s*:\s*!0/.test(argsText) || /increaseCastTimeFactor\s*:\s*\{/.test(argsText)) {
    effectParts.push(`Instant Cast ${condDesc} abilities`);
  }

  // chaseAbilityAtb: ATB chase (default MEDIUM ATB 1, max 3) after matching element abilities
  if (/chaseAbilityAtb\s*:\s*!0/.test(argsText) || /chaseAbilityAtb\s*:\s*\{/.test(argsText)) {
    const chaseKeyM = argsText.match(/chaseAbilityAtb\s*:\s*\{[^}]*chaseAbilityId\s*:\s*[a-zA-Z$_]\w*\.([A-Z_0-9]+)/);
    const chaseKey  = chaseKeyM?.[1] ?? 'INFLICT_SA_TO_EXECUTER_OF_SET_ATB_TIME_FACTOR_MEDIUM_1';
    const chaseId   = DB.abilityIdOf[chaseKey];
    const chaseName = abilityDisplayName(chaseId) ?? '200% ATB 1';
    const maxM      = argsText.match(/chaseAbilityAtb\s*:\s*\{[^}]*chaseAbilityDoneCountForIsDone\s*:\s*(\d+)/);
    const maxCount  = maxM ? parseInt(maxM[1]) : 3;
    effectParts.push(`triggers [${chaseName}] after using ${condDesc} abilities (max ${maxCount})`);
  }

  // flightDuration: no wait time for jumps
  if (/flightDuration\s*:\s*\d+/.test(argsText)) effectParts.push('No air time for jump abilities');

  const ebmBaseId   = DB.statusAilmentsForward['EXTRA_BUDDY_MODE'];
  const ebmBaseName = DB.statusMap[ebmBaseId]?.commonName || 'Extra Buddy Mode';
  effectParts.push(`removed if user hasn't [${ebmBaseName}]`);

  return {
    id:              statusId,
    codedName:       statusKey,
    commonName,
    effects:         effectParts.join(', '),
    defaultDuration: '-',
    mndModifier:     '-',
    exclusiveStatus: '-',
    notes:           '',
    funcName:        'p (ExtraBuddyMode)',
    decoded:         true,
  };
}

// ─── Decoder dispatcher ───────────────────────────────────────────────────────
// ─── Describing from game data ───────────────────────────────────────────────
// Statuses no helper decoder handles are described from their battle.js config
// (DB.game, filled by loadGameData) by ffrk/status_text.
function describeFromGameData(statusId) {
  const params = DB.game?.statusParams[statusId];
  if (!params) return null;
  return describeStatus(params, {
    conf:        DB.game.conf,
    element:     key => elementDisplayName(key),
    category:    key => categoryDisplayName(key),
    statusName:  id => DB.statusMap[id]?.commonName || (DB.statusById[id] ? titleCase(DB.statusById[id]) : null),
    // Abilities not yet on the Other tab get a visible placeholder to fill in.
    abilityName: id => abilityDisplayName(id) ?? '<ability missing from Other Tab>',
    abilityNameFrom: (id, source) => DB.otherNamesByIdAndSource[`${id}|${source}`] ?? null,
    abilitySources: id => DB.otherSourcesById[id] ?? [],
    statusKey:   id => DB.statusById[id] ?? null,
    statusId:    key => DB.statusAilmentsForward[key] ?? null,
    selfKey:     DB.statusById[statusId] ?? null,
    statusParams: key => DB.game.statusParams[DB.statusAilmentsForward[key]] ?? null,
    characterName: raw => canonicalCharacterName(titleCase(raw)),
    followUps:   source => DB.otherNamesBySource[source] ?? [],
    followUpEffects: source => DB.otherEffectsBySource[source] ?? [],
  });
}

// ─── Decoder registry ────────────────────────────────────────────────────────
// Each status is assigned with a battle.js helper (X[Y.KEY]=helper(args)). Decoders
// are chosen by a fingerprint of the helper's body — the effect types and option
// names it uses, which survive minification — not by the helper's minified name,
// which changes on every repack. Where several decoders match, the first one that
// accepts the arguments (returns non-null) wins.
const STATUS_DECODERS = [
  // ADJUST_DAMAGE_ZERO_* and friends: received damage scaled by a factor.
  { module: MAIN_MODULE, fingerprint: /\.INCREASE_RECEIVED_DAMAGE,damageFactor:\w+,abilityCondition:\w+\}/, decode: decodeNt },
  // LEARNING_MODE_*: damage rate by state level; decodeOr rejects non-"learningMode…" args.
  { module: MAIN_MODULE, fingerprint: /generalValueToAbilityDamageRateMap/, decode: decodeOr },
  // REDUCE_CONSUME_POINT_* for a specific soul strike.
  { module: MAIN_MODULE, fingerprint: /\.REDUCE_CONSUME_POINT,reduceConsumePoint:[\w.]+\*\w+,abilityCondition:\{abilityId:/, decode: decodeXr },
  // Crystal Force Mode: ability boost + repeat + no consumption + piercing.
  { module: CBM_MODULE, fingerprint: /\.ABILITY_BOOST,damageFactorMapType:/, decode: decodeCbmP },
  // Crystal Force Mode: cast-time factor + no consumption.
  { module: CBM_MODULE, fingerprint: /\.INCREASE_CAST_TIME_FACTOR,castTimeFactor:\w+\.castTimeFactor,abilityCondition:\w+\},\{key:2,type:\w+\.NO_CONSUMPTION_ABILITY_NUM/, decode: decodeCbmD },
  // Tactical Awoken Mode: chase ability (the plain variant, without battle-attack chases).
  { module: TAM_MODULE, fingerprint: /chaseAbilityId:\w+\.CHASE_ABILITY_FOR_[A-Z_]+,flightDuration:/, decode: decodeTamV },
  // Tactical Awoken Mode: DEF/RES piercing.
  { module: TAM_MODULE, fingerprint: /\.DEF_AND_MDEF_PENETRATION,penetrationFactorMapType:\w+\.penetrationFactorMapType/, decode: decodeTamD },
  // Buster chase mode.
  { module: BUSTER_MODULE, fingerprint: /chaseAbilityDoneCountForIsDone:\w+\.chaseAbilityDoneCountForIsDone/, decode: decodeBusterP },
  // Extra Mode: thin wrapper that defaults repeatNum to 1.
  { module: EBM_MODULE, fingerprint: /\{repeatNum:1\},\w+\),\w+\(\w+\)/, decode: decodeEbmP },
];

// Source of the helper a status is assigned with (cached per module + helper name).
function helperBody(assignment) {
  const key = `${assignment.defineModule}|${assignment.funcName}`;
  if (!(key in DB.helperBodies)) {
    const block = assignment.block || extractDefineBlock(assignment.defineModule)?.block || '';
    DB.helperBodies[key] = extractFuncDef(assignment.funcName, block) ?? '';
  }
  return DB.helperBodies[key];
}

function decodeStatus(statusKey) {
  const id = DB.statusAilmentsForward[statusKey];
  if (id == null) return { error: `Status key not found in battle.js: ${statusKey}` };

  const assignment = DB.statusAssignments[statusKey];
  if (!assignment && describeFromGameData(id)) {
    const described = describeFromGameData(id);
    return {
      id, codedName: statusKey, commonName: described.name,
      effects: described.effects, defaultDuration: described.defaultDuration,
      mndModifier: '-', exclusiveStatus: '-', notes: '',
      funcName: 'game data', decoded: true, _statusKey: statusKey,
    };
  }
  if (!assignment) {
    const raw = findRawAssignment(statusKey);
    return {
      id,
      codedName:       statusKey,
      warning:         `Assignment not in any scanned block${raw ? ` (found in: ${raw.defineModule})` : ' (not found in battle.js)'}`,
      commonName:      null,
      effects:         null,
      defaultDuration: null,
      mndModifier:     '-',
      exclusiveStatus: '-',
      notes:           '',
      funcName:        raw?.funcName ?? null,
      argsText:        raw?.argsText ?? null,
      defineModule:    raw?.defineModule ?? null,
      _block:          raw?.block ?? null,
      _funcName:       raw?.funcName ?? null,
      _argsText:       raw?.argsText ?? null,
      _statusKey:      statusKey,
      decoded:         false,
    };
  }

  const { funcName, argsText, defineModule, block } = assignment;

  // Decoders receive `block` so they can look up any helper function bodies
  // within the correct define() namespace — never cross-referencing other blocks.
  let decoded = null;
  const body = helperBody(assignment);
  for (const d of STATUS_DECODERS) {
    if (d.module !== defineModule || !d.fingerprint.test(body)) continue;
    decoded = d.decode(statusKey, id, argsText, block, body);
    if (decoded) break;
  }

  if (decoded) {
    decoded._block      = block;
    decoded._funcName   = funcName;
    decoded._argsText   = argsText;
    decoded._statusKey  = statusKey;
    return decoded;
  }

  // No helper decoder: describe it from the game's own config (battle.js run in a Worker).
  const described = describeFromGameData(id);
  if (described) {
    return {
      id,
      codedName:       statusKey,
      commonName:      described.name,
      effects:         described.effects,
      defaultDuration: described.defaultDuration,
      mndModifier:     '-',
      exclusiveStatus: '-',
      notes:           '',
      funcName:        'game data',
      decoded:         true,
      _block: block, _funcName: funcName, _argsText: argsText, _statusKey: statusKey,
    };
  }

  // Fallback: not yet implemented
  return {
    id,
    codedName:       statusKey,
    commonName:      null,
    effects:         null,
    defaultDuration: null,
    mndModifier:     '-',
    exclusiveStatus: '-',
    notes:           '',
    funcName,
    argsText,
    defineModule,
    _block:      block,
    _funcName:   funcName,
    _argsText:   argsText,
    _statusKey:  statusKey,
    decoded:         false,
  };
}

// ─── Raw battle.js fallback search ───────────────────────────────────────────
// Used when a status key is found in STATUS_AILMENTS_TYPE but not in any scanned block.
function findRawAssignment(statusKey) {
  if (!_rawBattleJs) return null;
  const re = new RegExp(`[^A-Z_0-9]${statusKey}\\]\\s*=\\s*([a-zA-Z$_][a-zA-Z0-9$_]*)\\s*\\(`);
  const m = re.exec(_rawBattleJs);
  if (!m) return null;
  const funcName  = m[1];
  const argsStart = m.index + m[0].length;
  let pdepth = 1, i = argsStart;
  while (i < _rawBattleJs.length && pdepth > 0) {
    if      (_rawBattleJs[i] === '(') pdepth++;
    else if (_rawBattleJs[i] === ')') pdepth--;
    i++;
  }
  const argsText = _rawBattleJs.slice(argsStart, i - 1);
  // Find nearest preceding define() to get module name and block
  const defineRe = /define\("([^"]+)"/g;
  let lastDefine = null, dm;
  while ((dm = defineRe.exec(_rawBattleJs)) !== null && dm.index < m.index) lastDefine = dm;
  let block = '', defineModule = 'unknown';
  if (lastDefine) {
    defineModule = lastDefine[1];
    const fnStart = _rawBattleJs.indexOf('function', lastDefine.index + lastDefine[0].length);
    if (fnStart !== -1) {
      const brace = _rawBattleJs.indexOf('{', fnStart);
      if (brace !== -1) {
        let bd = 1, bi = brace + 1;
        while (bi < _rawBattleJs.length && bd > 0) {
          if      (_rawBattleJs[bi] === '{') bd++;
          else if (_rawBattleJs[bi] === '}') bd--;
          bi++;
        }
        block = _rawBattleJs.slice(brace, bi);
      }
    }
  }
  return { funcName, argsText, block, defineModule };
}

// ─── JS prettifier ───────────────────────────────────────────────────────────
// Simple formatter for minified battle.js snippets.
function prettyJs(src) {
  const TAB = '    ';
  let out = '';
  let depth = 0;
  let i = 0;
  const stack = []; // tracks '{', '[', '('

  function trimEnd() { out = out.replace(/[ \t]+$/, ''); }
  function nl()      { trimEnd(); out += '\n' + TAB.repeat(depth); }
  function skipWs()  { while (i < src.length && ' \t\n\r'.includes(src[i])) i++; }

  while (i < src.length) {
    const ch = src[i];

    // String literals
    if (ch === '"' || ch === "'") {
      const q = ch; out += q; i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        if (src[i] === q)    { out += q; i++; break; }
        out += src[i++];
      }
      continue;
    }

    if (ch === '{') {
      if (out.length && !' \n('.includes(out[out.length - 1])) out += ' ';
      out += '{'; stack.push('{'); depth++; i++; skipWs();
      if (i < src.length && src[i] !== '}') nl();
      continue;
    }
    if (ch === '}') {
      stack.pop(); depth = Math.max(0, depth - 1); nl(); out += '}'; i++;
      continue;
    }
    if (ch === '[') { stack.push('['); out += '['; i++; continue; }
    if (ch === ']') { stack.pop();    out += ']'; i++; continue; }
    if (ch === '(') { stack.push('('); out += '('; i++; continue; }
    if (ch === ')') { stack.pop();    out += ')'; i++; continue; }

    if (ch === ';') { out += ';'; i++; skipWs(); nl(); continue; }

    if (ch === ',') {
      out += ','; i++; skipWs();
      if (stack[stack.length - 1] === '{') nl();
      else out += ' ';
      continue;
    }

    if (ch === ':' && stack[stack.length - 1] === '{') {
      out += ': '; i++; skipWs(); continue;
    }

    // Pad = assignment (not ==, !=, <=, >=)
    if (ch === '=' && src[i + 1] !== '=' && !'!<>'.includes(src[i - 1] ?? '')) {
      out += ' = '; i++; skipWs(); continue;
    }

    // Whitespace normalisation
    if (' \t\n\r'.includes(ch)) {
      const last = out[out.length - 1] ?? '';
      if (last !== ' ' && last !== '\n') out += ' ';
      i++; continue;
    }

    out += ch; i++;
  }
  return out.trim();
}

// ─── Source code extraction ───────────────────────────────────────────────────
// Extract the full definition of a named function from a define() block body.
function extractFuncDef(name, block) {
  // Matches: var NAME=function(...){  or  NAME=function(...){  or  function NAME(...){
  const escaped = name.replace(/[$]/g, '\\$');
  const re = new RegExp(
    `(?:var\\s+${escaped}\\s*=\\s*function|\\b${escaped}\\s*=\\s*function|function\\s+${escaped})\\s*\\([^)]*\\)\\s*\\{`
  );
  const m = re.exec(block);
  if (!m) return null;
  const braceStart = block.indexOf('{', m.index + m[0].length - 1);
  if (braceStart === -1) return null;
  let depth = 1, i = braceStart + 1;
  while (i < block.length && depth > 0) {
    if      (block[i] === '{') depth++;
    else if (block[i] === '}') depth--;
    i++;
  }
  return block.slice(m.index, i);
}

// Collect function definition + all callees defined in the same block, recursively.
function collectSourceDefs(rootName, block) {
  const seen = new Set();
  const defs = [];
  function collect(name) {
    if (seen.has(name)) return;
    seen.add(name);
    const def = extractFuncDef(name, block);
    if (!def) return;
    defs.push({ name, def });
    // Find all identifiers immediately followed by '(' — potential callees
    const callRe = /\b([a-zA-Z$_][a-zA-Z0-9$_]*)\s*\(/g;
    let cm;
    while ((cm = callRe.exec(def)) !== null) {
      if (cm[1] !== name) collect(cm[1]);
    }
  }
  collect(rootName);
  return defs;
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderResult(result) {
  if (result.error) {
    document.getElementById('output').innerHTML = `<div class="err-box">${escHtml(result.error)}</div>`;
    return;
  }
  if (result.warning) {
    // Show warning inline but continue rendering the card
    let warnHtml = `<div class="err-box" style="margin-bottom:8px;">${escHtml(result.warning)}</div>`;
    document.getElementById('output').innerHTML = warnHtml;
  } else {
    document.getElementById('output').innerHTML = '';
  }

  const sheetRow = DB.statusMap[result.id];

  // Sheet row columns — use decoded if available, fall back to sheet
  const displayName     = result.commonName      ?? sheetRow?.commonName ?? '—';
  const displayEffects  = result.effects         ?? sheetRow?.effects    ?? '—';
  const displayDuration = result.defaultDuration ?? sheetRow?.duration   ?? '—';

  let html = `<div class="status-card">`;
  html += `<div class="status-card-title">${escHtml(result.codedName)}</div>`;

  html += `<table class="sheet-row-table">`;
  html += `<tr><th>ID</th><td class="col-id">${result.id}</td></tr>`;
  html += `<tr><th>Common Name</th><td class="col-name">${escHtml(displayName)}</td></tr>`;
  html += `<tr><th>Effects</th><td class="col-effects">${escHtml(displayEffects)}</td></tr>`;
  html += `<tr><th>Default Duration</th><td class="col-duration">${escHtml(displayDuration)}</td></tr>`;
  html += `<tr><th>MND Modifier</th><td class="col-dash">${result.mndModifier}</td></tr>`;
  html += `<tr><th>Exclusive Status</th><td class="col-dash">${result.exclusiveStatus}</td></tr>`;
  html += `<tr><th>Coded Name</th><td class="col-coded">${escHtml(result.codedName)}</td></tr>`;
  html += `<tr><th>Notes</th><td class="col-dash">${escHtml(result.notes) || '—'}</td></tr>`;
  html += `</table>`;

  // TSV copy row (tab-separated in sheet column order: ID, Common Name, Effects, Duration, MND, Exclusive, Coded Name, Notes)
  const tsvCols = [
    result.id,
    displayName,
    displayEffects,
    displayDuration,
    result.mndModifier,
    result.exclusiveStatus,
    result.codedName,
    result.notes,
  ];
  const tsv = tsvCols.join('\t');

  html += `<div class="copy-row">`;
  html += `<button class="copy-btn">Copy row (TSV)</button>`;
  html += `<textarea class="tsv-area" readonly id="tsv-out">${escHtml(tsv)}</textarea>`;
  html += `</div>`;

  // Decoder note
  if (!result.decoded) {
    html += `<div class="decoder-unknown">`;
    html += `Decoder not yet implemented for function <strong>${escHtml(result.funcName)}</strong> in <em>${escHtml(result.defineModule ?? '?')}</em>.<br>`;
    html += `Raw call: <span class="raw-func">${escHtml(result.funcName)}</span>(<span class="raw-args">${escHtml(result.argsText ?? '')}</span>)`;
    html += `</div>`;
  } else {
    html += `<div class="decoder-note">Decoded via <strong>${escHtml(result.funcName)}</strong>()</div>`;
  }

  // Source code expandable
  if (result._block != null && result._funcName != null) {
    const defs = collectSourceDefs(result._funcName, result._block);
    const assignVar = result._statusKey ?? '?';
    const rawCall   = `${result._funcName}(${result._argsText ?? ''})`;
    let srcText = `// Assignment\n${assignVar} = ${rawCall}`;
    if (defs.length > 0) {
      srcText += '\n\n// Function definition(s)\n';
      srcText += defs.map(d => prettyJs(d.def)).join('\n\n');
    }
    html += `<div class="raw-section"><details>`;
    html += `<summary>Source code</summary>`;
    html += `<div class="raw-block">${escHtml(srcText)}</div>`;
    html += `</details></div>`;
  }

  // The game's own config for this status (battle.js run in a Worker)
  const gameParams = DB.game?.statusParams[result.id];
  html += `<div class="raw-section"><details${result.decoded ? '' : ' open'}>`;
  html += `<summary>Game data (battle.js)</summary>`;
  html += `<div class="raw-block">${escHtml(!DB.game ? 'Still running battle.js…' : gameParams ? formatGameParams(gameParams) : 'No config for this status in battle.js.')}</div>`;
  html += `</details></div>`;

  // Sheet row (if exists)
  if (sheetRow) {
    html += `<div class="raw-section"><details>`;
    html += `<summary>Existing sheet row</summary>`;
    html += `<div class="raw-block">Common Name: ${escHtml(sheetRow.commonName)}\nEffects: ${escHtml(sheetRow.effects)}\nDuration: ${escHtml(sheetRow.duration)}</div>`;
    html += `</details></div>`;
  }

  html += `</div>`;
  document.getElementById('output').innerHTML += html;
}

function copyTsv(btn) {
  const area = document.getElementById('tsv-out');
  if (!area) return;
  navigator.clipboard.writeText(area.value).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = orig, 1500);
  });
}

function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Search & autocomplete ────────────────────────────────────────────────────
const input = document.getElementById('status-input');
const acBox  = document.getElementById('autocomplete');
let acItems  = [];
let acIndex  = -1;

function runDecode() {
  const raw = input.value.trim();
  if (!raw) return;

  let statusKey = null;

  // Try as numeric ID
  const asNum = parseInt(raw);
  if (!isNaN(asNum) && String(asNum) === raw) {
    statusKey = DB.statusById[asNum];
    if (!statusKey) {
      document.getElementById('output').innerHTML = `<div class="err-box">No status found with ID ${asNum}</div>`;
      return;
    }
  } else {
    statusKey = raw.toUpperCase().replace(/\s+/g, '_');
    if (!DB.statusAilmentsForward[statusKey]) {
      document.getElementById('output').innerHTML = `<div class="err-box">Status key not found: ${escHtml(statusKey)}</div>`;
      return;
    }
  }

  closeAc();
  renderResult(decodeStatus(statusKey));
}

function showAc(query) {
  if (!query || query.length < 2) { closeAc(); return; }
  const q = query.toUpperCase().replace(/\s+/g, '_');
  const allKeys = Object.keys(DB.statusAilmentsForward);
  const matches = allKeys.filter(k => k.includes(q)).slice(0, 20);

  if (!matches.length) { closeAc(); return; }

  acItems = matches;
  acIndex = -1;
  acBox.innerHTML = matches.map((k, i) =>
    `<div class="ac-item" data-key="${escHtml(k)}" data-idx="${i}">
      ${escHtml(k)}<span class="ac-id">${DB.statusAilmentsForward[k]}</span>
    </div>`
  ).join('');
  acBox.style.display = 'block';

  for (const item of acBox.querySelectorAll('.ac-item')) {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      input.value = item.dataset.key;
      closeAc();
      runDecode();
    });
  }
}

function closeAc() {
  acBox.style.display = 'none';
  acBox.innerHTML = '';
  acItems = [];
  acIndex = -1;
}

function setAcIndex(idx) {
  const items = acBox.querySelectorAll('.ac-item');
  items.forEach(el => el.classList.remove('ac-selected'));
  if (idx >= 0 && idx < items.length) {
    items[idx].classList.add('ac-selected');
    acIndex = idx;
  }
}

input.addEventListener('input', () => showAc(input.value));
input.addEventListener('blur',  () => setTimeout(closeAc, 150));
input.addEventListener('keydown', e => {
  if (e.key === 'Enter') { runDecode(); closeAc(); return; }
  if (e.key === 'Escape') { closeAc(); return; }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const next = Math.min(acIndex + 1, acItems.length - 1);
    setAcIndex(next);
    if (acItems[next]) input.value = acItems[next];
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prev = Math.max(acIndex - 1, 0);
    setAcIndex(prev);
    if (acItems[prev]) input.value = acItems[prev];
  }
});

document.getElementById('decode-btn').addEventListener('click', runDecode);

// Copy buttons are rendered into #output, so listen there (module functions
// aren't reachable from inline onclick attributes).
document.getElementById('output').addEventListener('click', e => {
  const btn = e.target.closest?.('.copy-btn');
  if (btn) copyTsv(btn);
});

// Asks the server to re-fetch the sheets and battle.js (rate-limited server-side),
// then reloads the page so every derived map is rebuilt from the new data.
document.getElementById('refresh-btn').addEventListener('click', async () => {
  const btn = document.getElementById('refresh-btn');
  const detail = document.getElementById('refresh-detail');
  btn.disabled = true;
  detail.textContent = 'refreshing on the server…';
  const error = await refreshServerData();
  if (!error) { location.reload(); return; }
  detail.textContent = error;
  btn.disabled = false;
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
Promise.all([loadBattleJs(), loadSheets()]);

// Exposed for the Node tests (test/js); the page itself doesn't import anything from here.
export { DB, decodeStatus, parseReady, formatGameParams };
