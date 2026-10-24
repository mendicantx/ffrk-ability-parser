// Describes statuses from the game's config (ffrk/status_text) for both tools: builds
// the lookups describeStatus needs from the sheets (Status, Other, Characters) and the
// battle.js runtime's output (ffrk/battle_runtime).
import { describeStatus } from 'ffrk/status_text';
import { canonicalCharacterName, elementName, schoolName, titleCase } from 'ffrk/names';

// Abilities the sheet doesn't list but statuses refer to.
export const KNOWN_ABILITY_NAMES = {
  31545795: '111% ATB 1',
  31547024: '200% ATB 1',
};

// Abilities not yet on the Other tab get a visible placeholder to fill in.
export const MISSING_ABILITY = '<ability missing from Other Tab>';

// { conf, statusParams } from the runtime; sheets: { status, other, characters } rows.
// Returns { describe(statusId) → { name, effects, defaultDuration } or null, abilityName(id) }.
export function statusDescriber({ conf, statusParams }, sheets) {
  const statusById = {};
  for (const [key, id] of Object.entries(conf.STATUS_AILMENTS_TYPE ?? {})) statusById[id] = key;
  const statusByKey = conf.STATUS_AILMENTS_TYPE ?? {};

  const sheetNames = {};
  for (const r of sheets.status ?? []) {
    const id = parseInt(r['ID']);
    if (!isNaN(id) && r['Common Name']) sheetNames[id] = r['Common Name'];
  }

  const otherNames = {}, namesBySource = {}, effectsBySource = {}, nameByIdAndSource = {}, sourcesById = {};
  for (const r of sheets.other ?? []) {
    const id = parseInt(r['ID']);
    const source = r['Source'];
    if (!isNaN(id) && r['Name']) otherNames[id] = r['Name'];
    if (!source) continue;
    if (r['Name']) (namesBySource[source] ??= []).push(r['Name']);
    if (r['Effects']) (effectsBySource[source] ??= []).push(r['Effects']);
    if (!isNaN(id)) {
      if (r['Name']) nameByIdAndSource[`${id}|${source}`] = r['Name'];
      (sourcesById[id] ??= []).push(source);
    }
  }

  const characterNames = {};
  for (const r of sheets.characters ?? []) {
    const name = (r['Name'] || '').trim();
    if (name) characterNames[name.toLowerCase()] = name;
  }

  const abilityName = id => (id == null ? null : otherNames[id] ?? KNOWN_ABILITY_NAMES[id] ?? null);

  const describe = statusId => {
    const params = statusParams[statusId];
    if (!params) return null;
    return describeStatus(params, {
      conf,
      element:         key => elementName(key),
      category:        key => schoolName(key),
      statusName:      id => sheetNames[id] || (statusById[id] ? titleCase(statusById[id]) : null),
      abilityName:     id => abilityName(id) ?? MISSING_ABILITY,
      abilityNameFrom: (id, source) => nameByIdAndSource[`${id}|${source}`] ?? null,
      abilitySources:  id => sourcesById[id] ?? [],
      statusKey:       id => statusById[id] ?? null,
      statusId:        key => statusByKey[key] ?? null,
      selfKey:         statusById[statusId] ?? null,
      statusParams:    key => statusParams[statusByKey[key]] ?? null,
      characterName:   raw => canonicalCharacterName(titleCase(raw), characterNames),
      followUps:       source => namesBySource[source] ?? [],
      followUpEffects: source => effectsBySource[source] ?? [],
    });
  };
  return { describe, abilityName };
}
