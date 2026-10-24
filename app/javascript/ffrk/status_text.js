// Describes a status from its game config (from ffrk/battle_runtime) in the Status
// sheet's wording: one clause per effect, joined with ", " (docs/decisions.md
// "Describing statuses from game data"). A status is described only when every one
// of its effects is understood — no partial text.
//
// ctx: {
//   conf,                // battle.js Conf tables
//   element(key),        // ELEMENT_TYPE key → display name ('FIRE' → 'Fire')
//   category(key),       // ABILITY_CATEGORY_ID key → display name ('BLACK_MAGIC' → 'Black Magic')
//   statusName(id),      // status id → sheet name (for "removed if the user hasn't [X]")
//   abilityName(id),     // ability id → name (for ability-specific effects)
//   statusKey(id),       // status id → STATUS_AILMENTS_TYPE key
// }

const nameOf = (table, value) => Object.keys(table ?? {}).find(k => table[k] === value) ?? null;

// "A", "A and B", "A, B and C" (or "or").
function joinList(items, word) {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${word} ${items[items.length - 1]}`;
}

// The abilities an abilityCondition applies to, e.g. "Fire", "Water and Holy",
// "Black Magic and Witch" — or null when the condition has parts we don't phrase.
// word '/' gives elements only, slash-joined ("Water/Holy").
function conditionSubject(cond, ctx, word = 'and') {
  if (!cond) return '';
  const known = new Set(['elementId', 'anyElementIds', 'categoryId', 'anyCategoryIds', 'isAbility', 'hasDamage']);
  if (Object.keys(cond).some(k => !known.has(k))) return null;
  const elements = [].concat(cond.elementId ?? cond.anyElementIds ?? []).sort((a, b) => a - b)
    .map(id => ctx.element(nameOf(ctx.conf.ELEMENT_TYPE, id)));
  const categories = [].concat(cond.categoryId ?? cond.anyCategoryIds ?? [])
    .map(id => ctx.category(nameOf(ctx.conf.ABILITY_CATEGORY_ID, id)));
  if (elements.length && categories.length) return null;
  if (word === '/') return elements.length ? elements.join('/') : null;
  return joinList(elements.length ? elements : categories, word);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const percent = factor => factor - 100;
// castTimeFactor at or above this is instant cast.
const INSTANT_CAST = 10000000;

// "after using a Fire ability" / "after using two Fire abilities" (the sheet writes "a"
// before vowels too).
const COUNT_WORDS = { 1: 'a', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight' };

// One clause per effect type; each returns null when it can't phrase the effect.
const EFFECTS = {
  // Follow-ups that cast one ability: "Casts Retsu after using two Wind abilities".
  REGISTER_CHASE_ABILITY_WHEN_ABILITY_DONE: (e, ctx) => {
    const known = new Set(['key', 'type', 'chaseType', 'abilityCondition', 'abilityUseCountCondition', 'chaseAbilityId', 'chaseAbilityDoneCountForIsDone']);
    if (e.chaseAbilityId == null || Object.keys(e).some(k => !known.has(k))) return null;
    const uses = e.abilityUseCountCondition?.multiple ?? 1;
    if (Object.keys(e.abilityUseCountCondition ?? {}).some(k => k !== 'multiple') || !COUNT_WORDS[uses]) return null;
    const name = ctx.abilityName(e.chaseAbilityId);
    const subject = conditionSubject(e.abilityCondition, ctx, 'or');
    if (!name || !subject) return null;
    const limit = e.chaseAbilityDoneCountForIsDone;
    if (limit != null && !COUNT_WORDS[limit]) return null;
    const removed = limit != null ? `, removed after triggering ${limit === 1 ? 'once' : `${COUNT_WORDS[limit]} times`}` : '';
    return `Casts ${name} after using ${COUNT_WORDS[uses]} ${subject} ${uses === 1 ? 'ability' : 'abilities'}${removed}`;
  },
  INCREASE_ELEMENT_ATK: (e, ctx) => {
    const subject = conditionSubject({ elementId: e.elementId }, ctx);
    if (!subject) return null;
    return e.level < 0 ? `Reduces ${subject} damage dealt by ${-e.level * 10}%` : `Increases ${subject} damage dealt by ${e.level * 10}%`;
  },
  INCREASE_ELEMENT_DEF: (e, ctx) => {
    const subject = conditionSubject({ elementId: e.elementId }, ctx);
    return subject ? `${subject} Resistance ${e.level < 0 ? '-' : '+'}${Math.abs(e.level) * 10}%` : null;
  },
  REGISTER_SEQ_ABILITY_WHEN_ABILITY_DONE: (e, ctx) => {
    if (e.registerProbability != null && e.registerProbability !== 100) return null;
    if (e.seqAbilityDoneCountForIsDone != null) return null;
    const subject = conditionSubject(e.abilityCondition, ctx, 'or');
    if (!subject) return null;
    return `${subject} abilities trigger ${e.repeatNum} additional time${e.repeatNum === 1 ? '' : 's'}`;
  },
  INCREASE_CAST_TIME_FACTOR: (e, ctx) => {
    if (e.castTimeFactor == null) return null;
    const cond = e.abilityCondition ?? {};
    const hasElements = cond.elementId != null || cond.anyElementIds != null;
    const instant = e.castTimeFactor >= INSTANT_CAST;
    const subject = hasElements && !instant ? conditionSubject(cond, ctx, '/') : conditionSubject(cond, ctx);
    if (!subject) return null;
    if (instant) return `Instant cast speed for ${subject}%NOUN%${cond.isAbility || !hasElements ? 'abilities' : 'attacks'}`;
    // %NOUN% marks where the noun goes: "while in X" variants drop it (see describeStatus).
    return `Cast speed x${(e.castTimeFactor / 100).toFixed(2)} for ${subject}%NOUN%${cond.isAbility || !hasElements ? 'abilities' : 'attacks'}`;
  },
  INCREASE_DAMAGE_THRESHOLD_LV: (e, ctx) => {
    const amount = e.damageThresholdLv * 10000;
    const cond = e.abilityCondition;
    if (!cond) return `Increases the damage/healing cap by ${amount}`;
    if (cond.abilityId != null && Object.keys(cond).length === 1) {
      const name = ctx.abilityName(cond.abilityId);
      return name ? `Increases the damage cap by ${amount} for ${name}` : null;
    }
    const elements = [].concat(cond.elementId ?? cond.anyElementIds ?? []);
    if (elements.length === 9) return `Increases the damage/healing cap for all elemental attacks by ${amount}`;
    const subject = conditionSubject(cond, ctx, 'or');
    return subject ? `Increases the damage/healing cap for ${subject} attacks by ${amount}` : null;
  },
  INCREASE_EXECUTED_DAMAGE: (e, ctx) => {
    const factor = e.damageFactor ?? e.maximumDamageFactor;
    if (factor == null) return null;
    const cond = e.abilityCondition ?? {};
    if (cond.hasWeakness && Object.keys(cond).every(k => k === 'hasWeakness' || k === 'hasDamage')) {
      return `Increases damage dealt by ${percent(factor)}% when exploiting elemental weaknesses`;
    }
    if (cond.isAbility) {
      const subject = conditionSubject(cond, ctx, 'or');
      return subject ? `${subject} abilities deal ${percent(factor)}% more damage` : null;
    }
    return null;
  },
  // "Ignores 50% of the target's DEF and RES"
  DEF_AND_MDEF_PENETRATION: e => (e.abilityCondition || e.penetrationFactorMapType == null
    ? null : `Ignores ${e.penetrationFactorMapType}% of the target's DEF and RES`),
};

