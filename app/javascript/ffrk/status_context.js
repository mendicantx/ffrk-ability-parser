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
const MISSING_ABILITY_HTML = '&lt;ability missing from Other Tab&gt;';

// The Ability Parser opened on finding a missing ability: it asks for the JSON of the
// soul break that grants the status, then shows the ability's Other-tab row.
export const findAbilityUrl = (abilityId, statusId) => `/ability_parser?ability=${abilityId}&status=${statusId}`;

// In HTML-escaped status text, makes the placeholder a link to adding the ability to the
// Other tab. linkAttrs(abilityId) gives the link's attributes (href, target). With several missing abilities, which
// placeholder is which isn't known, so each ID gets its own link after the text instead.
export function linkMissingAbilities(html, abilityIds, linkAttrs) {
  if (!abilityIds?.length || !html.includes(MISSING_ABILITY_HTML)) return html;
  const link = (id, text) =>
    `<a class="missing-ability-link" ${linkAttrs(id)} title="Ability ${id} isn't on the Other tab: find it in the Ability Parser">${text}</a>`;
  if (abilityIds.length === 1) return html.split(MISSING_ABILITY_HTML).join(link(abilityIds[0], MISSING_ABILITY_HTML));
  return `${html}<br><span class="missing-abilities">Missing from the Other tab: ${abilityIds.map(id => link(id, id)).join(', ')}</span>`;
}

// { conf, statusParams } from the runtime; sheets: { status, other, characters } rows.
// Returns { describe(statusId) → { name, effects, defaultDuration, missingAbilities? } or null,
// abilityName(id) }. missingAbilities lists the IDs shown as MISSING_ABILITY.
export function statusDescriber({ conf, statusParams }, sheets) {
  const statusById = {};
  for (const [key, id] of Object.entries(conf.STATUS_AILMENTS_TYPE ?? {})) statusById[id] = key;
  const statusByKey = conf.STATUS_AILMENTS_TYPE ?? {};

  const sheetNames = {};
  for (const r of sheets.status ?? []) {
    const id = parseInt(r['ID']);
    if (!isNaN(id) && r['Common Name']) sheetNames[id] = r['Common Name'];
  }

  const otherEffects = {};
  const otherNames = {}, namesBySource = {}, effectsBySource = {}, nameByIdAndSource = {}, sourcesById = {};
  for (const r of sheets.other ?? []) {
    const id = parseInt(r['ID']);
    const source = r['Source'];
    if (!isNaN(id) && r['Name']) otherNames[id] = r['Name'];
    if (!isNaN(id) && r['Effects']) otherEffects[id] = r['Effects'];
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
    // Abilities shown as the placeholder, so the tools can link to adding them.
    const missing = new Set();
    const missingAbility = id => { if (id != null) missing.add(id); return MISSING_ABILITY; };
    const result = describeStatus(params, {
      conf,
      element:         key => elementName(key),
      category:        key => schoolName(key),
      statusName:      id => sheetNames[id] || (statusById[id] ? titleCase(statusById[id]) : null),
      abilityName:     id => abilityName(id) ?? missingAbility(id),
      abilityEffects:  id => otherEffects[id] ?? null,
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
    return result && missing.size && `${result.name} ${result.effects}`.includes(MISSING_ABILITY)
      ? { ...result, missingAbilities: [...missing] } : result;
  };
  return { describe, abilityName };
}
