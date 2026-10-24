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
//   statusKey(id),       // status id → STATUS_AILMENTS_TYPE key
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
  'INCREASE_CAST_TIME_FACTOR', 'REDUCE_CONSUME_POINT', 'IS_DONE_EFFECTS_WHEN_SPECIFIC_EFFECT_KEYS', 'BUDDY_ENHANCE']);
function describeMasterMode(params, ctx) {
  const prefix = 'MASTER_BUDDY_MODE_';
  if (!ctx.selfKey?.startsWith(prefix) || !params.effects.every(e => MASTER_EFFECTS.has(effectName(e, ctx)))) return null;
  const chase = params.effects.find(e => effectName(e, ctx) === 'REGISTER_CHASE_ABILITY_WHEN_AFTER_TIME_EXCEED');
  const cap = params.effects.find(e => effectName(e, ctx) === 'INCREASE_DAMAGE_THRESHOLD_LV' && e.generalValueToDamageThresholdLvMap);
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
  clauses.push(listed
    ? `${listed.replace(/^Grants /, 'grants ').replace(/\.$/, '')} after using a Soul Break`
    : 'casts <ability missing from Other Tab> after using a Soul Break');
  clauses.push('removed after triggering', `removed if the character hasn't [${durations.suffixes[0].removedUnless}]`);
  return { name, effects: clauses.join(', '), defaultDuration: durations.duration };
}

const MODE_FAMILIES = [describeMasterMode, describeZenithMode, describeSoulDriveMode];

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