// ─── Names ───────────────────────────────────────────────────────────────────
// Sheet names for single-effect statuses, e.g. "Buff Fire 20% (5s)", "Dualcast Fire,
// Dark 1", "Water/Holy Ability Quick Cast 1", "Fire, Holy Ability +15% Boost 3".
// The trailing number is the turn count; "(Tactical)" marks Tactical Awoken Mode.

const MULTICAST = { 1: 'Dualcast', 2: 'Triplecast', 3: 'Quadracast', 4: 'Pentacast' };
const ALL_ELEMENTS = 9;

function elementNames(cond, ctx) {
  return [].concat(cond?.elementId ?? cond?.anyElementIds ?? []).sort((a, b) => a - b)
    .map(id => ctx.element(nameOf(ctx.conf.ELEMENT_TYPE, id)));
}
function categoryNames(cond, ctx) {
  return [].concat(cond?.categoryId ?? cond?.anyCategoryIds ?? [])
    .map(id => ctx.category(nameOf(ctx.conf.ABILITY_CATEGORY_ID, id)));
}

const NAMES = {
  INCREASE_ELEMENT_ATK: (e, ctx, t) => t.seconds && e.level
    ? `${e.level < 0 ? 'Debuff' : 'Buff'} ${elementNames(e, ctx).join(', ')} ${Math.abs(e.level) * 10}% (${t.seconds}s)` : null,
  INCREASE_ELEMENT_DEF: (e, ctx, t) => t.seconds && e.level
    ? `${e.level < 0 ? 'Imperil' : 'Resist'} ${elementNames(e, ctx).join(', ')} ${Math.abs(e.level) * 10}% (${t.seconds}s)` : null,
  REGISTER_SEQ_ABILITY_WHEN_ABILITY_DONE: (e, ctx, t) => {
    const elements = elementNames(e.abilityCondition, ctx);
    const what = elements.length === ALL_ELEMENTS ? 'Prismatic' : elements.join(', ') || categoryNames(e.abilityCondition, ctx).join(', ');
    return MULTICAST[e.repeatNum] && what ? `${MULTICAST[e.repeatNum]} ${what}${t.suffix}` : null;
  },
  INCREASE_CAST_TIME_FACTOR: (e, ctx, t) => {
    const speed = e.castTimeFactor === 200 ? 'Quick Cast' : e.castTimeFactor >= INSTANT_CAST ? 'Instant Cast' : null;
    if (!speed) return null;
    const cond = e.abilityCondition ?? {};
    const elements = elementNames(cond, ctx);
    // Tactical Awoken Mode versions read "Fire, Wind Quick Cast (Tactical)".
    if (t.tactical) return elements.length ? `${elements.join(', ')} ${speed}${t.suffix}` : null;
    const what = (elements.length ? elements : categoryNames(cond, ctx)).join('/');
    if (!what) return null;
    return `${what}${cond.isAbility || !elements.length ? ' Ability' : ''} ${speed}${t.suffix || t.timeSuffix}`;
  },
  INCREASE_EXECUTED_DAMAGE: (e, ctx, t) => {
    const cond = e.abilityCondition ?? {};
    const pct = (e.damageFactor ?? e.maximumDamageFactor) - 100;
    const when = t.suffix || t.timeSuffix;
    if (cond.hasWeakness) return `Weakness +${pct}% Boost${when}`;
    const elements = elementNames(cond, ctx);
    if (elements.length) return `${elements.join(', ')} Ability +${pct}% Boost${when}`;
    const categories = categoryNames(cond, ctx);
    return categories.length ? `${categories.join(', ')} +${pct}% Boost${when}` : null;
  },
  INCREASE_DAMAGE_THRESHOLD_LV: (e, ctx, t) => {
    const amount = e.damageThresholdLv * 10000;
    if (!e.abilityCondition) return `Damage Cap +${amount}${t.suffix}`;
    const elements = elementNames(e.abilityCondition, ctx);
    if (!elements.length) return null;
    return `${elements.length === ALL_ELEMENTS ? 'Prismatic' : elements.join(', ')} Damage Cap +${amount}${t.suffix}`;
  },
  DEF_AND_MDEF_PENETRATION: (e, ctx, t) => (e.abilityCondition ? null
    : `DEF and RES ${e.penetrationFactorMapType}% Piercing${t.suffix || t.timeSuffix}`),
};

