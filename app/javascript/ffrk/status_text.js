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

// One clause per effect type; each returns null when it can't phrase the effect.
const EFFECTS = {
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
    return null;
  },
  INCREASE_EXECUTED_DAMAGE: (e, ctx) => {
    if (e.damageFactor == null) return null;
    const cond = e.abilityCondition ?? {};
    if (cond.hasWeakness && Object.keys(cond).every(k => k === 'hasWeakness' || k === 'hasDamage')) {
      return `Increases damage dealt by ${percent(e.damageFactor)}% when exploiting elemental weaknesses`;
    }
    if (cond.isAbility) {
      const subject = conditionSubject(cond, ctx, 'or');
      return subject ? `${subject} abilities deal ${percent(e.damageFactor)}% more damage` : null;
    }
    return null;
  },
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
    const pct = e.damageFactor - 100;
    const when = t.suffix || t.timeSuffix;
    if (cond.hasWeakness) return `Weakness +${pct}% Boost${when}`;
    const elements = elementNames(cond, ctx);
    if (elements.length) return `${elements.join(', ')} Ability +${pct}% Boost${when}`;
    const categories = categoryNames(cond, ctx);
    return categories.length ? `${categories.join(', ')} +${pct}% Boost${when}` : null;
  },
  INCREASE_DAMAGE_THRESHOLD_LV: (e, ctx, t) => (e.abilityCondition ? null : `Damage Cap +${e.damageThresholdLv * 10000}${t.suffix}`),
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
  const allCast = params.effects.every(e => nameOf(ctx.conf.STATUS_AILMENTS_PARAM_EFFECT_TYPE, e.type) === 'INCREASE_CAST_TIME_FACTOR');
  for (const { removedUnless } of durations.suffixes) {
    if (allCast) clauses[clauses.length - 1] = clauses[clauses.length - 1].replace(/%NOUN%\w+$/, '') + ` while in ${removedUnless}`;
    else clauses.push(`removed if the character hasn't [${removedUnless}]`);
  }
  for (let i = 0; i < clauses.length; i++) clauses[i] = clauses[i].replace('%NOUN%', ' ');
  return { name: statusNameFor(params, ctx), effects: clauses.join(', '), defaultDuration: durations.duration };
}
