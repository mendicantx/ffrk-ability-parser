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
//   abilityNameFrom(id, source), // the Other-tab name of ability id listed under source
//   abilitySources(id),  // the Other-tab Sources ability id is listed under
//   abilityEffects(id),  // the Other-tab Effects of ability id
//   statusKey(id),       // status id → STATUS_AILMENTS_TYPE key
//   statusId(key),       // STATUS_AILMENTS_TYPE key → status id
//   selfKey,             // this status's STATUS_AILMENTS_TYPE key
//   statusParams(key),   // another status's game config
//   characterName(raw),  // coded name words ('FRIONIEL') → sheet character name ('Firion')
//   followUps(source),   // Other-tab ability names whose Source is source
//   followUpEffects(source), // the Effects of those Other-tab rows
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

// "[125% ATB 1]" from an Other-tab Effects cell that only grants statuses to the user
// ("Grants [125% ATB 1] to user."), else null.
function grantsToUser(effects) {
  const m = /^Grants ((?:\[[^\]]+\](?:, | and )?)+) to (?:the )?user\.?$/.exec(effects ?? '');
  return m ? m[1] : null;
}
const percent = factor => factor - 100;
// castTimeFactor at or above this is instant cast.
const INSTANT_CAST = 10000000;

// "after using a Fire ability" / "after using two Fire abilities" (the sheet writes "a"
// before vowels too).
const COUNT_WORDS = { 1: 'a', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight' };

// One clause per effect type; each returns null when it can't phrase the effect.
const EFFECTS = {
  // Follow-ups that cast one ability: "Casts Retsu after using two Wind abilities".
  // A follow-up whose Other-tab row only grants statuses to the user is described by
  // what it grants: "Grants [125% ATB 1] after using a Lightning ability".
  // executerCondition { isValidSaId } only limits the follow-up to while the user has
  // a status; the "removed if …" clause already says so.
  REGISTER_CHASE_ABILITY_WHEN_ABILITY_DONE: (e, ctx) => {
    const known = new Set(['key', 'type', 'chaseType', 'abilityCondition', 'abilityUseCountCondition', 'chaseAbilityId', 'chaseAbilityDoneCountForIsDone', 'executerCondition']);
    if (e.chaseAbilityId == null || Object.keys(e).some(k => !known.has(k))) return null;
    if (e.executerCondition && Object.keys(e.executerCondition).some(k => k !== 'isValidSaId')) return null;
    const uses = e.abilityUseCountCondition?.multiple ?? 1;
    if (Object.keys(e.abilityUseCountCondition ?? {}).some(k => k !== 'multiple') || !COUNT_WORDS[uses]) return null;
    const name = ctx.abilityName(e.chaseAbilityId);
    const subject = conditionSubject(e.abilityCondition, ctx, 'or');
    if (!name || !subject) return null;
    const limit = e.chaseAbilityDoneCountForIsDone;
    if (limit != null && !COUNT_WORDS[limit]) return null;
    const removed = limit != null ? `, removed after triggering ${limit === 1 ? 'once' : `${COUNT_WORDS[limit]} times`}` : '';
    const after = `after using ${COUNT_WORDS[uses]} ${subject} ${uses === 1 ? 'ability' : 'abilities'}${removed}`;
    const grants = grantsToUser(ctx.abilityEffects?.(e.chaseAbilityId));
    return grants ? `Grants ${grants} ${after}` : `Casts ${name} ${after}`;
  },
  // "Increase ATB charge speed by x2.00"
  INCREASE_ATB_TIME_FACTOR: e => (e.atbTimeFactor == null || e.abilityCondition ? null
    : `Increase ATB charge speed by x${e.atbTimeFactor >= INSTANT_CAST ? '9999999' : (e.atbTimeFactor / 100).toFixed(2)}`),
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
    // summationDamageFactor (Resonance) is the added percentage itself.
    const factor = e.damageFactor ?? e.maximumDamageFactor ?? (e.summationDamageFactor != null ? 100 + e.summationDamageFactor : null);
    if (factor == null || e.generalValueKey) return null;
    const cond = e.abilityCondition ?? {};
    if (cond.hasWeakness && Object.keys(cond).every(k => k === 'hasWeakness' || k === 'hasDamage')) {
      return `Increases damage dealt by ${percent(factor)}% when exploiting elemental weaknesses`;
    }
    if (cond.isAbility) {
      const subject = conditionSubject(cond, ctx, e.summationDamageFactor != null ? 'and' : 'or');
      return subject ? `${subject} abilities deal ${percent(factor)}% more damage` : null;
    }
    // Attacks of any kind: "Ranged attacks deal 30% more damage", "Fire, …, Dark and Poison attacks deal …"
    if (cond.isIndirectAttack && Object.keys(cond).every(k => ['isIndirectAttack', 'hasDamage'].includes(k))) {
      return `Ranged attacks deal ${percent(factor)}% more damage`;
    }
    if (cond.hasDamage && (cond.anyElementIds || cond.elementId) && Object.keys(cond).every(k => ['hasDamage', 'anyElementIds', 'elementId'].includes(k))) {
      const subject = conditionSubject(cond, ctx, 'and');
      return subject ? `${subject} attacks deal ${percent(factor)}% more damage` : null;
    }
    return null;
  },
  // "Ignores 50% of the target's DEF and RES"; "Fire abilities ignore 30% of the target's DEF and RES"
  DEF_AND_MDEF_PENETRATION: (e, ctx) => {
    if (e.penetrationFactorMapType == null) return null;
    if (!e.abilityCondition) return `Ignores ${e.penetrationFactorMapType}% of the target's DEF and RES`;
    const subject = conditionSubject(e.abilityCondition, ctx, 'or');
    return subject ? `${subject} abilities ignore ${e.penetrationFactorMapType}% of the target's DEF and RES` : null;
  },
  // "White Magic abilities restore 5% more HP"
  INCREASE_EXECUTED_HEAL: (e, ctx) => {
    const pct = e.summationDamageFactor ?? (e.damageFactor != null ? percent(e.damageFactor) : null);
    const cond = e.abilityCondition ?? {};
    const subject = cond.isAbility ? conditionSubject(Object.fromEntries(Object.entries(cond).filter(([k]) => k !== 'hasHeal')), ctx, 'or') : null;
    return pct != null && subject && !e.generalValueKey ? `${subject} abilities restore ${pct}% more HP` : null;
  },
  // "Critical chance =10%"
  INCREASE_CRITICAL_RATE: e => (e.rate == null || e.abilityCondition || e.generalValueKey ? null : `Critical chance =${e.rate}%`),
  // "Increases damage dealt by 5/10/15/20/25/30% at Dark Elemental Buff Level 1/2/3/4/5/6":
  // each step of the element's attack buff (10%, 20%, …) picks the next factor.
  INCREASE_EXECUTED_DAMAGE_BY_ELEMENT_ATK_ATTRIBUTE: (e, ctx) => {
    const elements = [].concat(e.elementIds ?? e.elementId ?? []).map(id => ctx.element(nameOf(ctx.conf.ELEMENT_TYPE, id)));
    if (!elements.length || !e.damageFactors?.length || Object.keys(e.abilityCondition ?? {}).some(k => k !== 'hasDamage')) return null;
    return `Increases damage dealt by ${e.damageFactors.map(percent).join('/')}% at ${joinList(elements, 'or')} Elemental Buff Level ${e.damageFactors.map((_, i) => i + 1).join('/')}`;
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
  // "200% ATB 1", "Instant ATB 2", "125% ATB (Synchro)", "200% ATB" (timed)
  INCREASE_ATB_TIME_FACTOR: (e, ctx, t) => (e.atbTimeFactor == null || e.abilityCondition ? null
    : `${e.atbTimeFactor >= INSTANT_CAST ? 'Instant' : `${e.atbTimeFactor}%`} ATB${t.suffix}`),
  // A Tactical follow-up that grants an ATB boost: "Lightning, Dark 125% ATB Quick Cycle (Tactical)"
  REGISTER_CHASE_ABILITY_WHEN_ABILITY_DONE: (e, ctx, t) => {
    const atb = /^\[((?:\d+%|Instant) ATB) \d+\]$/.exec(grantsToUser(ctx.abilityEffects?.(e.chaseAbilityId)) ?? '');
    const elements = elementNames(e.abilityCondition, ctx);
    return t.tactical && atb && elements.length ? `${elements.join(', ')} ${atb[1]} Quick Cycle (Tactical)` : null;
  },
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
    // Resonance: "Fire Resonance +5% Boost" (no duration in the name)
    if (e.summationDamageFactor != null) {
      const list = [...elementNames(cond, ctx), ...categoryNames(cond, ctx)];
      const what = list.length > 1 ? `(${list.join('/')})` : list[0];
      return what ? `${what} Resonance +${e.summationDamageFactor}% Boost` : null;
    }
    const pct = (e.damageFactor ?? e.maximumDamageFactor) - 100;
    const when = t.suffix || t.timeSuffix;
    if (cond.hasWeakness) return `Weakness +${pct}% Boost${when}`;
    if (cond.isIndirectAttack) return `Ranged +${pct}% Boost${when}`;
    const elements = elementNames(cond, ctx);
    if (!cond.isAbility && elements.length === ALL_ELEMENTS) return `Prismatic +${pct}% Boost${when}`;
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
  // "Dancer Healing Resonance +5% Boost"
  INCREASE_EXECUTED_HEAL: (e, ctx) => {
    const what = [...elementNames(e.abilityCondition, ctx), ...categoryNames(e.abilityCondition, ctx)].join(', ');
    return e.summationDamageFactor != null && what ? `${what} Healing Resonance +${e.summationDamageFactor}% Boost` : null;
  },
  // "10% Critical 3"
  INCREASE_CRITICAL_RATE: (e, ctx, t) => (e.rate == null || e.abilityCondition ? null : `${e.rate}% Critical${t.suffix || t.timeSuffix}`),
  // "Dark Buff Damage Boost (15s)", "Holy, Water Buff Damage Boost (15s)"
  INCREASE_EXECUTED_DAMAGE_BY_ELEMENT_ATK_ATTRIBUTE: (e, ctx, t) => {
    const elements = [].concat(e.elementIds ?? e.elementId ?? []).map(id => ctx.element(nameOf(ctx.conf.ELEMENT_TYPE, id)));
    return elements.length ? `${elements.join(', ')} Buff Damage Boost${t.suffix || t.timeSuffix}` : null;
  },
  // "Fire, Lightning, Earth Ability DEF and RES 30% Piercing (Tactical)"
  DEF_AND_MDEF_PENETRATION: (e, ctx, t) => {
    if (!e.abilityCondition) return `DEF and RES ${e.penetrationFactorMapType}% Piercing${t.suffix || t.timeSuffix}`;
    const elements = elementNames(e.abilityCondition, ctx);
    const what = elements.length === ALL_ELEMENTS ? 'Prismatic' : elements.join(', ');
    return elements.length ? `${what} Ability DEF and RES ${e.penetrationFactorMapType}% Piercing${t.suffix || t.timeSuffix}` : null;
  },
};

// The turn count shared by effects that end the status when used up (countForIsDone).
function effectTurns(effects) {
  const counts = [...new Set((effects ?? []).map(e => e.countForIsDone))];
  return counts.length === 1 && counts[0] != null ? counts[0] : null;
}

function statusNameFor(params, ctx) {
  if (params.effects.length !== 1) return null;
  const allDone = (params.durations ?? []).some(d => nameOf(ctx.conf.STATUS_AILMENTS_PARAM_DURATION_TYPE, d.type) === 'UNSET_WHEN_ALL_EFFECTS_ARE_DONE');
  const turn = (params.durations ?? []).find(d => nameOf(ctx.conf.STATUS_AILMENTS_PARAM_DURATION_TYPE, d.type) === 'TURN')?.turn
    ?? (allDone ? effectTurns(params.effects) : null);
  const synchro = (params.durations ?? []).some(d => d.saId != null && ctx.statusKey?.(d.saId) === 'SYNCHRO_MODE');
  const time = (params.durations ?? []).find(d => nameOf(ctx.conf.STATUS_AILMENTS_PARAM_DURATION_TYPE, d.type) === 'TIME')?.time;
  const tactical = (params.durations ?? []).some(d => d.saId != null && ctx.statusKey?.(d.saId) === 'TACTICAL_AWAKE_MODE');
  const seconds = time ? time / 1000 : null;
  const timing = { suffix: turn ? ` ${turn}` : tactical ? ' (Tactical)' : synchro ? ' (Synchro)' : '', seconds, timeSuffix: seconds ? ` (${seconds}s)` : '', tactical };
  const e = params.effects[0];
  return NAMES[nameOf(ctx.conf.STATUS_AILMENTS_PARAM_EFFECT_TYPE, e.type)]?.(e, ctx, timing) ?? null;
}

// Modes whose statuses the sheet ends with "removed if the user hasn't [X]" (every row for
// Crystal Force, Extra and Master Mode). Other modes say "character"; Tactical depends on the text.
const USER_REMOVAL_MODES = new Set(['Crystal Force Mode', 'Extra Mode', 'Master Mode']);

// The status's Default Duration and any ", removed if …" suffix.
function describeDurations(durations, ctx, effects = []) {
  let duration = '-';
  const suffixes = [];
  for (const d of durations ?? []) {
    const type = nameOf(ctx.conf.STATUS_AILMENTS_PARAM_DURATION_TYPE, d.type);
    if (type === 'TURN' && d.turn != null) duration = plural(d.turn, 'turn');
    else if (type === 'UNSET_WHEN_ALL_EFFECTS_ARE_DONE') {
      // Ends when its effects are used up: "200% ATB 1" lasts 1 turn.
      const turns = effectTurns(effects);
      if (turns == null) return null;
      duration = plural(turns, 'turn');
    }
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

// ─── Mode families ────────────────────────────────────────────────────────────
// Modes bundle several effects that the sheet describes as one sentence. Each family
// is recognised by its effects and composed in the sheet's own wording.

const effectName = (e, ctx) => nameOf(ctx.conf.STATUS_AILMENTS_PARAM_EFFECT_TYPE, e.type);
const ELEMENT_KEYS = ['FIRE', 'ICE', 'LIGHTNING', 'EARTH', 'WIND', 'WATER', 'HOLY', 'DARK', 'POISON'];

// "MASTER_BUDDY_MODE_VIVI_ICE_LIGHTNING" → { character: 'Vivi', elements: ['Ice', 'Lightning'] }
// A second mode for the same character ends in a roman numeral: "RINOA_II" → 'Rinoa II'.
function modeOwner(key, prefix, ctx) {
  // KOKI marks a second version of a character's mode; the sheet doesn't show it.
  const words = key.slice(prefix.length).split('_').filter(w => w !== 'KOKI');
  const numeral = words.length > 1 && /^(II|III|IV)$/.test(words[words.length - 1]) ? ` ${words.pop()}` : '';
  const elements = [];
  while (words.length > 1 && ELEMENT_KEYS.includes(words[words.length - 1])) elements.unshift(ctx.element(words.pop()));
  return { character: ctx.characterName(words.join('_')) + numeral, elements };
}

// Master Mode: <character> — "Casts [Star Strike: X] every 2s (max 5), grants Damage Cap
// +20000/…/+70000 after 0/…/5 chases, casts [North Star: …] after 15s, removed if user
// hasn't Master Mode". Instant cast, SB cost and Hero Boost belong to the base
// [Master Mode] status's row, so they're left out here as in the sheet.
const MASTER_EFFECTS = new Set(['COUNT_ABILITY_DONE', 'REGISTER_CHASE_ABILITY_WHEN_AFTER_TIME_EXCEED', 'INCREASE_DAMAGE_THRESHOLD_LV',
  'INCREASE_CAST_TIME_FACTOR', 'REDUCE_CONSUME_POINT', 'IS_DONE_EFFECTS_WHEN_SPECIFIC_EFFECT_KEYS', 'BUDDY_ENHANCE',
  'REGISTER_CHASE_ABILITY_WHEN_EXISTS_CONDITIONAL_ACTOR']);

// "if any enemy gains a DEF/RES/MND buff" / "if the user gains an ATK/DEF/MAG/RES debuff",
// from a follow-up's condition on stat buffs or debuffs (PARAM_ID_OF ids).
function statChangeCondition(e, ctx) {
  const enemies = e.targetActorCondition?.all?.isEnemy ? e.targetActorCondition.all : null;
  const cond = enemies?.upParamsNum ? { who: 'any enemy', kind: 'buff', ids: enemies.upParamsNum.paramIds }
    : e.executerCondition?.downParamsNum ? { who: 'the user', kind: 'debuff', ids: e.executerCondition.downParamsNum.paramIds } : null;
  if (!cond) return null;
  const stats = cond.ids.map(id => STAT_NAMES[nameOf(ctx.conf.PARAM_ID_OF, id)]);
  if (stats.some(s => !s)) return null;
  return `if ${cond.who} gains ${/^[AEIOU]/.test(stats[0]) ? 'an' : 'a'} ${stats.join('/')} ${cond.kind}`;
}

function describeMasterMode(params, ctx) {
  const prefix = 'MASTER_BUDDY_MODE_';
  if (!ctx.selfKey?.startsWith(prefix) || !params.effects.every(e => MASTER_EFFECTS.has(effectName(e, ctx)))) return null;
  const chase = params.effects.find(e => effectName(e, ctx) === 'REGISTER_CHASE_ABILITY_WHEN_AFTER_TIME_EXCEED');
  const cap = params.effects.find(e => effectName(e, ctx) === 'INCREASE_DAMAGE_THRESHOLD_LV' && e.generalValueToDamageThresholdLvMap);
  // A flat cap (no per-chase steps) is left out, as in most sheet rows (8 of 15).
  if (!chase || chase.time == null || chase.chaseAbilityDoneCountForIsDone == null) return null;

  const { character, elements } = modeOwner(ctx.selfKey, prefix, ctx);
  const name = `Master Mode: ${character}${elements.length ? ` (${elements.join(', ')})` : ''}`;
  // One Star Strike can serve several modes; prefer the Other row listed under this mode.
  const chaseName = ctx.abilityNameFrom?.(chase.chaseAbilityId, name) ?? ctx.abilityName(chase.chaseAbilityId);
  const clauses = [`Casts [${chaseName}] every ${chase.time / 1000}s (max ${chase.chaseAbilityDoneCountForIsDone})`];
  // Not every Master Mode raises the damage cap as its chases land.
  if (cap) {
    const steps = cap.generalValueToDamageThresholdLvMap.map(m => [m.numberCondition.greaterEqual, m.damageThresholdLv]).sort((a, b) => a[0] - b[0]);
    clauses.push(`grants Damage Cap ${steps.map(([, lv]) => `+${lv * 10000}`).join('/')} after ${steps.map(([n]) => n).join('/')} chases`);
  }
  // The closing follow-up isn't part of this status: it's the soul break's, listed on the
  // Other tab under this mode, and cast when the base Master Mode's timer runs out.
  const northStar = ctx.followUps(name).find(n => /^North Star: /.test(n));
  const baseTimer = ctx.statusParams('MASTER_BUDDY_MODE')?.effects?.find(e => effectName(e, ctx) === 'REGISTER_CHASE_ABILITY_WHEN_AFTER_TIME_EXCEED');
  if (northStar && baseTimer?.time) clauses.push(`casts [${northStar}] after ${baseTimer.time / 1000}s`);
  // "casts Auto Revenge if any enemy gains a DEF/RES/MND buff"
  for (const e of params.effects.filter(x => effectName(x, ctx) === 'REGISTER_CHASE_ABILITY_WHEN_EXISTS_CONDITIONAL_ACTOR')) {
    const when = statChangeCondition(e, ctx);
    if (!when) return null;
    clauses.push(`casts ${ctx.abilityNameFrom?.(e.chaseAbilityId, name) ?? ctx.abilityName(e.chaseAbilityId)} ${when}`);
  }
  clauses.push("removed if user hasn't Master Mode");
  return { name, effects: clauses.join(', '), defaultDuration: '-' };
}

// Zenith Mode: <character> — "Increases [Fire/Earth Infusion] damage bonus by 20%, cast
// speed x1.10 for PHY attacks, Fire or Earth abilities trigger 1 additional time, casts
// Spirit Attack: Rain after using three Fire or Earth abilities (max 1), maximum HP +1500,
// grants [Astra] after taking the next action, removed if the character hasn't [Zenith
// Mode]". Clauses go in the sheet's most common order, whatever the effects' order.
const ZENITH_CAST_SUBJECTS = {
  physicalDamageAbilities: 'PHY attacks',
  magicDamageAbilities: 'BLK, WHT, BLU, SUM or NAT attacks that deal magical damage',
};
const ZENITH_CLAUSES = {
  ATTACH_ELEMENT_KIWAMI: (e, ctx) => {
    const elements = conditionSubject({ anyElementIds: e.attachElementIds }, ctx, '/');
    return elements && e.additionalFactor != null
      ? ['infusion', `Increases [${elements} Infusion] damage bonus by ${e.additionalFactor}%`] : null;
  },
  INCREASE_CAST_TIME_FACTOR: (e, ctx) => {
    const instant = e.castTimeFactor >= INSTANT_CAST;
    const conds = [].concat(e.condName ?? e.anyCondName ?? []);
    let subject;
    if (!e.abilityCondition && !conds.length) subject = '';
    else if (conds.length) subject = conds.every(c => ZENITH_CAST_SUBJECTS[c]) ? conds.map(c => ZENITH_CAST_SUBJECTS[c]).join(' and ') : null;
    else if (e.abilityCondition?.isFlightAttack && Object.keys(e.abilityCondition).length === 1) subject = 'Jump attacks';
    else subject = conditionSubject(e.abilityCondition, ctx, 'or') && `${conditionSubject(e.abilityCondition, ctx, 'or')} abilities`;
    if (subject == null || subject === false) return null;
    const forWhat = subject ? ` for ${subject}` : '';
    if (!instant) return ['cast', `cast speed x${(e.castTimeFactor / 100).toFixed(2)}${forWhat}`];
    return ['instant', `instant cast speed${forWhat}${e.turnCountForIsDone ? ` (max ${plural(e.turnCountForIsDone, 'turn')})` : ''}`];
  },
  REGISTER_SEQ_ABILITY_WHEN_ABILITY_DONE: (e, ctx) => {
    const subject = conditionSubject(e.abilityCondition, ctx, 'or');
    const repeat = e.repeatNum ?? 1;
    return subject ? ['seq', `${subject} abilities trigger ${repeat} additional time${repeat === 1 ? '' : 's'}`] : null;
  },
  REGISTER_CHASE_ABILITY_WHEN_ABILITY_DONE: (e, ctx) => zenithChase(e, ctx, false),
  REGISTER_CHASE_ABILITY_WHEN_ABILITY_DONE_REACT_ALL_ACTOR: (e, ctx) => zenithChase(e, ctx, true),
  INCREASE_STATUS: e => (e.statusParams?.length === 1 && e.statusParams[0].name === 'maxHp'
    ? ['hp', `maximum HP +${e.statusParams[0].boostValue}`] : null),
  INFLICT_SA_AT_NEXT_ACTION: (e, ctx) => {
    const names = (e.saIds ?? []).map(id => ctx.statusName(id));
    return names.length && names.every(Boolean) && (e.actionRequiredNum ?? 1) === 1
      ? ['astra', `grants ${names.map(n => `[${n}]`).join(', ')} after taking the next action`] : null;
  },
  // Highlights the ability panels in the UI only; the sheet doesn't mention it.
  NORMAL_PANEL_HIGHLIGHT: () => ['none', ''],
};
const ZENITH_ORDER = ['infusion', 'cast', 'instant', 'seq', 'chase', 'hone', 'hp', 'astra'];

// "casts Spirit Attack: Rain after using three Fire or Earth abilities (max 1)", or
// "… after another ally uses a Lightning ability (max 4)" when allies' abilities count.
function zenithChase(e, ctx, byAllies) {
  if (e.chaseAbilityId == null) return null;
  if (byAllies && (e.isAbilityOwner !== false || !e.targetActorCondition?.all?.isBuddy)) return null;
  const uses = e.abilityUseCountCondition?.multiple ?? 1;
  const subject = conditionSubject(e.abilityCondition, ctx, 'or');
  if (!subject || !COUNT_WORDS[uses]) return null;
  const what = `${COUNT_WORDS[uses]} ${subject} ${uses === 1 ? 'ability' : 'abilities'}`;
  const when = byAllies ? `after another ally uses ${what}` : `after using ${what}`;
  const max = e.chaseAbilityDoneCountForIsDone != null ? ` (max ${e.chaseAbilityDoneCountForIsDone})` : '';
  return ['chase', `casts ${ctx.abilityName(e.chaseAbilityId)} ${when}${max}`];
}

function describeZenithMode(params, ctx) {
  const prefix = 'ULTIMATE_BUDDY_MODE_';
  if (!ctx.selfKey?.startsWith(prefix)) return null;
  const clauses = [];
  for (const e of params.effects) {
    const clause = ZENITH_CLAUSES[effectName(e, ctx)]?.(e, ctx);
    if (!clause) return null;
    if (clause[0] !== 'none') clauses.push(clause);
  }
  // Hero Abilities a Zenith swaps in are Kiwami panels, which never use up charges
  // (AbilityPanel.isNoConsumption in battle.js). The owner wants it on every Zenith.
  clauses.push(['hone', 'Hero Abilities have zero hone cost']);
  const durations = describeDurations(params.durations, ctx);
  if (!durations) return null;
  const ordered = ZENITH_ORDER.flatMap(kind => clauses.filter(c => c[0] === kind).map(c => c[1]));
  for (const { removedUnless } of durations.suffixes) ordered.push(`removed if the character hasn't [${removedUnless}]`);
  ordered[0] = ordered[0].charAt(0).toUpperCase() + ordered[0].slice(1);

  // The Spirit Attack's Other-tab Source is the mode's sheet name ("Zenith Mode: Ace (Fire)").
  const chase = params.effects.find(e => e.chaseAbilityId != null);
  const listed = chase && (ctx.abilitySources?.(chase.chaseAbilityId) ?? []).find(s => s.startsWith('Zenith Mode: '));
  const { character, elements } = modeOwner(ctx.selfKey, prefix, ctx);
  const name = listed ?? `Zenith Mode: ${character}${elements.length ? ` (${elements.join(', ')})` : ''}`;
  return { name, effects: ordered.join(', '), defaultDuration: durations.duration };
}

// Soul Drive Mode: <character> — "Reduces the SB points cost for Soul Breaks by 250, instant
// cast speed for Soul Breaks, increases the damage/healing cap by 10000 for Soul Breaks,
// Soul Breaks deal 50% more damage, grants [Instant ATB 1] after using a Soul Break,
// removed after triggering, removed if the character hasn't [Soul Drive Mode]".
// What the Soul Break use grants isn't in this status: the base [Soul Drive Mode] casts
// the soul break's own follow-up (its arg2), which battle.js doesn't link to the mode.
// It comes from the Other-tab row listed under this mode, or is the usual placeholder.
const isSoulBreakOnly = cond => cond?.isSoulStrike === true && cond.isAbility === false && cond.isLimitBreak === false;
const SOUL_DRIVE_CLAUSES = {
  REDUCE_CONSUME_POINT: e => (isSoulBreakOnly(e.abilityCondition) && e.reduceConsumePoint
    ? `Reduces the SB points cost for Soul Breaks by ${e.reduceConsumePoint}` : null),
  INCREASE_CAST_TIME_FACTOR: e => (isSoulBreakOnly(e.abilityCondition) && e.castTimeFactor >= INSTANT_CAST
    ? 'instant cast speed for Soul Breaks' : null),
  INCREASE_DAMAGE_THRESHOLD_LV: e => (isSoulBreakOnly(e.abilityCondition)
    ? `increases the damage/healing cap by ${e.damageThresholdLv * 10000} for Soul Breaks` : null),
  INCREASE_EXECUTED_DAMAGE: e => (isSoulBreakOnly(e.abilityCondition) && e.damageFactor
    ? `Soul Breaks deal ${percent(e.damageFactor)}% more damage` : null),
};

function describeSoulDriveMode(params, ctx) {
  if (!/^LIMIT_BREAK_SOUL_DRIVE_(?!MODE$)/.test(ctx.selfKey ?? '')) return null;
  const clauses = [];
  for (const e of params.effects) {
    const clause = SOUL_DRIVE_CLAUSES[effectName(e, ctx)]?.(e, ctx);
    if (!clause) return null;
    clauses.push(clause);
  }
  const durations = describeDurations(params.durations, ctx);
  if (!durations || durations.suffixes.length !== 1) return null;

  const prefix = /^LIMIT_BREAK_SOUL_DRIVE_MODE_/.test(ctx.selfKey) ? 'LIMIT_BREAK_SOUL_DRIVE_MODE_' : 'LIMIT_BREAK_SOUL_DRIVE_';
  const { character, elements } = modeOwner(ctx.selfKey, prefix, ctx);
  const name = `Soul Drive Mode: ${character}${elements.length ? ` (${elements.join(', ')})` : ''}`;
  // "Grants [X] and [Y] to all XI allies" → "grants [X] and [Y] to all XI allies after using a Soul Break"
  const listed = ctx.followUpEffects?.(name)?.find(t => /^Grants /.test(t));
  // Not listed: the standard mode (with the cap and damage boosts) grants [Instant ATB 1] in
  // 102 of 107 sheet rows, so it's assumed (owner decision); plain modes vary too much.
  const standard = params.effects.some(e => effectName(e, ctx) === 'INCREASE_EXECUTED_DAMAGE');
  const instantAtb = ctx.statusName(ctx.statusId?.('INCREASE_ATB_TIME_FACTOR_MAX_TURN_1'));
  clauses.push(listed ? `${listed.replace(/^Grants /, 'grants ').replace(/\.$/, '')} after using a Soul Break`
    : standard && instantAtb ? `grants [${instantAtb}] after using a Soul Break`
    : 'casts <ability missing from Other Tab> after using a Soul Break');
  clauses.push('removed after triggering', `removed if the character hasn't [${durations.suffixes[0].removedUnless}]`);
  return { name, effects: clauses.join(', '), defaultDuration: durations.duration };
}

// Dual Awoken <subject> Mode I/II (<character>) — "Sharpshooter abilities deal 5/10/15/20/30%
// more damage at ability rank 1/2/3/4/5, Sharpshooter abilities trigger 2 additional times,
// cast speed x2.00/x2.50/x3.00 and critical chance =50%/75%/100% for equipped Sharpshooter
// abilities after casting 1/2/3+ Sharpshooter abilities". Clauses go in the sheet's most
// common order.
const DUAL_AWAKE_ORDER = ['cap', 'rank', 'seq', 'cast', 'tiers', 'damage', 'crit', 'chase', 'onRemove'];
const tierValues = (map, field, fmt) => [...map].sort((a, b) => a.numberCondition.greaterEqual - b.numberCondition.greaterEqual).map(m => fmt(m[field]));
const tierCounts = map => {
  const counts = [...map].map(m => m.numberCondition.greaterEqual).sort((a, b) => a - b);
  return counts.map((n, k) => (k === counts.length - 1 ? `${n}+` : `${n}`)).join('/');
};
// "Ice and Water abilities": the sheet joins subjects with "and" (79 rows vs 76 with slashes).
const dualSubject = (cond, ctx) => {
  if (!cond) return '';
  const ids = [].concat(cond.elementId ?? cond.anyElementIds ?? []);
  // Elements keep the game's order ("Dark and Fire"), as most Dual Awoken sheet rows do.
  if (ids.length > 1 && Object.keys(cond).every(k => ['elementId', 'anyElementIds', 'isAbility', 'hasDamage'].includes(k))) {
    return joinList(ids.map(id => ctx.element(nameOf(ctx.conf.ELEMENT_TYPE, id))), 'and');
  }
  return conditionSubject(cond, ctx, 'and');
};
const DUAL_AWAKE_CLAUSES = {
  DUAL_AWAKE_MODE_FIRST: () => ['none'],
  DUAL_AWAKE_MODE_SECOND: () => ['none'],
  COUNT_ABILITY_USED: () => ['none'],   // read by the tiered effects below
  INCREASE_DAMAGE_THRESHOLD_LV: e => (e.abilityCondition ? null : ['cap', `Increases the damage/healing cap by ${e.damageThresholdLv * 10000}`]),
  ABILITY_BOOST: (e, ctx) => {
    const subject = dualSubject(e.abilityCondition, ctx);
    return subject && e.damageFactorMapType === 1
      ? ['rank', `${subject} abilities deal 5/10/15/20/30% more damage at ability rank 1/2/3/4/5`] : null;
  },
  REGISTER_SEQ_ABILITY_WHEN_ABILITY_DONE: (e, ctx) => {
    if (e.repeatNum === 0) return ['none'];
    const subject = dualSubject(e.abilityCondition, ctx);
    const n = e.repeatNum ?? 1;
    return subject ? ['seq', `${subject} abilities trigger ${n} additional time${n === 1 ? '' : 's'}`] : null;
  },
  INCREASE_CAST_TIME_FACTOR: (e, ctx) => {
    if (e.generalValueToCastTimeFactorMap) return ['tierCast', tierValues(e.generalValueToCastTimeFactorMap, 'castTimeFactor', f => `x${(f / 100).toFixed(2)}`).join('/')];
    if (e.castTimeFactor == null) return null;
    const subject = e.abilityCondition ? dualSubject(e.abilityCondition, ctx) : '';
    if (subject == null) return null;
    // "for X abilities": the sheet's Mode I rows split 30/30 with "for equipped X
    // abilities", and Mode II rows use the plain form.
    const what = subject ? ` for ${subject} abilities` : '';
    return ['cast', e.castTimeFactor >= INSTANT_CAST ? `instant cast speed${what}` : `cast speed x${(e.castTimeFactor / 100).toFixed(2)}${what}`];
  },
  INCREASE_CRITICAL_RATE: e => (e.generalValueToCriticalRateMap
    ? ['tierCrit', tierValues(e.generalValueToCriticalRateMap, 'rate', r => `${r}%`).join('/')]
    : e.rate != null && !e.abilityCondition && !e.generalValueKey ? ['crit', `critical chance =${e.rate}%`] : null),
  INCREASE_EXECUTED_DAMAGE: (e, ctx) => {
    const subject = dualSubject(e.abilityCondition, ctx);
    if (!subject) return null;
    if (e.generalValueToAbilityDamageRateMap) {
      const map = e.generalValueToAbilityDamageRateMap;
      if (!map.every(m => m.damageFactor != null)) return null;
      return ['damage', `${subject} abilities deal ${tierValues(map, 'damageFactor', f => `${percent(f)}%`).join('/')} more damage after casting ${tierCounts(map)} ${subject} abilities`];
    }
    return e.damageFactor ? ['damage', `${subject} abilities deal ${percent(e.damageFactor)}% more damage`] : null;
  },
  // "casts Dual Arrow Force after using Sharpshooter abilities", or "after using two Ice
  // abilities" when it takes several uses.
  REGISTER_CHASE_ABILITY_WHEN_ABILITY_DONE: (e, ctx) => {
    const subject = dualSubject(e.abilityCondition, ctx);
    const uses = e.abilityUseCountCondition?.multiple ?? 1;
    if (!e.chaseAbilityId || !subject || e.generalValueKey || !COUNT_WORDS[uses]) return null;
    const after = uses === 1 ? `${subject} abilities` : `${COUNT_WORDS[uses]} ${subject} abilities`;
    return ['chase', `casts ${ctx.abilityName(e.chaseAbilityId)} after using ${after}`];
  },
  REGISTER_ABILITY_WHEN_UNSET_SA: (e, ctx) => (e.abilityId ? ['onRemove', `casts ${ctx.abilityName(e.abilityId)} when removed`] : null),
};

// The sheet name, from the Other-tab Source of the mode's chase ("Dual Awoken Sharpshooter
// Mode II (Trey)"). Mode I has no chase of its own, so it borrows its Mode II partner's.
function dualAwakeName(params, ctx, roman) {
  const fromChases = p => p?.effects.map(e => e.chaseAbilityId ?? e.abilityId).filter(Boolean)
    .flatMap(id => ctx.abilitySources?.(id) ?? []).find(s => /^Dual Awoken .* Mode II? \(/.test(s));
  const own = fromChases(params);
  if (own) return own.replace(/ Mode II? \(/, ` Mode ${roman} (`);
  const partner = ctx.selfKey.replace(/^DUAL_AWAKE_MODE_FIRST_/, 'DUAL_AWAKE_MODE_SECOND_');
  const fromPartner = partner !== ctx.selfKey && fromChases(ctx.statusParams(partner));
  if (fromPartner) return fromPartner.replace(/ Mode II? \(/, ` Mode ${roman} (`);
  // Not on the Other tab: "DUAL_AWAKE_MODE_FIRST_BIGGS_EARTH" → "Dual Awoken Earth Mode I (Biggs)".
  const words = ctx.selfKey.replace(/^DUAL_AWAKE_MODE_(FIRST|SECOND)_/, '').split('_');
  // A character's second Dual Awoken soul break ends in II: "(Fang v2)", the sheet's usual form.
  const version = { II: ' v2', III: ' v3' }[words[words.length - 1]] ?? '';
  if (version) words.pop();
  const last = words[words.length - 1];
  const subject = ELEMENT_KEYS.includes(last) ? ctx.element(last)
    : ctx.conf.ABILITY_CATEGORY_ID?.[last] != null ? ctx.category(last) : null;
  if (!subject || words.length < 2) return null;
  return `Dual Awoken ${subject} Mode ${roman} (${ctx.characterName(words.slice(0, -1).join('_'))}${version})`;
}

function describeDualAwakeMode(params, ctx) {
  const m = /^DUAL_AWAKE_MODE_(FIRST|SECOND)_/.exec(ctx.selfKey ?? '');
  if (!m) return null;
  const roman = m[1] === 'FIRST' ? 'I' : 'II';
  const found = [];
  for (const e of params.effects) {
    const clause = DUAL_AWAKE_CLAUSES[effectName(e, ctx)]?.(e, ctx);
    if (!clause) return null;
    if (clause[0] !== 'none') found.push(clause);
  }
  // Use-count tiers: "cast speed x2.00/x2.50/x3.00 and critical chance =50%/75%/100% for
  // equipped Sharpshooter abilities after casting 1/2/3+ Sharpshooter abilities"
  const tierCast = found.find(c => c[0] === 'tierCast'), tierCrit = found.find(c => c[0] === 'tierCrit');
  if (tierCast || tierCrit) {
    const counted = params.effects.find(e => effectName(e, ctx) === 'COUNT_ABILITY_USED');
    const mapOf = params.effects.find(e => e.generalValueToCastTimeFactorMap ?? e.generalValueToCriticalRateMap);
    const subject = counted && dualSubject(counted.abilityCondition, ctx);
    if (!subject) return null;
    const parts = [tierCast && `cast speed ${tierCast[1]}`, tierCrit && `critical chance =${tierCrit[1]}`].filter(Boolean);
    const map = mapOf.generalValueToCastTimeFactorMap ?? mapOf.generalValueToCriticalRateMap;
    found.push(['tiers', `${parts.join(' and ')} for equipped ${subject} abilities after casting ${tierCounts(map)} ${subject} abilities`]);
  }
  const clauses = DUAL_AWAKE_ORDER.flatMap(kind => found.filter(c => c[0] === kind).map(c => c[1]));
  if (!clauses.length) return null;
  clauses[0] = clauses[0].charAt(0).toUpperCase() + clauses[0].slice(1);

  // Mode I lasts 15 seconds. Mode II lasts as long as its soul break's Dual Shift pattern
  // (arg4: [3,3,2,1,0] or [1] turns), which the status doesn't know; "1 turn" is the
  // sheet's most common.
  const time = (params.durations ?? []).find(d => nameOf(ctx.conf.STATUS_AILMENTS_PARAM_DURATION_TYPE, d.type) === 'TIME')?.time;
  const defaultDuration = time ? plural(time / 1000, 'second') : roman === 'II' ? '1 turn' : '-';
  return { name: dualAwakeName(params, ctx, roman), effects: clauses.join(', '), defaultDuration };
}

// Awoken <subject> — "Sharpshooter abilities don't consume uses and deal 5/10/15/20/30%
// more damage at ability rank 1/2/3/4/5, Sharpshooter abilities trigger 1 additional
// time" for 15 seconds. The name comes from the Other-tab Source of the mode's chase
// ("Awoken Savior"), else from the coded name ("Awoken Fire", "Awoken Sharpshooter").
const RANK_BOOST = 'deal 5/10/15/20/30% more damage at ability rank 1/2/3/4/5';
const AWAKE_CLAUSES = {
  AWAKE_MODE: () => ['none'],
  INFINITY_ABILITY_NUM: (e, ctx) => dualSubject(e.abilityCondition, ctx) && ['infinity', dualSubject(e.abilityCondition, ctx)],
  ABILITY_BOOST: (e, ctx) => (e.damageFactorMapType === 1 && dualSubject(e.abilityCondition, ctx) ? ['boost', dualSubject(e.abilityCondition, ctx)] : null),
  INCREASE_CAST_TIME_FACTOR: (e, ctx) => {
    const cond = e.abilityCondition ?? {};
    if (cond.isFlightAttack && e.castTimeFactor >= INSTANT_CAST) return ['cast', 'instant cast speed for Jump attacks'];
    const subject = dualSubject(cond, ctx);
    if (!subject) return null;
    if (e.gradeToCastTimeFactorMapType === 1) return ['cast', `cast speed x2.00/2.25/2.50/2.75/3.00 for ${subject} abilities at ability rank 1/2/3/4/5`];
    if (e.castTimeFactor == null) return null;
    return ['cast', e.castTimeFactor >= INSTANT_CAST ? `instant cast speed for ${subject} abilities` : `cast speed x${(e.castTimeFactor / 100).toFixed(2)} for ${subject} abilities`];
  },
  REGISTER_SEQ_ABILITY_WHEN_ABILITY_DONE: (e, ctx) => {
    const subject = dualSubject(e.abilityCondition, ctx);
    const n = e.repeatNum ?? 1;
    return subject ? ['seq', `${subject} abilities trigger ${n} additional time${n === 1 ? '' : 's'}`] : null;
  },
  REGISTER_CHASE_ABILITY_WHEN_ABILITY_DONE: (e, ctx) => {
    const subject = dualSubject(e.abilityCondition, ctx);
    if (!e.chaseAbilityId || !subject) return null;
    // "after using two Summoning or Bard abilities" when it takes several uses.
    const uses = e.abilityUseCountCondition?.multiple ?? 1;
    if (!COUNT_WORDS[uses]) return null;
    const after = uses > 1 ? `after using ${COUNT_WORDS[uses]} ${conditionSubject(e.abilityCondition, ctx, 'or')} abilities` : `after using ${subject} abilities`;
    const grants = grantsToUser(ctx.abilityEffects?.(e.chaseAbilityId));
    return ['chase', grants ? `grants ${grants} ${after}` : `casts ${ctx.abilityName(e.chaseAbilityId)} ${after}`];
  },
};

function describeAwakeMode(params, ctx) {
  if (!/^AWAKE_MODE_/.test(ctx.selfKey ?? '')) return null;
  const found = [];
  for (const e of params.effects) {
    const clause = AWAKE_CLAUSES[effectName(e, ctx)]?.(e, ctx);
    if (!clause) return null;
    if (clause[0] !== 'none') found.push(clause);
  }
  const infinity = found.find(c => c[0] === 'infinity'), boost = found.find(c => c[0] === 'boost');
  const clauses = [];
  if (infinity && boost && infinity[1] === boost[1]) clauses.push(`${infinity[1]} abilities don't consume uses and ${RANK_BOOST}`);
  else {
    if (infinity) clauses.push(`${infinity[1]} abilities don't consume uses`);
    if (boost) clauses.push(`${boost[1]} abilities ${RANK_BOOST}`);
  }
  for (const kind of ['cast', 'seq', 'chase']) clauses.push(...found.filter(c => c[0] === kind).map(c => c[1]));
  if (!clauses.length) return null;
  clauses[0] = clauses[0].charAt(0).toUpperCase() + clauses[0].slice(1);
  const durations = describeDurations(params.durations, ctx, params.effects);
  if (!durations || durations.suffixes.length) return null;

  const chase = params.effects.find(e => e.chaseAbilityId != null);
  const listed = chase && (ctx.abilitySources?.(chase.chaseAbilityId) ?? []).find(s => /^Awoken /.test(s));
  const words = ctx.selfKey.replace(/^AWAKE_MODE_/, '');
  const subject = ELEMENT_KEYS.includes(words) ? ctx.element(words)
    : ctx.conf.ABILITY_CATEGORY_ID?.[words] != null ? ctx.category(words) : titleCaseKey(words);
  return { name: listed ?? `Awoken ${subject}`, effects: clauses.join(', '), defaultDuration: durations.duration };
}

const titleCaseKey = key => key.toLowerCase().split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// Use counters for a follow-up: "Keeps track of the number of uses of Kindred Guidance:
// Cloud (0~2), removed after reaching 2", named "Kindred Guidance: Cloud Uses".
function describeDoneCount(params, ctx) {
  const names = params.effects.map(e => effectName(e, ctx));
  if (names.join() !== 'COUNT_ABILITY_DONE,IS_DONE_WHEN_SPECIFIC_ABILITY_DONE') return null;
  const [count, done] = params.effects;
  const id = count.abilityCondition?.abilityId;
  const max = done.abilityDoneCountCondition?.greaterEqual;
  if (id == null || id !== done.abilityCondition?.abilityId || max == null) return null;
  const durations = describeDurations(params.durations, ctx, params.effects);
  if (!durations || durations.suffixes.length) return null;
  const ability = ctx.abilityName(id);
  return { name: `${ability} Uses`, effects: `Keeps track of the number of uses of ${ability} (0~${max}), removed after reaching ${max}`, defaultDuration: durations.duration };
}

const MODE_FAMILIES = [describeMasterMode, describeZenithMode, describeSoulDriveMode, describeDualAwakeMode, describeAwakeMode, describeDoneCount];

// ─── Stat changes ────────────────────────────────────────────────────────────
// The sheet's stat names, and its stat lists: equal values grouped in the order they
// appear, increases before decreases — "MND +30%, DEF and RES -30%".
const STAT_NAMES = { ATK: 'ATK', MATK: 'MAG', DEF: 'DEF', MDEF: 'RES', MND: 'MND', atk: 'ATK', matk: 'MAG', def: 'DEF', mdef: 'RES', mnd: 'MND' };

function statList(changes, unit) {
  const groups = [];
  for (const sign of [1, -1]) {
    for (const { stat, value } of changes.filter(c => Math.sign(c.value) === sign)) {
      const group = groups.find(g => g.value === value);
      if (group) group.stats.push(stat); else groups.push({ value, stats: [stat] });
    }
  }
  return groups.map(g => `${joinList(g.stats, 'and')} ${g.value > 0 ? '+' : '-'}${Math.abs(g.value)}${unit}`).join(', ');
}

// Older statuses with no game config spell their values out in the coded name:
// CUSTOM_PARAM_MULTI_ATK_30_DEF_M30_8000 → "ATK +30%, DEF -30%" for 8 seconds. A
// trailing number is milliseconds (8000) or turns (2); LARGE is 25 seconds; with no
// duration the sheet's most common value is 25 seconds (18 rows, vs 13 for 8s and 12 "-").
// The names the sheet gives many of these ("Dark Bargain") can't be derived; the rest
// read "ATK +30%, DEF -30% (8s)", "100% Critical 2". (The custom names come from the
// English Global version's localization; statuses added after Global closed have none,
// so the generated form is what new rows use.)
export function describeStatusFromKey(key) {
  // Single stats read the same way: CUSTOM_ATK_10_WITH_DURATION_SMALL_8000.
  const m = /^CUSTOM_PARAM_MULTI_(.+)$/.exec(key ?? '') ?? /^CUSTOM_((?:ATK|MATK|DEF|MDEF|MND|CRITICAL)_M?\d+(?:_.+)?)$/.exec(key ?? '');
  if (!m) return null;
  const tokens = m[1].split('_');
  // Templates whose value is set by the ability: CUSTOM_ATK_DEF → "ATK and DEF +X%".
  if (!m[0].startsWith('CUSTOM_PARAM_MULTI_') && tokens.every(t => STAT_NAMES[t] || t === 'CRITICAL')) {
    if (tokens.includes('CRITICAL')) return tokens.length === 1 ? { name: 'Critical Chance X%', effects: 'Critical chance =X%', defaultDuration: '-' } : null;
    const text = `${joinList(tokens.map(t => STAT_NAMES[t]), 'and')} +X%`;
    return { name: text, effects: text, defaultDuration: '-' };
  }
  const changes = [];
  let critical = null, i = 0;
  while (i + 1 < tokens.length && /^M?\d+$/.test(tokens[i + 1]) && (STAT_NAMES[tokens[i]] || tokens[i] === 'CRITICAL')) {
    const value = (tokens[i + 1].startsWith('M') ? -1 : 1) * parseInt(tokens[i + 1].replace('M', ''));
    if (tokens[i] === 'CRITICAL') critical = value; else changes.push({ stat: STAT_NAMES[tokens[i]], value });
    i += 2;
  }
  // What's left is the duration: [WITH_DURATION_][SMALL_|LARGE|<ms>|<turns>][_FOR_…]
  // A size word before a number (MEDIUM_15000) only names the duration the number gives.
  let rest = tokens.slice(i).filter(t => !['WITH', 'DURATION', 'SMALL'].includes(t));
  if (rest[0] === 'MEDIUM' && /^\d+$/.test(rest[1] ?? '')) rest = rest.slice(1);
  const end = rest.indexOf('FOR');
  const dur = (end < 0 ? rest : rest.slice(0, end));
  if (dur.length > 1 || (!changes.length && critical == null)) return null;
  let defaultDuration = '25 seconds', nameSuffix = ' (25s)';
  if (dur[0] === 'LARGE' || dur.length === 0) { /* 25 seconds */ }
  else if (dur[0] === 'MEDIUM') { defaultDuration = '15 seconds'; nameSuffix = ' (15s)'; }
  else if (/^\d+$/.test(dur[0]) && +dur[0] >= 1000) { defaultDuration = plural(+dur[0] / 1000, 'second'); nameSuffix = ` (${+dur[0] / 1000}s)`; }
  else if (/^\d+$/.test(dur[0])) { defaultDuration = plural(+dur[0], 'turn'); nameSuffix = ` ${dur[0]}`; }
  else return null;
  const parts = [changes.length ? statList(changes, '%') : null, critical != null ? `Critical chance =${critical}%` : null].filter(Boolean);
  const name = changes.length ? `${statList(changes, '%')}${nameSuffix}` : `${critical}% Critical${nameSuffix}`;
  return { name, effects: parts.join(', '), defaultDuration };
}

// { name, effects, defaultDuration } in the sheet's wording (name may be null), or null when any part of the
// status isn't understood yet.
export function describeStatus(params, ctx) {
  if (!params?.effects?.length) return null;
  for (const family of MODE_FAMILIES) {
    const described = family(params, ctx);
    if (described) return described;
  }
  const clauses = [];
  for (const e of params.effects) {
    const describe = EFFECTS[nameOf(ctx.conf.STATUS_AILMENTS_PARAM_EFFECT_TYPE, e.type)];
    const clause = describe?.(e, ctx);
    if (!clause) return null;
    clauses.push(clause);
  }
  const durations = describeDurations(params.durations, ctx, params.effects);
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
    else {
      // Tactical statuses that grant something say "user" (56 rows, none say "character").
      const user = allCaps || USER_REMOVAL_MODES.has(removedUnless) || (removedUnless === 'Tactical Awoken Mode' && /^Grants /.test(clauses[0]));
      clauses.push(`removed if the ${user ? 'user' : 'character'} hasn't [${removedUnless}]`);
    }
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