function statusNameFor(params, ctx) {
  if (params.effects.length !== 1) return null;
  const turn = (params.durations ?? []).find(d => nameOf(ctx.conf.STATUS_AILMENTS_PARAM_DURATION_TYPE, d.type) === 'TURN')?.turn;
  const time = (params.durations ?? []).find(d => nameOf(ctx.conf.STATUS_AILMENTS_PARAM_DURATION_TYPE, d.type) === 'TIME')?.time;
  const tactical = (params.durations ?? []).some(d => d.saId != null && ctx.statusKey?.(d.saId) === 'TACTICAL_AWAKE_MODE');
  const seconds = time ? time / 1000 : null;
  const timing = { suffix: turn ? ` ${turn}` : tactical ? ' (Tactical)' : '', seconds, timeSuffix: seconds ? ` (${seconds}s)` : '', tactical };
  const e = params.effects[0];
  return NAMES[nameOf(ctx.conf.STATUS_AILMENTS_PARAM_EFFECT_TYPE, e.type)]?.(e, ctx, timing) ?? null;
}

// The status's Default Duration and any ", removed if …" suffix.
function describeDurations(durations, ctx) {
  let duration = '-';
  const suffixes = [];
  for (const d of durations ?? []) {
    const type = nameOf(ctx.conf.STATUS_AILMENTS_PARAM_DURATION_TYPE, d.type);
    if (type === 'TURN' && d.turn != null) duration = plural(d.turn, 'turn');
    else if (type === 'TIME' && d.time != null) duration = plural(d.time / 1000, 'second');
    else if (type === 'USNET_WHEN_SPECIFIC_SA_UNSET' && d.saId != null) {
      const name = ctx.statusName(d.saId);
      if (!name) return null;
      suffixes.push({ removedUnless: name });
    } else if (type === 'UNSET_WHEN_SPECIFIC_EFFECT_IS_DONE') {
      // Ends when an effect finishes (e.g. after N follow-ups) — the effect's own text says so.
    } else return null;
  }
  return { duration, suffixes };
}

// { name, effects, defaultDuration } in the sheet's wording (name may be null), or null when any part of the
// status isn't understood yet.
export function describeStatus(params, ctx) {
  if (!params?.effects?.length) return null;
  const clauses = [];
  for (const e of params.effects) {
    const describe = EFFECTS[nameOf(ctx.conf.STATUS_AILMENTS_PARAM_EFFECT_TYPE, e.type)];
    const clause = describe?.(e, ctx);
    if (!clause) return null;
    clauses.push(clause);
  }
  const durations = describeDurations(params.durations, ctx);
  if (!durations) return null;
  // OVERLAP statuses stack with themselves: "cumulable".
  if (nameOf(ctx.conf.STATUS_AILMENTS_PARAM_OVERLAP_TYPE, params.overlap?.type) === 'OVERLAP'
      && params.effects.every(e => ['INCREASE_ELEMENT_ATK', 'INCREASE_ELEMENT_DEF'].includes(nameOf(ctx.conf.STATUS_AILMENTS_PARAM_EFFECT_TYPE, e.type)))) {
    clauses.push('cumulable');
  }
  // Tied to another status: cast speed reads "… while in X", everything else
  // ", removed if the character hasn't [X]" (the sheet's majority wordings).
  const allCaps = params.effects.every(e => nameOf(ctx.conf.STATUS_AILMENTS_PARAM_EFFECT_TYPE, e.type) === 'INCREASE_DAMAGE_THRESHOLD_LV');
  const allCast = params.effects.every(e => nameOf(ctx.conf.STATUS_AILMENTS_PARAM_EFFECT_TYPE, e.type) === 'INCREASE_CAST_TIME_FACTOR');
  for (const { removedUnless } of durations.suffixes) {
    if (allCast) clauses[clauses.length - 1] = clauses[clauses.length - 1].replace(/%NOUN%\w+$/, '') + ` while in ${removedUnless}`;
    else clauses.push(`removed if the ${allCaps ? 'user' : 'character'} hasn't [${removedUnless}]`);
  }
  for (let i = 0; i < clauses.length; i++) clauses[i] = clauses[i].replace('%NOUN%', ' ');
  // Follow-ups on the same trigger merge: "Casts A and B after using a Support ability".
  for (let i = clauses.length - 1; i > 0; i--) {
    const a = /^Casts (.+?) (after using .+)$/.exec(clauses[i - 1]);
    const b = /^Casts (.+?) (after using .+)$/.exec(clauses[i]);
    if (a && b && a[2] === b[2]) clauses.splice(i - 1, 2, `Casts ${a[1]} and ${b[1]} ${a[2]}`);
  }
  // Later clauses continue the sentence: ", casts …".
  for (let i = 1; i < clauses.length; i++) clauses[i] = clauses[i].replace(/^Casts /, 'casts ');
  return { name: statusNameFor(params, ctx), effects: clauses.join(', '), defaultDuration: durations.duration };
}
