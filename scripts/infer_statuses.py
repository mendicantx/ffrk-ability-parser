#!/usr/bin/env python3
"""
infer_statuses.py

Reads data/sheets/status.json, applies pattern-based inference to rows that
have at least one blank field (Common Name, Effects, or Default Duration) and
a Coded Name, and writes the inferred rows to inferred_statuses.csv.

JS-derived Effects/Duration (from parse_js_status_defs) are the primary source;
name-based patterns supplement for Common Name generation and fill any gaps.
"""

import csv
import json
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT      = Path(__file__).resolve().parent.parent
INPUT_FILE     = REPO_ROOT / "data" / "sheets" / "status.json"
AILMENTS_FILE  = REPO_ROOT / "data" / "status_ailments.json"
BATTLE_JS_FILE = REPO_ROOT / "data" / "battle_js.txt"
OUTPUT_FILE    = REPO_ROOT / "inferred_statuses.csv"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def is_blank(v):
    return v is None or str(v).strip() in ('', '-')


TIME_DURATIONS = {
    'TIME_SMALL_2000':  '2 seconds',
    'TIME_SMALL_5000':  '5 seconds',
    'TIME_SMALL_8000':  '8 seconds',
    'TIME_SMALL_10000': '10 seconds',
    'TIME_SMALL_12000': '12 seconds',
    'TIME_MEDIUM_16000': '16 seconds',
    'TIME_MEDIUM':      '15 seconds',
    'TIME_LARGE':       '25 seconds',
}

# Damage factor percentage boosts (factor value - 100 = % boost)
DAMAGE_FACTORS = {
    'EXTRA_SMALL_105': 5,  'EXTRA_SMALL': 9,    'EXTRA_SMALL_110': 10,
    'SMALL': 15,           'SMALL_120': 20,      'SMALL_125': 25,
    'MEDIUM': 30,          'MEDIUM_135': 35,     'EXTRA_MEDIUM': 40,
    'EXTRA_MEDIUM_135': 35,'EXTRA_MEDIUM_145': 45,
    'LARGE': 50,           'LARGE_160': 60,      'EXTRA_LARGE': 70,
    'SUPER_EXTRA_LARGE': 150,
}

# Cast time factors (200 = x2.00, 1e7 = instant)
CAST_TIME_FACTORS = {
    'EXTEND_SMALL': 70, 'SMALL_110': 110, 'SMALL_125': 125, 'SMALL': 150,
    'MEDIUM': 200, 'MEDIUM_250': 250, 'LARGE': 300, 'MAX': 10000000,
}

# abilityCondNameForChangeCastTime string -> human readable
ABILITY_COND_NAME_MAP = {
    'physicalDamageAbilities': 'Physical abilities',
    'magicDamageAbilities':    'Magical abilities',
    'ninjutsuAbilities':       'Ninjutsu abilities',
}

# boost paramName -> display label
PARAM_NAME_MAP = {
    'atk': 'ATK', 'matk': 'MATK', 'def': 'DEF', 'mdef': 'MDEF',
    'mnd': 'MND', 'acc': 'ACC',   'eva': 'EVA', 'spd': 'SPD',
    'critical': 'Critical Hit Rate', 'max_hp': 'Max HP', 'damage_cap': 'Damage Cap',
}

# Ability category ID to name
ABILITY_CATEGORY_ID_NAMES = {
    'BLACK_MAGIC': 'Black Magic', 'WHITE_MAGIC': 'White Magic',
    'SUMMONING': 'Summoning', 'SPELLBLADE': 'Spellblade', 'COMBAT': 'Combat',
    'SUPPORT': 'Support', 'CELERITY': 'Celerity', 'DRAGOON': 'Dragoon',
    'MONK': 'Monk', 'THIEF': 'Thief', 'KNIGHT': 'Knight', 'SAMURAI': 'Samurai',
    'NINJA': 'Ninja', 'BARD': 'Bard', 'DANCER': 'Dancer', 'MACHINIST': 'Machinist',
    'DARKNESS': 'Darkness', 'SHOOTER': 'Sharpshooter', 'WITCH': 'Witch', 'HEAVY': 'Heavy',
}

# ---------------------------------------------------------------------------
# Argument parsing helpers
# ---------------------------------------------------------------------------

_ROMAN_NUMERALS_SET = {'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII'}

def _cap_word(w):
    """Title-case a word, but keep known Roman numerals (II, III …) uppercase."""
    if w in _ROMAN_NUMERALS_SET:
        return w
    return w.capitalize()


def split_args(s):
    """Split comma-separated JS function args respecting bracket nesting."""
    args, depth, cur = [], 0, ''
    for ch in s:
        if ch in '([{':
            depth += 1; cur += ch
        elif ch in ')]}':
            depth -= 1; cur += ch
        elif ch == ',' and depth == 0:
            args.append(cur.strip()); cur = ''
        else:
            cur += ch
    if cur.strip():
        args.append(cur.strip())
    return args


def parse_time_arg(arg):
    """Extract duration string from time argument expression."""
    if not arg:
        return None
    m = re.search(r'\.TIME\.([A-Z0-9_]+)', arg)
    if m:
        return TIME_DURATIONS.get(f'TIME_{m.group(1)}')
    m2 = re.match(r'^([\d.]+(?:e\d+)?)$', arg.strip())
    if m2:
        ms = float(m2.group(1))
        return f'{int(ms / 1000)} seconds'
    return None


def parse_damage_factor_arg(arg):
    """Return integer % boost from a DAMAGE_FACTOR argument expression."""
    if not arg:
        return None
    m = re.search(r'DAMAGE_FACTOR\.([A-Z0-9_]+)', arg)
    if m:
        return DAMAGE_FACTORS.get(m.group(1))
    m2 = re.match(r'^(\d+)$', arg.strip())
    if m2:
        n = int(m2.group(1))
        return n - 100 if n > 100 else None
    return None


def parse_cast_factor_arg(arg):
    """Return numeric cast time factor from a CAST_TIME_FACTOR argument expression."""
    if not arg:
        return None
    m = re.search(r'CAST_TIME_FACTOR\.([A-Z0-9_]+)', arg)
    if m:
        return CAST_TIME_FACTORS.get(m.group(1))
    m2 = re.match(r'^(\d+)$', arg.strip())
    if m2:
        return int(m2.group(1))
    return None


def cast_factor_str(factor):
    if factor is None:
        return 'xN'
    if factor >= 1000000:
        return 'x999999'
    return f'x{factor / 100:.2f}'


def parse_element_from_arg(arg):
    """Extract element name from d.ELEMENT_TYPE.XXX expression."""
    if not arg:
        return None
    m = re.search(r'ELEMENT_TYPE\.([A-Z]+)', arg)
    return ELEMENT_NAMES.get(m.group(1)) if m else None


def parse_ability_condition(arg):
    """
    Parse a JS abilityCondition object or expression into a human-readable string.
    Returns None if unrecognisable.
    """
    if not arg or arg.strip() in ('', '{}', 'void 0'):
        return None

    parts = []

    # categoryId: single or array
    cat = re.search(r'categoryId:(?:e\.forceArray\()?(?:\[)?d\.ABILITY_CATEGORY_ID(?:_OF)?\.([A-Z_]+)', arg)
    if cat:
        parts.append(ABILITY_CATEGORY_ID_NAMES.get(cat.group(1), cat.group(1).replace('_', ' ').title()))
    else:
        # Multiple categories in an array literal
        cats = re.findall(r'ABILITY_CATEGORY_ID(?:_OF)?\.([A-Z_]+)', arg)
        if cats:
            names = [ABILITY_CATEGORY_ID_NAMES.get(c, c.replace('_', ' ').title()) for c in cats]
            parts.append('/'.join(dict.fromkeys(names)))  # deduplicate, preserve order

    # elementId: single
    elem = re.search(r'elementId:d\.ELEMENT_TYPE\.([A-Z]+)', arg)
    if elem:
        parts.append(ELEMENT_NAMES.get(elem.group(1), elem.group(1).title()))
    else:
        # anyElementIds or array
        elems = re.findall(r'ELEMENT_TYPE\.([A-Z]+)', arg)
        if elems:
            names = [ELEMENT_NAMES.get(e, e.title()) for e in elems]
            parts.append('/'.join(dict.fromkeys(names)))

    # Magical
    if 'isMagicOrNinjutsuAttack' in arg:
        parts.append('magical')

    # isSoulStrike
    if 'isSoulStrike:!0' in arg and 'isAbility:!1' in arg:
        parts.append('Soul Break')

    return ' '.join(parts) if parts else None

# ---------------------------------------------------------------------------
# Function handlers
# ---------------------------------------------------------------------------

def _damage_boost_effect(factor_arg, condition_arg):
    pct = parse_damage_factor_arg(factor_arg)
    cond = parse_ability_condition(condition_arg)
    pct_str = f'+{pct}%' if pct is not None else ''
    cond_str = f'{cond} ' if cond else ''
    return f'{cond_str}abilities deal {pct_str} more damage'


def handler_tt(args):
    """INCREASE_EXECUTED_DAMAGE, TIME duration: (factor, time, condition)"""
    effects = _damage_boost_effect(args[0] if args else None, args[2] if len(args) > 2 else None)
    duration = parse_time_arg(args[1] if len(args) > 1 else None)
    return {'Effects': effects, 'Default Duration': duration or '-'}


def handler_nt(args):
    """INCREASE_EXECUTED_DAMAGE, TURN duration: (factor, turns, condition)"""
    effects = _damage_boost_effect(args[0] if args else None, args[2] if len(args) > 2 else None)
    turn_s = args[1].strip() if len(args) > 1 else ''
    turn = int(turn_s) if turn_s.isdigit() else None
    duration = f'{turn} turn{"s" if turn != 1 else ""}' if turn else '-'
    return {'Effects': effects, 'Default Duration': duration}


def handler_mr(args):
    """INCREASE_ELEMENT_ATK: (elementId, level, time, opts?)"""
    elem = parse_element_from_arg(args[0] if args else None) or '?'
    lv_s = args[1].strip() if len(args) > 1 else '1'
    try:
        lv = int(lv_s)
    except ValueError:
        lv = 1
    duration = parse_time_arg(args[2] if len(args) > 2 else None)
    pct = abs(lv) * 10
    if lv < 0:
        effects = f'Reduces {elem} damage dealt by {pct}%, cumulable'
    else:
        effects = f'Increases {elem} damage dealt by {pct}%, cumulable'
    return {'Effects': effects, 'Default Duration': duration or '-'}


def handler_gr(args):
    """INCREASE_ELEMENT_DEF: (elementId, level, time, opts?)"""
    elem = parse_element_from_arg(args[0] if args else None) or '?'
    lv_s = args[1].strip() if len(args) > 1 else '1'
    lv = int(lv_s) if lv_s.isdigit() else 1
    duration = parse_time_arg(args[2] if len(args) > 2 else None)
    effects = f'{elem} Resistance Lv.{lv} (increases resistance to {elem})'
    return {'Effects': effects, 'Default Duration': duration or '-'}


def handler_It(args):
    """ABILITY_DOUBLE (Quickcast): (abilityCondition,)"""
    cond = parse_ability_condition(args[0] if args else None)
    cond_str = f' for {cond}' if cond else ''
    return {'Effects': f'Quickcast{cond_str}', 'Default Duration': '15 seconds'}


def handler_Nr(args):
    """DEPROTECT: (level, time)"""
    lv_s = args[0].strip() if args else '1'
    lv = int(lv_s) if lv_s.isdigit() else 1
    duration = parse_time_arg(args[1] if len(args) > 1 else None)
    return {'Effects': f'Deprotect Lv.{lv} (lowers DEF)', 'Default Duration': duration or '-'}


def handler_kr(args):
    """DESHELL: (level, time)"""
    lv_s = args[0].strip() if args else '1'
    lv = int(lv_s) if lv_s.isdigit() else 1
    duration = parse_time_arg(args[1] if len(args) > 1 else None)
    return {'Effects': f'Deshell Lv.{lv} (lowers RES)', 'Default Duration': duration or '-'}


def handler_Dt(args):
    """SEQ_ABILITY_REPEAT (TIME): (time, abilityCondition, opts?)"""
    duration = parse_time_arg(args[0] if args else None)
    cond = parse_ability_condition(args[1] if len(args) > 1 else None)
    if cond:
        cond_str = cond.replace('/', ', ')
        common_name = f'Dualcast {cond_str} abilities'
        effects = f'{cond_str} abilities trigger an additional time'
    else:
        common_name = 'Dualcast'
        effects = 'Abilities trigger an additional time'
    return {'Common Name': common_name, 'Effects': effects, 'Default Duration': duration or '-'}


def handler_Pt(args):
    """SEQ_ABILITY_REPEAT (TURN): (turns, abilityCondition, opts?)"""
    turn_s = args[0].strip() if args else ''
    turn = int(turn_s) if turn_s.isdigit() else None
    cond = parse_ability_condition(args[1] if len(args) > 1 else None)
    duration = f'{turn} turn{"s" if turn != 1 else ""}' if turn else '-'
    if cond:
        cond_str = cond.replace('/', ', ')
        common_name = f'Dualcast {cond_str} abilities'
        effects = f'{cond_str} abilities trigger an additional time'
    else:
        common_name = 'Dualcast'
        effects = 'Abilities trigger an additional time'
    return {'Common Name': common_name, 'Effects': effects, 'Default Duration': duration}


def handler_St(args):
    """CHANGE_CAST_TIME (TURN): (castTimeFactor, durationTurn, abilityCategoryId)"""
    factor = parse_cast_factor_arg(args[0] if args else None)
    turn_s = args[1].strip() if len(args) > 1 else ''
    turn = int(turn_s) if turn_s.isdigit() else None
    cat_m = re.search(r'ABILITY_CATEGORY_ID(?:_OF)?\.([A-Z_]+)', args[2] if len(args) > 2 else '')
    cat = ABILITY_CATEGORY_ID_NAMES.get(cat_m.group(1), cat_m.group(1).replace('_', ' ').title()) if cat_m else None
    cond_str = f' for {cat}' if cat else ''
    duration = f'{turn} turn{"s" if turn != 1 else ""}' if turn else '-'
    return {'Effects': f'Cast speed {cast_factor_str(factor)}{cond_str}', 'Default Duration': duration}


def handler_Tt(args):
    """CHANGE_CAST_TIME (TIME): (castTimeFactor, time_ms, abilityCategoryId)"""
    factor = parse_cast_factor_arg(args[0] if args else None)
    duration = parse_time_arg(args[1] if len(args) > 1 else None)
    cat_m = re.search(r'ABILITY_CATEGORY_ID(?:_OF)?\.([A-Z_]+)', args[2] if len(args) > 2 else '')
    cat = ABILITY_CATEGORY_ID_NAMES.get(cat_m.group(1), cat_m.group(1).replace('_', ' ').title()) if cat_m else None
    cond_str = f' for {cat}' if cat else ''
    return {'Effects': f'Cast speed {cast_factor_str(factor)}{cond_str}', 'Default Duration': duration or '-'}


def handler_Nt(args):
    """INCREASE_CAST_TIME_FACTOR (TURN): (factor, turns, abilityCondition)"""
    factor = parse_cast_factor_arg(args[0] if args else None)
    turn_s = args[1].strip() if len(args) > 1 else ''
    turn = int(turn_s) if turn_s.isdigit() else None
    cond = parse_ability_condition(args[2] if len(args) > 2 else None)
    cond_str = f' for {cond}' if cond else ''
    duration = f'{turn} turn{"s" if turn != 1 else ""}' if turn else '-'
    return {'Effects': f'Cast speed {cast_factor_str(factor)}{cond_str}', 'Default Duration': duration}


def handler_jr(args):
    """CHANGE_CAST_TIME while TACTICAL_AWAKE_MODE: (abilityCondition, castTimeFactor, opts?)"""
    cond = parse_ability_condition(args[0] if args else None)
    factor = parse_cast_factor_arg(args[1] if len(args) > 1 else None)
    cond_str = f' for {cond}' if cond else ''
    return {'Effects': f'Cast speed {cast_factor_str(factor)}{cond_str} while in Tactical Awoken Mode', 'Default Duration': '-'}


def handler_gn(args):
    """STATE_LEVEL_BY_GENERAL_VALUE_WHILE_MODE: (saId,)"""
    m = re.search(r'v\.([A-Z][A-Z0-9_]*)', args[0] if args else '')
    mode = m.group(1).replace('_', ' ').title() if m else 'Mode'
    return {'Effects': f'Tracks state level for {mode}, removed when mode ends', 'Default Duration': '-'}


def handler_In(args):
    """ABILITY_BOOST: (damageFactorMapType, abilityCondition)"""
    map_type = args[0].split('.')[-1] if args else 'MEDIUM'
    cond = parse_ability_condition(args[1] if len(args) > 1 else None)
    boost = '15/20/25/30/50%' if 'LARGE' in map_type else '5/10/15/20/30%'
    cond_str = f'{cond} ' if cond else ''
    return {'Effects': f'{cond_str}abilities deal {boost} more damage at ability rank 1/2/3/4/5', 'Default Duration': '15 seconds'}


def handler_chase_generic(args):
    """Generic handler for all chase/follow-up functions (en, yn, wn, un, nn, on, sn, fn, ln, cn)"""
    cond = None
    for i in [1, 2]:
        if len(args) > i:
            cond = parse_ability_condition(args[i])
            if cond:
                break
    cond_str = f' when using {cond} abilities' if cond else ''
    return {'Effects': f'Triggers a follow-up attack{cond_str}', 'Default Duration': '-'}


def handler_U(args):
    """ADD_CRITICAL_RATE (TIME): (critRate, time)"""
    rate_s = args[0].strip() if args else ''
    rate = int(rate_s) if rate_s.isdigit() else None
    duration = parse_time_arg(args[1] if len(args) > 1 else None)
    rate_str = f'{rate}%' if rate else '?%'
    return {'Effects': f'Adds {rate_str} critical hit rate', 'Default Duration': duration or '-'}


def handler_Sn(args):
    """ANTI_HEAL: (level,)"""
    lv_s = args[0].strip() if args else '1'
    lv = int(lv_s) if lv_s.isdigit() else 1
    return {'Effects': f'Anti-Heal Lv.{lv} (reduces healing received)', 'Default Duration': '-'}


def handler_Tn(args):
    """PAIN: (level,)"""
    lv_s = args[0].strip() if args else '1'
    lv = int(lv_s) if lv_s.isdigit() else 1
    return {'Effects': f'Pain Lv.{lv} (amplifies damage taken)', 'Default Duration': '-'}


def handler_O(args):
    """RERAISE: (hpRate,)"""
    rate_s = args[0].strip() if args else ''
    rate = int(rate_s) if rate_s.isdigit() else None
    rate_str = f'{rate}%' if rate else '?%'
    return {'Effects': f'Reraise at {rate_str} HP', 'Default Duration': '-'}


def handler_M(args):
    """SET_DOOM: (count,)"""
    cnt_s = args[0].strip() if args else ''
    cnt = int(cnt_s) if cnt_s.isdigit() else None
    cnt_str = str(cnt) if cnt else '?'
    return {'Effects': f'Doom: KO in {cnt_str} turns', 'Default Duration': '-'}


def handler_D(args):
    """INCREASE_DOOM_COUNT: (count,)"""
    cnt_s = args[0].strip() if args else ''
    cnt = int(cnt_s) if cnt_s.isdigit() else None
    cnt_str = str(cnt) if cnt else '?'
    return {'Effects': f'Extends Doom timer by {cnt_str} turns', 'Default Duration': '-'}


def handler_rt(args):
    """INCREASE_EXECUTED_DAMAGE, no duration: (factor, condition)"""
    effects = _damage_boost_effect(args[0] if args else None, args[1] if len(args) > 1 else None)
    return {'Effects': effects, 'Default Duration': '-'}


def handler_an(args):
    """Chase UNSET_WHEN_ALL_EFFECTS_ARE_DONE: (chaseId, condition, opts?)"""
    cond = parse_ability_condition(args[1] if len(args) > 1 else None)
    cond_str = f' when using {cond} abilities' if cond else ''
    return {'Effects': f'Triggers a one-time follow-up attack{cond_str}', 'Default Duration': '-'}


def handler_Wr(args):
    """ENHANCE_SHIN_OUGI (Arcane Dyad counter): (abilityId, condition, opts?)"""
    return {'Effects': 'Arcane Dyad empowered: tracks Soul Break uses (max 2)', 'Default Duration': '-'}


def handler_hr_mr_element_level(args):
    """Element infusion level increase: (elementId, level, opts?)"""
    elem = parse_element_from_arg(args[0] if args else None) or '?'
    lv_s = args[1].strip() if len(args) > 1 else '1'
    lv = int(lv_s) if lv_s.isdigit() else 1
    return {'Effects': f'Increases {elem} infusion to Lv.{lv}', 'Default Duration': '-'}


# ---------------------------------------------------------------------------
# FUNC_HANDLERS dispatch table
# ---------------------------------------------------------------------------

FUNC_HANDLERS = {
    'tt': handler_tt, 'nt': handler_nt,
    'rt': handler_rt, 'it': handler_rt, 'st': handler_rt, 'at': handler_rt,
    'ot': handler_rt,
    'bt': handler_nt,   # summation damage, turn-based, similar structure
    'vt': handler_tt,   # summation damage, time-based
    'mt': handler_nt,   # summation damage, turn-based
    'mr': handler_mr, 'gr': handler_gr,
    'It': handler_It,
    'Nr': handler_Nr, 'kr': handler_kr,
    'Dt': handler_Dt, 'Pt': handler_Pt,
    'St': handler_St, 'Tt': handler_Tt,
    'Nt': handler_Nt, 'jr': handler_jr,
    'gn': handler_gn,
    'In': handler_In,
    'U':  handler_U,
    'Sn': handler_Sn, 'Tn': handler_Tn, 'xn': handler_Sn,
    'O':  handler_O,  'M': handler_M,   'D': handler_D,
    'Wr': handler_Wr,
    # Chase families
    'en': handler_chase_generic, 'yn': handler_chase_generic,
    'wn': handler_chase_generic, 'un': handler_chase_generic,
    'nn': handler_chase_generic, 'on': handler_chase_generic,
    'sn': handler_chase_generic, 'fn': handler_chase_generic,
    'ln': handler_chase_generic, 'cn': handler_chase_generic,
    'an': handler_an, 'Zt': handler_chase_generic,
}

# ---------------------------------------------------------------------------
# JS-derived status definitions parser
# ---------------------------------------------------------------------------

def parse_js_status_defs():
    """
    Parse A[v.NAME]=FUNC(args) in StatusAilmentsConfig block.
    Returns {STATUS_NAME: {'Effects': str, 'Default Duration': str}}.
    """
    if not BATTLE_JS_FILE.exists():
        return {}

    data = BATTLE_JS_FILE.read_text(encoding='utf-8')
    block_start = data.find('define("scenes/battle/StatusAilmentsConfig"')
    if block_start == -1:
        return {}
    block_end_pos = data.find('define(', block_start + 100)
    block = data[block_start:block_end_pos] if block_end_pos != -1 else data[block_start:]

    result = {}
    for m in re.finditer(r'A\[v\.([A-Z][A-Z0-9_]*)\]=([A-Za-z_$]+)\(', block):
        name   = m.group(1)
        fname  = m.group(2)
        handler = FUNC_HANDLERS.get(fname)
        if handler is None:
            continue

        # Extract balanced args string
        args_start = m.end()
        i, depth = args_start, 1
        while i < len(block) and depth > 0:
            if block[i] == '(':
                depth += 1
            elif block[i] == ')':
                depth -= 1
            i += 1
        args_str = block[args_start:i - 1]
        args = split_args(args_str)

        try:
            result[name] = handler(args)
        except Exception:
            pass

    return result

# ---------------------------------------------------------------------------
# JS _.extend assignments parser
# ---------------------------------------------------------------------------

def parse_js_extend_defs():
    """
    Parse A[v.NAME]=_.extend(template, {overrides}) assignments in StatusAilmentsConfig.
    Extracts castTimeFactor, duration, and boosts directly from the override object.
    Returns {STATUS_NAME: {'Effects': str, 'Default Duration': str}}.
    """
    if not BATTLE_JS_FILE.exists():
        return {}

    data = BATTLE_JS_FILE.read_text(encoding='utf-8')
    block_start = data.find('define("scenes/battle/StatusAilmentsConfig"')
    if block_start == -1:
        return {}
    block_end_pos = data.find('define(', block_start + 100)
    block = data[block_start:block_end_pos] if block_end_pos != -1 else data[block_start:]

    result = {}

    for m in re.finditer(r'A\[v\.([A-Z][A-Z0-9_]*)\]=_\.extend\(', block):
        name = m.group(1)

        args_start = m.end()
        i, depth = args_start, 1
        while i < len(block) and depth > 0:
            if block[i] == '(':
                depth += 1
            elif block[i] == ')':
                depth -= 1
            i += 1
        args_str = block[args_start:i - 1]
        args = split_args(args_str)

        # The override object is the last arg that starts with {
        override_str = ''
        for arg in reversed(args):
            a = arg.strip()
            if a.startswith('{'):
                override_str = a
                break
        if not override_str or override_str == '{}':
            continue

        # --- castTimeFactor ---
        factor = None
        ctf_m = re.search(r'castTimeFactor:\s*(\d+)', override_str)
        if ctf_m:
            factor = int(ctf_m.group(1))
        else:
            ctf_const = re.search(
                r'castTimeFactor:\s*S\[w\.INCREASE_CAST_TIME_FACTOR\]\.CAST_TIME_FACTOR\.([A-Z0-9_]+)',
                override_str)
            if ctf_const:
                factor = CAST_TIME_FACTORS.get(ctf_const.group(1))

        # --- duration ---
        duration = None
        if 'duration:!1' not in override_str:
            dt_m = re.search(r'durationTurn:\s*(\d+)', override_str)
            if dt_m:
                t = int(dt_m.group(1))
                if t > 0:
                    duration = f'{t} turn{"s" if t != 1 else ""}'
            if duration is None:
                dur_ms_m = re.search(r'duration:\{[^}]*\bc:\s*([\d.e+]+)', override_str)
                if dur_ms_m:
                    ms = float(dur_ms_m.group(1))
                    duration = f'{int(ms / 1000)} seconds'

        # --- boosts ---
        boosts = []
        for boost_m in re.finditer(r'\{paramName:"([^"]+)"([^}]*)\}', override_str):
            param = boost_m.group(1)
            boost_body = boost_m.group(2)
            label = PARAM_NAME_MAP.get(param, param.upper())
            abs_m = re.search(r'absolute:(\d+)', boost_body)
            rate_m = re.search(r'rate:(-?\d+)', boost_body)
            if abs_m:
                boosts.append(f'{label} +{abs_m.group(1)}%')
            elif rate_m:
                rate = int(rate_m.group(1))
                if rate != 0:
                    sign = '+' if rate > 0 else ''
                    boosts.append(f'{label} {sign}{rate}%')

        # --- ability condition for cast time ---
        cond_str = ''
        if factor is not None:
            acn_m = re.search(r'abilityCondNameForChangeCastTime:\s*"([^"]+)"', override_str)
            if acn_m:
                cond_str = f' for {ABILITY_COND_NAME_MAP.get(acn_m.group(1), acn_m.group(1))}'
            else:
                acat_m = re.search(
                    r'abilityCategoryIdForChangeCastTime:\s*(?:\[)?d\.ABILITY_CATEGORY_ID\.([A-Z_]+)',
                    override_str)
                if acat_m:
                    cat = ABILITY_CATEGORY_ID_NAMES.get(
                        acat_m.group(1), acat_m.group(1).replace('_', ' ').title())
                    cond_str = f' for {cat}'
                else:
                    acond_pos = override_str.find('abilityConditionForChangeCastTime:')
                    if acond_pos >= 0:
                        brace_pos = override_str.find('{', acond_pos)
                        if brace_pos >= 0:
                            j, d2 = brace_pos + 1, 1
                            while j < len(override_str) and d2 > 0:
                                if override_str[j] == '{':
                                    d2 += 1
                                elif override_str[j] == '}':
                                    d2 -= 1
                                j += 1
                            acond_content = override_str[brace_pos:j]
                            elems = re.findall(r'ELEMENT_TYPE\.([A-Z]+)', acond_content)
                            if elems:
                                elem_names = [ELEMENT_NAMES.get(e, e.title()) for e in elems]
                                cond_str = f' for {", ".join(elem_names)}'

        # --- build effects ---
        effects_parts = []
        if factor is not None:
            factor_str = f'x{factor / 100:.2f}' if factor < 1000000 else 'x999999'
            effects_parts.append(f'Cast speed {factor_str}{cond_str}')
        if boosts:
            effects_parts.append(', '.join(boosts))

        if not effects_parts and duration is None:
            continue

        entry = {}
        if effects_parts:
            entry['Effects'] = ', '.join(effects_parts)
        if duration:
            entry['Default Duration'] = duration
        if entry:
            result[name] = entry

    return result


# ---------------------------------------------------------------------------
# JS durations parser (object-style blocks)
# ---------------------------------------------------------------------------

def parse_js_durations():
    """
    Parse A[v.STATUS_NAME]={durations:[...]} blocks from battle_js.txt.
    Returns dict: STATUS_NAME -> duration string ('N seconds' or '-').
    '-' means the status has no time limit (empty durations array) or a
    non-TIME trigger (e.g. UNSET_WHEN_SPECIFIC_EFFECT_IS_DONE).
    Keys absent from the dict mean the status definition wasn't found.
    """
    if not BATTLE_JS_FILE.exists():
        return {}

    data = BATTLE_JS_FILE.read_text(encoding='utf-8')
    result = {}

    for m in re.finditer(r'A\[v\.([A-Z][A-Z0-9_]*)\]=\{', data):
        name = m.group(1)
        obj_start = m.end()
        chunk = data[obj_start:obj_start + 2000]

        dm = re.search(r'durations:\[', chunk)
        if not dm:
            continue

        dur_start = obj_start + dm.end()

        # Empty array -> no time limit
        if data[dur_start] == ']':
            result[name] = '-'
            continue

        # Bracket counting to extract the array content
        i, depth = dur_start, 1
        while i < len(data) and depth > 0:
            if data[i] == '[':
                depth += 1
            elif data[i] == ']':
                depth -= 1
            i += 1
        dur_content = data[dur_start:i - 1]

        if 'type:y.TIME' not in dur_content:
            result[name] = '-'
            continue

        # Literal milliseconds: time:2e4, time:15e3, time:35000, etc.
        tm = re.search(r'time:([\d.]+(?:e\d+)?)', dur_content)
        if tm:
            ms = float(tm.group(1))
            result[name] = f'{int(ms / 1000)} seconds'
            continue

        # Reference: time:b[y.TIME].TIME.MEDIUM / SMALL_5000 / etc.
        tm2 = re.search(r'time:b\[y\.TIME\]\.TIME\.([A-Z0-9_]+)', dur_content)
        if tm2:
            key = f'TIME_{tm2.group(1)}'
            result[name] = TIME_DURATIONS.get(key, '-')
            continue

        # time:t -> duration passed as a variable; unknown
        result[name] = '-'

    return result

# ---------------------------------------------------------------------------
# Name-based inference data
# ---------------------------------------------------------------------------

def infer_duration_from_name(cn):
    """Secondary fallback: derive duration from TIME_ constant in the coded name."""
    # Longest match first to avoid TIME_MEDIUM matching TIME_MEDIUM_16000
    for key in sorted(TIME_DURATIONS, key=len, reverse=True):
        if key in cn:
            return TIME_DURATIONS[key]
    m = re.search(r'_TURN_(\d+)$', cn)
    if m:
        n = int(m.group(1))
        return f"{n} turn{'s' if n != 1 else ''}"
    return None


CHARACTER_NAMES = {
    'BUTS': 'Bartz', 'MASH': 'Sabin', 'TINA': 'Terra', 'FRIONIEL': 'Firion',
    'LOCK': 'Locke', 'BALFLEAR': 'Balthier', 'GRADIOLUS': 'Gladiolus', 'CAIN': 'Kain',
    'ARTIMISIA': 'Ultimecia', 'STRAGUS': 'Strago', 'LAAN': 'Lann', 'SERAFI': 'Serafie',
    'SHERUKU': 'Chelinka', 'CAYENNE': 'Cyan', 'DRMOG': 'Dr. Mog', 'YUFI': 'Yuffie',
    'HAURCHEFAN': 'Haurchefant', 'DESHI': 'Tyro', 'ZEZAE': 'Xezat', 'SUPER_MONK': 'Master',
    'ENNAKROS': 'Enna Kros', 'WOR': 'Wol', 'SHADOW_SMITH': 'Shadowsmith',
    'PALADIN_CECIL': 'Cecil (Paladin)', 'DARK_CECIL': 'Cecil (Dark Knight)',
    'ONION_KNIGHT': 'Onion Knight', 'CLOUD_OF_DARKNESS': 'Cloud of Darkness',
    'RED_XIII': 'Red XIII', 'CID_GARLOND': 'Cid (Garlond)', 'CID_POLLENDINA': 'Cid (Pollendina)',
    'LEO_CHRISTOPHE': 'Leo', 'COR': 'Cor', 'REX': 'Rex', 'RAVUS': 'Ravus',
    'ARDYN': 'Ardyn', 'IGNIS': 'Ignis', 'LUNAFREYA': 'Lunafreya', 'PROMPTO': 'Prompto',
    'NOCTIS': 'Noctis', 'RAIN': 'Rain', 'LASSWELL': 'Lasswell', 'WRIEG': 'Wrieg',
    'MONTBLANC': 'Montblanc', 'SAZH': 'Sazh', 'LILISETTE': 'Lilisette',
    'LILITH': 'Lilith', 'EXNINE': 'Ex-Nine',
    'SETZER': 'Setzer',
}

ELEMENT_NAMES = {
    'FIRE': 'Fire', 'ICE': 'Ice', 'LIGHTNING': 'Lightning', 'EARTH': 'Earth',
    'WIND': 'Wind', 'WATER': 'Water', 'HOLY': 'Holy', 'DARK': 'Dark',
    'POISON': 'Poison', 'NON_ELEMENT': 'Non-elemental',
}

WHILE_MODE_MAP = {
    'TACTICAL_AWAKE_MODE': '(Tactical)',
    'AWAKE_MODE': '(Awakening)',
    'ARCANE_DYAD_MODE': '(Arcane Dyad)',
    'SYNCHRO_MODE': '(Synchro)',
}

ABILITY_NAMES = {
    'BLACK_MAGIC': 'Black Magic', 'WHITE_MAGIC': 'White Magic', 'SUMMONING': 'Summoning',
    'SPELLBLADE': 'Spellblade', 'COMBAT': 'Combat', 'SUPPORT': 'Support',
    'CELERITY': 'Celerity', 'DRAGOON': 'Dragoon', 'KNIGHT': 'Knight',
    'MONK': 'Monk', 'NINJA': 'Ninja', 'SAMURAI': 'Samurai', 'BARD': 'Bard',
    'DANCER': 'Dancer', 'SHOOTER': 'Sharpshooter', 'HEAVY': 'Heavy',
    'DARKNESS': 'Darkness', 'WITCH': 'Witch', 'THIEF': 'Thief',
    'BLUE_MAGIC': 'Blue Magic', 'MACHINIST': 'Machinist', 'GEOMANCER': 'Geomancer',
    'MAGICA': 'White Magic/Bard/Dancer', 'WITCH_II': 'Witch',
    'NATIVE': 'Native', 'NATIVE_ATTACK': 'Native',
}


def char_name_from_suffix(suffix):
    """
    Given a suffix like 'CLOUD_DARK' or 'TINA_FIRE', return
    (char_name, elements, extra_parts).
    """
    parts = suffix.split('_')
    elements = []
    # Strip trailing Roman-numeral version tokens (II, III, IV …) before element stripping,
    # so they don't block element recognition (e.g. LION_WATER_II → Water element + II version).
    _ROMAN = {'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII'}
    version_parts = []
    while parts and parts[-1] in _ROMAN:
        version_parts.insert(0, parts.pop())
    # Collect trailing element parts
    i = len(parts) - 1
    while i >= 0 and parts[i] in ELEMENT_NAMES:
        elements.insert(0, ELEMENT_NAMES[parts[i]])
        i -= 1
    # Try to match character name from remaining parts (longest first)
    remaining = parts[:i + 1]
    for length in range(len(remaining), 0, -1):
        candidate = '_'.join(remaining[:length])
        if candidate in CHARACTER_NAMES:
            extra = remaining[length:] + version_parts
            return CHARACTER_NAMES[candidate], elements, extra
    # Fallback: title-case the remaining parts (preserving Roman numerals).
    # If elements were found, keep version_parts as extra_parts so _ubm_spirit_name
    # can place them after the parenthesised element qualifier (e.g. "Lion (Water) II").
    # Without elements, version is just folded into the name ("Seven II").
    if version_parts and elements:
        name = ' '.join(_cap_word(w) for w in remaining)
        return name, elements, version_parts
    name = ' '.join(_cap_word(w) for w in remaining + version_parts)
    return name, elements, []

# ---------------------------------------------------------------------------
# ULTIMATE_BUDDY_MODE JS parser
# ---------------------------------------------------------------------------

_STATUS_NAME_LOOKUP_CACHE = None

def _get_status_name_lookup():
    """Build {coded_name -> common_name} from status.json (lazy, cached)."""
    global _STATUS_NAME_LOOKUP_CACHE
    if _STATUS_NAME_LOOKUP_CACHE is not None:
        return _STATUS_NAME_LOOKUP_CACHE
    lookup = {}
    try:
        with open(INPUT_FILE, encoding='utf-8') as f:
            data = json.load(f)
        for row in data:
            cn   = str(row.get('Coded Name', '')).strip()
            name = str(row.get('Common Name', '')).strip()
            if cn and name and name not in ('', '-'):
                lookup[cn] = name
    except Exception:
        pass
    _STATUS_NAME_LOOKUP_CACHE = lookup
    return lookup


def _ubm_list_str(items, connector='or'):
    """Join a list with Oxford comma + connector: 'a or b', 'a, b or c'."""
    if not items:
        return ''
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f'{items[0]} {connector} {items[1]}'
    return ', '.join(items[:-1]) + f' {connector} {items[-1]}'


def _extract_object_blocks(arr_content):
    """Split a '{...},{...},...' string into individual top-level object strings."""
    blocks = []
    depth, start = 0, None
    for i, ch in enumerate(arr_content):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start is not None:
                blocks.append(arr_content[start:i + 1])
                start = None
    return blocks


# Condensed display labels for specific ability categories in cast-time context
_CAST_COND_ABBREV = {
    'WHITE_MAGIC': 'WHT actions',
    'BLACK_MAGIC': 'BLK actions',
    'SUMMONING':   'SUM actions',
}

_CAST_CONDNAME_MAP = {
    'physicalDamageAbilities': 'PHY attacks',
    'magicDamageAbilities':    'BLK, WHT, BLU, SUM or NAT attacks that deal magical damage',
    'ninjutsuAbilities':       'Ninjutsu abilities',
}

_EXERCISE_TYPE_MAP = {
    'WHITE_MAGIC': 'WHT actions',
    'BLACK_MAGIC': 'BLK actions',
}

# INCREASE_EXECUTED_HEAL heal-factor → % boost
_HEAL_FACTORS = {'SMALL': 10, 'MEDIUM': 20, 'LARGE': 30}

# INCREASE_EXECUTED_DAMAGE / COUNT scaling damage-factor → % boost
_EXEC_DAMAGE_FACTORS = {
    'EXTRA_SMALL_105': 5,  'EXTRA_SMALL': 9,   'EXTRA_SMALL_110': 10,
    'SMALL': 15,           'SMALL_120': 20,     'SMALL_125': 25,
    'MEDIUM': 30,          'LARGE': 50,
}

# ATTACH_ELEMENT_KIWAMI additionalFactor → % bonus
_KIWAMI_FACTORS = {
    'EXTRA_SMALL': 10, 'EXTRA_SMALL_110': 10,
    'SMALL': 20,       'SMALL_120': 25,
    'MEDIUM': 30,      'LARGE': 50,
}

# INCREASE_STATUS.MAX_HP boost values
_MAX_HP_VALUES = {'SMALL': 1500, 'MEDIUM': 3000, 'LARGE': 5000}

# Number words for chase-ability count (multiple:N)
_COUNT_WORDS = {1: 'a', 2: 'two', 3: 'three', 4: 'four', 5: 'five'}


def _ubm_cast_cond(obj):
    """Return human-readable cast-time condition string from an effect object."""
    # anyCondName:[...] — array of named conditions
    m_anycond = re.search(r'anyCondName:\[([^\]]+)\]', obj)
    if m_anycond:
        names = re.findall(r'"(\w+)"', m_anycond.group(1))
        return ' and '.join(_CAST_CONDNAME_MAP.get(n, n) for n in names)

    # condName:"..." — single named condition
    m_cond = re.search(r'condName:"(\w+)"', obj)
    if m_cond:
        return _CAST_CONDNAME_MAP.get(m_cond.group(1), m_cond.group(1))

    # anyExerciseTypes:[...]
    m_ex = re.search(r'anyExerciseTypes:\[([^\]]+)\]', obj)
    if m_ex:
        types = re.findall(r'EXERCISE_TYPE\.(\w+)', m_ex.group(1))
        parts = [_EXERCISE_TYPE_MAP.get(t, t.replace('_', ' ').title()) for t in types]
        return _ubm_list_str(parts, 'or')

    # anyCategoryIds / categoryId
    cats = re.findall(r'ABILITY_CATEGORY_ID(?:_OF)?\.([A-Z_]+)', obj)
    if cats:
        if len(cats) == 1 and cats[0] in _CAST_COND_ABBREV:
            return _CAST_COND_ABBREV[cats[0]]
        names = [ABILITY_CATEGORY_ID_NAMES.get(c, c.title()) for c in cats]
        return _ubm_list_str(names, 'or') + ' abilities'

    # anyElementIds
    elems = re.findall(r'ELEMENT_TYPE\.([A-Z]+)', obj)
    if elems:
        names = list(dict.fromkeys(ELEMENT_NAMES.get(e, e.title()) for e in elems))
        return _ubm_list_str(names, 'or') + ' abilities'

    return None


def _ubm_ability_cond(obj):
    """Return human-readable ability condition for chase/seq effects."""
    cats = re.findall(r'ABILITY_CATEGORY_ID(?:_OF)?\.([A-Z_]+)', obj)
    if cats:
        names = list(dict.fromkeys(ABILITY_CATEGORY_ID_NAMES.get(c, c.title()) for c in cats))
        return _ubm_list_str(names, 'or')

    m_ex = re.search(r'anyExerciseTypes:\[([^\]]+)\]', obj)
    if m_ex:
        types = re.findall(r'EXERCISE_TYPE\.(\w+)', m_ex.group(1))
        exercise_cat = {'WHITE_MAGIC': 'White Magic', 'BLACK_MAGIC': 'Black Magic'}
        return _ubm_list_str([exercise_cat.get(t, t.title()) for t in types], 'or')

    elems = re.findall(r'ELEMENT_TYPE\.([A-Z]+)', obj)
    if elems:
        names = list(dict.fromkeys(ELEMENT_NAMES.get(e, e.title()) for e in elems))
        return _ubm_list_str(names, 'or')

    return None


def _ubm_spirit_name(char_name, elements, extra_parts):
    """Build 'Spirit Attack: X', 'Spirit Attack: X (Y)', or 'Spirit Attack: X (Y) II'."""
    # char_name already has a qualifier in parens (e.g. "Cecil (Paladin)") — use as-is.
    if '(' in char_name:
        return f'Spirit Attack: {char_name}'

    version     = [p for p in extra_parts if p in _ROMAN_NUMERALS_SET]
    non_version = [p for p in extra_parts if p not in _ROMAN_NUMERALS_SET]

    # Build parenthesised qualifier from elements + non-version extras
    paren_parts = []
    if elements:
        paren_parts.append('/'.join(elements))
    if non_version:
        paren_parts.append(' '.join(_cap_word(w) for w in non_version))

    if paren_parts:
        name = f'Spirit Attack: {char_name} ({", ".join(paren_parts)})'
        if version:
            name += ' ' + ' '.join(version)
    elif version:
        # Version is the only qualifier — goes in parens
        name = f'Spirit Attack: {char_name} ({" ".join(version)})'
    else:
        name = f'Spirit Attack: {char_name}'
    return name


def _ubm_parse_chase(obj, spirit_name, react_all=False):
    """Build the chase-ability description from an effect object."""
    cond = _ubm_ability_cond(obj)
    m_multi = re.search(r'multiple:(\d+)', obj)
    m_done  = re.search(r'chaseAbilityDoneCountForIsDone:(\d+)', obj)

    if react_all:
        cond_str = f'a {cond} ability' if cond else 'an ability'
        phrase = f'casts {spirit_name} after another ally uses {cond_str}'
    elif m_multi:
        n = int(m_multi.group(1))
        count_word   = _COUNT_WORDS.get(n, str(n))
        ability_word = 'ability' if n == 1 else 'abilities'
        cond_str = f' {cond}' if cond else ''
        phrase = f'casts {spirit_name} after using {count_word}{cond_str} {ability_word}'
    else:
        cond_str = f' {cond}' if cond else ''
        phrase = f'casts {spirit_name} after using a{cond_str} ability'

    if m_done:
        phrase += f' (max {m_done.group(1)})'
    return phrase


def _ubm_parse_scaling_damage(effect_blocks):
    """Handle COUNT_ABILITY_USED + scaling INCREASE_EXECUTED_DAMAGE pair."""
    count_blk = exec_blk = None
    for blk in effect_blocks:
        m = re.search(r'type:o\.(\w+)', blk)
        if not m:
            continue
        if m.group(1) == 'COUNT_ABILITY_USED':
            count_blk = blk
        elif m.group(1) == 'INCREASE_EXECUTED_DAMAGE' and 'generalValueToAbilityDamageRateMap' in blk:
            exec_blk = blk
    if not count_blk or not exec_blk:
        return None

    # What abilities are counted
    count_elems = re.findall(r'ELEMENT_TYPE\.([A-Z]+)', count_blk)
    count_cond  = _ubm_list_str(
        list(dict.fromkeys(ELEMENT_NAMES.get(e, e.title()) for e in count_elems)), 'or'
    ) if count_elems else None

    # Parse tier table (greaterEqual + factor key), sorted ascending by count
    tiers = re.findall(r'greaterEqual:(\d+)\}.*?DAMAGE_FACTOR\.(\w+)', exec_blk)
    if not tiers:
        return None
    tiers_sorted = sorted(tiers, key=lambda x: int(x[0]))
    pcts   = [str(_EXEC_DAMAGE_FACTORS.get(t[1], 0)) for t in tiers_sorted]
    counts = [t[0] for t in tiers_sorted]
    count_strs = counts[:-1] + [f'{counts[-1]}+']

    exec_elems = re.findall(r'ELEMENT_TYPE\.([A-Z]+)', exec_blk)
    exec_cond  = _ubm_list_str(
        list(dict.fromkeys(ELEMENT_NAMES.get(e, e.title()) for e in exec_elems)), 'or'
    ) if exec_elems else count_cond

    cond_str = f'{exec_cond} abilities' if exec_cond else 'abilities'
    count_cond_str = f' {count_cond}' if count_cond else ''
    return f'{cond_str} deal {"/".join(pcts)}% more damage after using {"/".join(count_strs)}{count_cond_str} abilities'


def _ubm_parse_effect(obj, spirit_name, status_lookup):
    """Parse one effect object block → text fragment, or None to skip."""
    m_type = re.search(r'type:o\.(\w+)', obj)
    if not m_type:
        return None
    etype = m_type.group(1)

    if etype == 'ATTACH_ELEMENT_KIWAMI':
        elems_raw = re.findall(r'ELEMENT_TYPE\.([A-Z]+)', obj)
        elems = list(dict.fromkeys(ELEMENT_NAMES.get(e, e.title()) for e in elems_raw))
        m_f = re.search(r'DAMAGE_FACTOR\.(\w+)', obj)
        pct = _KIWAMI_FACTORS.get(m_f.group(1), 20) if m_f else 20
        return f'Increases [{"/".join(elems)} Infusion] damage bonus by {pct}%'

    if etype == 'REGISTER_CHASE_ABILITY_WHEN_ABILITY_DONE':
        return _ubm_parse_chase(obj, spirit_name)

    if etype == 'REGISTER_CHASE_ABILITY_WHEN_ABILITY_DONE_REACT_ALL_ACTOR':
        return _ubm_parse_chase(obj, spirit_name, react_all=True)

    if etype == 'REGISTER_ABILITY_WHEN_UNSET_SA':
        return f'casts {spirit_name} when the status is removed'

    if etype == 'REGISTER_CHASE_ABILITY_WHEN_CONSUME_DAMAGE_REDUCTION_BARRIER':
        m_done = re.search(r'chaseAbilityDoneCountForIsDone:(\d+)', obj)
        phrase = f'casts {spirit_name} when any Damage Reduction Barrier is removed'
        if m_done:
            phrase += f' (max {m_done.group(1)})'
        return phrase

    if etype == 'INCREASE_CAST_TIME_FACTOR':
        m_f = re.search(r'CAST_TIME_FACTOR\.(\w+)', obj)
        factor = CAST_TIME_FACTORS.get(m_f.group(1), 110) if m_f else 110
        cond = _ubm_cast_cond(obj)
        return f'cast speed {cast_factor_str(factor)}' + (f' for {cond}' if cond else '')

    if etype == 'REGISTER_SEQ_ABILITY_WHEN_ABILITY_DONE':
        cond = _ubm_ability_cond(obj)
        cond_str = f'{cond} abilities' if cond else 'abilities'
        return f'{cond_str} trigger 1 additional time, Hero Abilities have zero hone cost'

    if etype == 'INCREASE_STATUS':
        if 'maxHp' in obj:
            m_v = re.search(r'MAX_HP\.(\w+)', obj)
            val = _MAX_HP_VALUES.get(m_v.group(1), 1500) if m_v else 1500
            return f'maximum HP +{val}'
        return None

    if etype == 'INFLICT_SA_AT_NEXT_ACTION':
        m_sa = re.search(r'saIds:\[([^\]]+)\]', obj)
        status_names = []
        if m_sa:
            for sa_id in re.findall(r'i\.([A-Z_]+)', m_sa.group(1)):
                name = status_lookup.get(sa_id)
                if name:
                    status_names.append(f'[{name}]')
        status_str = _ubm_list_str(status_names, 'and') if status_names else 'a status'
        return f'grants {status_str} after taking the next action'

    if etype == 'INCREASE_CRITICAL_DAMAGE' or etype == 'INCREASE_CRITICAL_DAMAGE_CAN_DUPLICATE':
        m_v = re.search(r'criticalDamageFactor:(\d+)', obj)
        return f'critical damage +{m_v.group(1)}%' if m_v else 'increases critical damage'

    if etype == 'INCREASE_CRITICAL_RATE':
        m_v = re.search(r'criticalRate:(\d+)', obj)
        return f'critical hit rate +{m_v.group(1)}%' if m_v else 'increases critical hit rate'

    if etype == 'INCREASE_EXECUTED_DAMAGE' and 'generalValueToAbilityDamageRateMap' not in obj:
        m_f = re.search(r'DAMAGE_FACTOR\.(\w+)', obj)
        pct = _EXEC_DAMAGE_FACTORS.get(m_f.group(1), 30) if m_f else 30
        m_turns = re.search(r'turnCountForIsDone:(\d+)', obj)
        is_phys = 'isPhysicalAttack:!0' in obj
        cond_str = 'PHY ' if is_phys else ''
        phrase = f'increases {cond_str}damage dealt by {pct}%'
        if m_turns:
            phrase += f' (max {m_turns.group(1)} turns)'
        return phrase

    if etype == 'INCREASE_EXECUTED_HEAL':
        m_f = re.search(r'HEAL_FACTOR\.(\w+)', obj)
        pct = _HEAL_FACTORS.get(m_f.group(1), 20) if m_f else 20
        cond = _ubm_cast_cond(obj) or _ubm_ability_cond(obj)
        cond_str = f'{cond} ' if cond else ''
        return f'{cond_str}restore {pct}% more HP'

    # COUNT_ABILITY_USED and scaling INCREASE_EXECUTED_DAMAGE are handled as a pair
    return None


_UBM_DEFS_CACHE = None

def _get_ubm_defs():
    global _UBM_DEFS_CACHE
    if _UBM_DEFS_CACHE is None:
        _UBM_DEFS_CACHE = _parse_js_ultimate_buddy_defs()
    return _UBM_DEFS_CACHE


def _parse_js_ultimate_buddy_defs():
    """Parse every ULTIMATE_BUDDY_MODE_* object definition from battle_js.txt."""
    if not BATTLE_JS_FILE.exists():
        return {}
    with open(BATTLE_JS_FILE, encoding='utf-8') as f:
        js = f.read()

    status_lookup = _get_status_name_lookup()
    result = {}

    for m in re.finditer(r'p\[i\.(ULTIMATE_BUDDY_MODE_[A-Z0-9_]+)\]=\{', js):
        coded_name = m.group(1)

        # Extract the full object block via bracket counting
        pos = js.index('{', m.start())
        depth, end = 0, pos
        for j, ch in enumerate(js[pos:], pos):
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    end = j + 1
                    break
        block = js[pos:end]

        # Extract the effects array content via bracket counting
        eff_idx = block.find('effects:[')
        if eff_idx < 0:
            continue
        arr_pos = eff_idx + len('effects:')  # points at '['
        depth2, arr_end = 0, arr_pos
        for j, ch in enumerate(block[arr_pos:], arr_pos):
            if ch == '[':
                depth2 += 1
            elif ch == ']':
                depth2 -= 1
                if depth2 == 0:
                    arr_end = j + 1
                    break
        effect_blocks = _extract_object_blocks(block[arr_pos + 1:arr_end - 1])

        # Derive spirit-attack name from coded-name suffix
        suffix = coded_name[len('ULTIMATE_BUDDY_MODE_'):]
        char_name, elements, extra_parts = char_name_from_suffix(suffix)
        spirit_name = _ubm_spirit_name(char_name, elements, extra_parts)

        # Handle COUNT_ABILITY_USED + scaling INCREASE_EXECUTED_DAMAGE pair
        scaling_text = _ubm_parse_scaling_damage(effect_blocks)
        scaling_used = False

        effects_parts = []
        for obj in effect_blocks:
            m_type = re.search(r'type:o\.(\w+)', obj)
            if not m_type:
                continue
            etype = m_type.group(1)

            if etype == 'COUNT_ABILITY_USED':
                continue  # handled via scaling_text

            if etype == 'INCREASE_EXECUTED_DAMAGE' and 'generalValueToAbilityDamageRateMap' in obj:
                if scaling_text and not scaling_used:
                    effects_parts.append(scaling_text)
                    scaling_used = True
                continue

            part = _ubm_parse_effect(obj, spirit_name, status_lookup)
            if part:
                effects_parts.append(part)

        # If no REGISTER_SEQ_ABILITY_WHEN_ABILITY_DONE was present, the zero hone
        # cost wasn't folded in above — add it standalone.
        has_seq = any(
            re.search(r'type:o\.REGISTER_SEQ_ABILITY_WHEN_ABILITY_DONE\b', blk)
            for blk in effect_blocks
        )
        if not has_seq:
            effects_parts.append('Hero Abilities have zero hone cost')

        effects_parts.append("removed if the character hasn't [Zenith Mode]")
        result[coded_name] = {'Effects': ', '.join(effects_parts), 'Default Duration': '-'}

    return result


# ---------------------------------------------------------------------------
# ACCEL_BUDDY_MODE JS parser
# ---------------------------------------------------------------------------

def _extract_balanced_block(text, start, open_ch, close_ch):
    """Extract one balanced open/close block starting at position start."""
    depth = 0
    for i in range(start, len(text)):
        ch = text[i]
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return None


def _accel_spirit_name(char_name, elements, extra_parts):
    """Build 'Roaring X' or 'Roaring X (Y/Z)' for Accel Mode spirit attacks."""
    if '(' in char_name:
        return f'Roaring {char_name}'
    version     = [p for p in extra_parts if p in _ROMAN_NUMERALS_SET]
    non_version = [p for p in extra_parts if p not in _ROMAN_NUMERALS_SET]
    paren_parts = []
    if elements:
        paren_parts.append('/'.join(elements))
    if non_version:
        paren_parts.append(' '.join(_cap_word(w) for w in non_version))
    name = f'Roaring {char_name}'
    if paren_parts:
        name += f' ({", ".join(paren_parts)})'
        if version:
            name += ' ' + ' '.join(version)
    elif version:
        name += ' ' + ' '.join(version)
    return name


def _accel_parse_cond(cond_obj):
    """Parse a condition object string → human-readable 'X or Y abilities'."""
    if not cond_obj:
        return 'abilities'
    is_physical = bool(re.search(r'isPhysicalAttack:!0', cond_obj))
    is_flight   = bool(re.search(r'isFlightAttack:!0',   cond_obj))

    cats = re.findall(r'ABILITY_CATEGORY_ID(?:_OF)?\.([A-Z_]+)', cond_obj)
    if cats:
        names = list(dict.fromkeys(
            ABILITY_CATEGORY_ID_NAMES.get(c, c.replace('_', ' ').title()) for c in cats))
        return _ubm_list_str(names, 'or') + ' abilities'

    elems = re.findall(r'ELEMENT_TYPE\.([A-Z]+)', cond_obj)

    if is_flight:
        if elems:
            names = list(dict.fromkeys(ELEMENT_NAMES.get(e, e.title()) for e in elems))
            return _ubm_list_str(names, 'or') + ' Jump abilities'
        return 'Jump abilities'

    if is_physical and elems:
        names = list(dict.fromkeys(ELEMENT_NAMES.get(e, e.title()) for e in elems))
        return _ubm_list_str(names, 'or') + ' PHY abilities'

    if elems:
        names = list(dict.fromkeys(ELEMENT_NAMES.get(e, e.title()) for e in elems))
        return _ubm_list_str(names, 'or') + ' abilities'

    if is_physical:
        return 'PHY abilities'
    return 'abilities'


def _accel_cond_from_effect(effect_obj):
    """Extract and parse abilityCondition:{...} from within an effect object."""
    m = re.search(r'abilityCondition:\{', effect_obj)
    if not m:
        return None
    cond = _extract_balanced_block(effect_obj, m.end() - 1, '{', '}')
    return _accel_parse_cond(cond) if cond else None


def _accel_parse_effect(effect_obj, spirit_name):
    """Parse a single p()-entry effect object → human-readable string or None."""
    m_type = re.search(r'type:u\.(\w+)', effect_obj)
    if not m_type:
        return None
    etype = m_type.group(1)

    if etype == 'INCREASE_CAST_TIME_FACTOR':
        m_f = re.search(r'CAST_TIME_FACTOR\.(\w+)', effect_obj)
        factor = CAST_TIME_FACTORS.get(m_f.group(1), 200) if m_f else 200
        cond_str = _accel_cond_from_effect(effect_obj) or 'abilities'
        if factor >= 1000000:
            return f'instant cast for {cond_str}'
        return f'{cast_factor_str(factor)} cast speed for {cond_str}'

    if etype == 'REGISTER_CHASE_ABILITY_WHEN_ABILITY_DONE':
        cond_str = _accel_cond_from_effect(effect_obj) or 'abilities'
        m_done = re.search(r'chaseAbilityDoneCountForIsDone:(\d+)', effect_obj)
        phrase = f'casts [{spirit_name}] after using {cond_str}'
        if m_done:
            phrase += f' (max {m_done.group(1)})'
        return phrase

    if etype == 'REGISTER_CHASE_ABILITY_WHEN_CONSUME_DAMAGE_REDUCTION_BARRIER':
        m_done = re.search(r'chaseAbilityDoneCountForIsDone:(\d+)', effect_obj)
        phrase = f'casts [{spirit_name}] when a Barrier absorbs damage'
        if m_done:
            phrase += f' (max {m_done.group(1)})'
        return phrase

    if etype == 'INCREASE_DAMAGE_THRESHOLD_LV':
        cond_str = _accel_cond_from_effect(effect_obj) or 'abilities'
        return f'raises damage cap for {cond_str}'

    return None


def _parse_accel_buddy_mode_js():
    """Parse all ACCEL_BUDDY_MODE entries from battle_js.txt.

    Returns {coded_name -> {'Effects': str}}.

    The four helper-function types (letters change with each minification):
      d-type  — REGISTER_CHASE_ABILITY_WHEN_ABILITY_DONE (detected by chaseAbilityId:void 0)
      m-type  — INCREASE_CAST_TIME_FACTOR MEDIUM          (detected by CAST_TIME_FACTOR.MEDIUM)
      v-type  — COUNT_ABILITY_USED + scaling damage       (detected by COUNT_ABILITY_USED)
      p-type  — explicit effects array                    (detected by n.each(r.effects)
    All four always have hasAbilityBoost:!0.
    """
    if not BATTLE_JS_FILE.exists():
        return {}
    with open(BATTLE_JS_FILE, encoding='utf-8') as f:
        js = f.read()

    # Locate the first ACCEL assignment to find the preamble region.
    first_m = re.search(r'[a-z]\[s\.(ACCEL_BUDDY_MODE_\w+)\]=([a-z])\(', js)
    if not first_m:
        return {}
    preamble = js[max(0, first_m.start() - 6000):first_m.start()]

    # Detect which single letter corresponds to each function type by extracting
    # each function's body with balanced-brace counting (robust to nesting).
    fn_map = {}  # letter -> 'chase'|'cast'|'boost'|'passthrough'
    for fn_m in re.finditer(r',([a-z])=function\b[^(]*\(', preamble):
        letter = fn_m.group(1)
        if letter in fn_map:
            continue
        rest = preamble[fn_m.end():]
        brace_i = rest.find('{')
        if brace_i == -1:
            continue
        body = _extract_balanced_block(rest, brace_i, '{', '}')
        if not body:
            continue
        if 'chaseAbilityId:void 0' in body:
            fn_map[letter] = 'chase'
        elif 'CAST_TIME_FACTOR.MEDIUM' in body:
            fn_map[letter] = 'cast'
        elif 'COUNT_ABILITY_USED' in body:
            fn_map[letter] = 'boost'
        elif '.each(r.effects' in body:
            fn_map[letter] = 'passthrough'

    result = {}

    for m in re.finditer(r'[a-z]\[s\.(ACCEL_BUDDY_MODE_\w+)\]=([a-z])\(', js):
        coded_name = m.group(1)
        fn_letter  = m.group(2)
        fn_type    = fn_map.get(fn_letter, 'unknown')

        suffix = coded_name[len('ACCEL_BUDDY_MODE_'):]
        char_name, elements, extra_parts = char_name_from_suffix(suffix)
        spirit = _accel_spirit_name(char_name, elements, extra_parts)

        # Extract arg1 (condition object) starting just after the opening '('
        rest = js[m.end():]
        try:
            brace1 = rest.index('{')
        except ValueError:
            continue
        arg1 = _extract_balanced_block(rest, brace1, '{', '}')
        if not arg1:
            continue

        cond_str = _accel_parse_cond(arg1)
        boost_line = f'{cond_str} deal 15/20/25/30/50% more damage at ability rank 1/2/3/4/5'
        effects_parts = [boost_line]

        if fn_type == 'chase':
            effects_parts.append(f'casts [{spirit}] after using {cond_str}')

        elif fn_type == 'cast':
            effects_parts.append(f'x2.00 cast speed for {cond_str}')

        elif fn_type == 'boost':
            effects_parts.append(
                f'10/20/30% more damage for {cond_str} after using 1/2/3')

        elif fn_type == 'passthrough':
            # Extract arg2 (options object with effects array)
            rest2 = rest[brace1 + len(arg1):]
            try:
                brace2 = rest2.index('{')
            except ValueError:
                pass
            else:
                arg2 = _extract_balanced_block(rest2, brace2, '{', '}')
                if arg2:
                    eff_idx = arg2.find('effects:[')
                    if eff_idx != -1:
                        arr_start = arg2.index('[', eff_idx)
                        arr = _extract_balanced_block(arg2, arr_start, '[', ']')
                        if arr:
                            for eff_obj in _extract_object_blocks(arr[1:-1]):
                                text = _accel_parse_effect(eff_obj, spirit)
                                if text:
                                    effects_parts.append(text)

        effects_parts.append("removed if the character hasn't [Accel Mode]")
        result[coded_name] = {'Effects': ', '.join(effects_parts)}

    return result


_ACCEL_DEFS_CACHE = None

def _get_accel_defs():
    global _ACCEL_DEFS_CACHE
    if _ACCEL_DEFS_CACHE is None:
        _ACCEL_DEFS_CACHE = _parse_accel_buddy_mode_js()
    return _ACCEL_DEFS_CACHE


# ---------------------------------------------------------------------------
# Pattern handlers
# Return dict with keys 'Common Name', 'Effects', 'Default Duration'
# (only the fields that were inferred; caller merges with existing data)
# Return None if pattern doesn't apply.
# ---------------------------------------------------------------------------

def pattern_accel_buddy_mode(cn):
    PREFIX = 'ACCEL_BUDDY_MODE_'
    if not cn.startswith(PREFIX) or cn == 'ACCEL_BUDDY_MODE':
        return None
    suffix = cn[len(PREFIX):]
    char_name, elements, extra_parts = char_name_from_suffix(suffix)
    elem_str = '/'.join(elements)
    version_list = [p for p in extra_parts if p in _ROMAN_NUMERALS_SET]
    non_version  = [p for p in extra_parts if p not in _ROMAN_NUMERALS_SET]
    qualifier_parts = []
    if elem_str:
        qualifier_parts.append(elem_str)
    if non_version:
        qualifier_parts.append(' '.join(_cap_word(w) for w in non_version))
    if qualifier_parts:
        common_name = f"Accel Mode: {char_name} ({', '.join(qualifier_parts)})"
    else:
        common_name = f"Accel Mode: {char_name}"
    if version_list:
        common_name += ' ' + ' '.join(version_list)

    accel_info = _get_accel_defs().get(cn)
    if accel_info:
        effects = accel_info['Effects']
    else:
        effects = (f"Grants Accel Mode for {char_name}, "
                   f"removed if the character hasn't [Accel Mode]")
    return {'Common Name': common_name, 'Effects': effects, 'Default Duration': '-'}


def pattern_ultimate_buddy_mode(cn):
    PREFIX = 'ULTIMATE_BUDDY_MODE_'
    if not cn.startswith(PREFIX) or cn == 'ULTIMATE_BUDDY_MODE':
        return None
    suffix = cn[len(PREFIX):]
    char_name, elements, extra_parts = char_name_from_suffix(suffix)
    elem_str = '/'.join(elements)
    version_parts_list = [p for p in extra_parts if p in _ROMAN_NUMERALS_SET]
    non_version = [p for p in extra_parts if p not in _ROMAN_NUMERALS_SET]
    qualifier_parts = []
    if elem_str:
        qualifier_parts.append(elem_str)
    if non_version:
        qualifier_parts.append(' '.join(_cap_word(w) for w in non_version))
    if qualifier_parts:
        common_name = f"Zenith Mode: {char_name} ({', '.join(qualifier_parts)})"
    else:
        common_name = f"Zenith Mode: {char_name}"
    if version_parts_list:
        common_name += ' ' + ' '.join(version_parts_list)

    # Use JS-parsed effects when available
    ubm_info = _get_ubm_defs().get(cn)
    if ubm_info:
        effects = ubm_info['Effects']
    else:
        effects = f"Grants Zenith Mode for {char_name}, removed if the character hasn't [Zenith Mode]"

    return {'Common Name': common_name, 'Effects': effects, 'Default Duration': '-'}


def pattern_master_buddy_mode(cn):
    PREFIX = 'MASTER_BUDDY_MODE_'
    if not cn.startswith(PREFIX) or cn == 'MASTER_BUDDY_MODE':
        return None
    suffix = cn[len(PREFIX):]
    char_name, elements, _ = char_name_from_suffix(suffix)
    elem_str = '/'.join(elements)
    common_name = f"Master Mode: {char_name}"
    effects = (
        f"Casts Star Strike: {char_name}"
        + (f" ({elem_str})" if elem_str else "")
        + " every 2s (max 5), grants Damage Cap +10000/+20000/+30000/+40000/+50000 after 1/2/3/4/5 chases, "
        "cast speed x1.20, removed if the character hasn't [Master Mode]"
    )
    return {'Common Name': common_name, 'Effects': effects, 'Default Duration': '-'}


def pattern_crystal_buddy_mode(cn):
    PREFIX = 'CRYSTAL_BUDDY_MODE_'
    if not cn.startswith(PREFIX) or cn == 'CRYSTAL_BUDDY_MODE':
        return None
    suffix = cn[len(PREFIX):]
    char_name, elements, _ = char_name_from_suffix(suffix)
    elem_str = '/'.join(elements)
    if elem_str:
        common_name = f"Crystal Force Mode: {char_name} ({elem_str})"
        effects = (
            f"{elem_str} abilities don't consume uses and deal 5/10/15/20/30% more damage at ability rank 1/2/3/4/5, "
            f"{elem_str} abilities trigger 1 additional time, "
            f"cast speed x1.20 for {elem_str} abilities, "
            f"removed if the character hasn't [Crystal Force Mode]"
        )
    else:
        common_name = f"Crystal Force Mode: {char_name}"
        effects = f"Grants Crystal Force Mode buffs for {char_name}, removed if the character hasn't [Crystal Force Mode]"
    return {'Common Name': common_name, 'Effects': effects, 'Default Duration': '-'}


def pattern_limit_break_soul_drive_mode(cn):
    PREFIX = 'LIMIT_BREAK_SOUL_DRIVE_MODE_'
    if not cn.startswith(PREFIX) or cn == 'LIMIT_BREAK_SOUL_DRIVE_MODE':
        return None
    suffix = cn[len(PREFIX):]
    char_name, elements, _ = char_name_from_suffix(suffix)
    common_name = f"Soul Drive Mode: {char_name}"
    effects = (
        "Reduces the SB points cost for Soul Breaks by 250, "
        "instant cast speed for Soul Breaks, cast speed x1.20, "
        "removed if the character hasn't [Soul Drive Mode]"
    )
    return {'Common Name': common_name, 'Effects': effects, 'Default Duration': '-'}


def pattern_tactical_awake_mode(cn):
    PREFIX = 'TACTICAL_AWAKE_MODE_'
    if not cn.startswith(PREFIX) or cn == 'TACTICAL_AWAKE_MODE':
        return None
    suffix = cn[len(PREFIX):]
    char_name, elements, _ = char_name_from_suffix(suffix)
    elem_str = '/'.join(elements)
    common_name = f"Tactical Awoken Mode: {char_name}"
    effects = (
        f"{elem_str + ' ' if elem_str else ''}abilities deal 30% more damage, "
        "have +10000 damage cap, deal 5/10/15/20/30% more damage at ability rank 1/2/3/4/5, "
        "trigger 1 additional time, removed if the character hasn't [Tactical Awoken Mode]"
    )
    return {'Common Name': common_name, 'Effects': effects, 'Default Duration': '-'}


def pattern_enhance_shin_ougi(cn):
    PREFIX = 'ENHANCE_SHIN_OUGI_FOR_'
    if not cn.startswith(PREFIX) or cn == 'ENHANCE_SHIN_OUGI_FOR':
        return None
    suffix = cn[len(PREFIX):]
    char_name, elements, _ = char_name_from_suffix(suffix)
    common_name = f"Arcane Dyad Empowered: {char_name}"
    effects = (
        f"Keeps track of the number of Arcane Dyad uses for {char_name} (0~2), "
        "removed after using the Arcane Dyad two times"
    )
    return {'Common Name': common_name, 'Effects': effects, 'Default Duration': '-'}


def _school_from_raw(school_raw):
    """Convert a raw suffix like ELEMENT_HOLY_ABILITY or BLACK_MAGIC into a display string."""
    if school_raw.startswith('ELEMENT_'):
        parts = school_raw.split('_')
        elem_names = [ELEMENT_NAMES[p] for p in parts if p in ELEMENT_NAMES]
        return ', '.join(elem_names) if elem_names else school_raw.replace('_', ' ').title()
    return ABILITY_NAMES.get(school_raw, school_raw.replace('_', ' ').title())


def pattern_change_cast_time(cn):
    if not cn.startswith('CHANGE_CAST_TIME_'):
        return None

    parts = cn.split('_')
    # CHANGE(0) CAST(1) TIME(2) SPEED_CODE(3) ...
    speed_code = parts[3] if len(parts) > 3 else None

    if not speed_code:
        speed_str = 'xN'
    elif speed_code == 'MAX':
        speed_str = 'instant'
    elif speed_code.isdigit():
        speed_str = f'x{int(speed_code) / 100:.2f}'
    else:
        speed_str = f'x{speed_code}'

    # Extract duration from name
    duration = infer_duration_from_name(cn)

    # Everything after CHANGE_CAST_TIME_{speed_code}_
    prefix_len = len(f'CHANGE_CAST_TIME_{speed_code}_')
    remaining = cn[prefix_len:]

    school = None
    school_display = None  # used in common_name; may differ from school (used in effects)
    turns_n = None
    qualifier = None

    m_msec = re.match(r'(\d+)_MSEC(?:_(.*))?$', remaining)
    m_turn = re.match(r'(\d+)_ABILITY_CATEGORY_ID_(.*)', remaining)
    m_turn2 = re.match(r'(\d+)_(.*)', remaining)
    m_time = re.match(r'TIME_\w+_(.*)', remaining)
    m_while = re.match(r'WHILE_(\w+)', remaining)

    if m_msec:
        ms = int(m_msec.group(1))
        duration = f"{ms // 1000} seconds"
        school_raw = m_msec.group(2) or ''
        if school_raw:
            school = _school_from_raw(school_raw)
    elif m_turn:
        school_raw = m_turn.group(2)
        school = _school_from_raw(school_raw)
        turns_n = int(m_turn.group(1))
        duration = f"{turns_n} turn{'s' if turns_n != 1 else ''}"
    elif m_turn2 and m_turn2.group(1).isdigit():
        school_raw = m_turn2.group(2)
        school = _school_from_raw(school_raw)
        turns_n = int(m_turn2.group(1))
        duration = f"{turns_n} turn{'s' if turns_n != 1 else ''}"
    elif m_while:
        while_content = m_while.group(1)  # e.g. 'TACTICAL_AWAKE_MODE_FIRE'
        while_parts = while_content.split('_')
        # Collect trailing element names
        while_elems = []
        i = len(while_parts) - 1
        while i >= 0 and while_parts[i] in ELEMENT_NAMES:
            while_elems.insert(0, ELEMENT_NAMES[while_parts[i]])
            i -= 1
        mode_key = '_'.join(while_parts[:i + 1])
        qualifier = WHILE_MODE_MAP.get(mode_key, f'(while {mode_key.replace("_", " ").title()})')
        if while_elems:
            school = ', '.join(while_elems)
            school_display = school + ' Ability'
        duration = '-'

    if speed_code == 'MAX':
        name_part = 'Instant Cast'
        effect_part = 'Cast speed x999999'
    elif speed_code == '300':
        name_part = 'High Quick Cast'
        effect_part = 'Cast speed x3.00'
    else:
        name_part = 'Quick Cast'
        effect_part = f'Cast speed {speed_str}'

    if school:
        turn_suffix = f" {turns_n}" if (duration and 'turn' in duration) else ''
        label = school_display if school_display else school
        common_name = f"{label} {name_part}{turn_suffix}"
        if qualifier:
            common_name += f" {qualifier}"
        effects = f"{effect_part} for {school} abilities"
    else:
        common_name = name_part
        if qualifier:
            common_name += f" {qualifier}"
        effects = effect_part

    return {
        'Common Name': common_name,
        'Effects': effects,
        'Default Duration': duration or '-',
    }


def pattern_increase_damage_by_ability(cn):
    PREFIX = 'INCREASE_EXECUTED_DAMAGE_BY_ABILITY_'
    if not cn.startswith(PREFIX):
        return None

    size_map = {'EXTRA_SMALL': '9%', 'SMALL': '15%', 'MEDIUM': '30%', 'LARGE': '50%'}
    rest = cn[len(PREFIX):]

    size = None
    for s in ['EXTRA_SMALL', 'SMALL', 'MEDIUM', 'LARGE']:
        if f'_{s}_' in rest or rest.endswith(f'_{s}'):
            size = s
            break

    pct = size_map.get(size, '15%') if size else '15%'
    school_raw = rest.split(f'_{size}')[0] if size else rest
    school = ABILITY_NAMES.get(school_raw, school_raw.replace('_', ' ').title())

    m = re.search(r'_TURN_(\d+)', cn)
    turns_n = int(m.group(1)) if m else None
    duration = (
        f"{turns_n} turn{'s' if turns_n != 1 else ''}" if turns_n
        else infer_duration_from_name(cn)
    )

    common_name = f"{school} +{pct} Boost" + (f" {turns_n}" if turns_n else "")
    effects = f"{school} abilities deal {pct} more damage"

    return {
        'Common Name': common_name,
        'Effects': effects,
        'Default Duration': duration or '-',
    }


def pattern_increase_atb_time_factor(cn):
    PREFIX = 'INCREASE_ATB_TIME_FACTOR_'
    if not cn.startswith(PREFIX):
        return None

    rest = cn[len(PREFIX):]
    speed_map2 = {
        'MAX':    ('Instant ATB',   'Increase ATB charge speed by x9999999'),
        'MEDIUM': ('200% ATB',      'Increase ATB charge speed by x2.00'),
        'LARGE':  ('300% ATB',      'Increase ATB charge speed by x3.00'),
    }
    speed = rest.split('_')[0]
    name_base, eff_base = speed_map2.get(speed, ('ATB Boost', 'Increases ATB charge speed'))

    m = re.search(r'_TURN_(\d+)', cn)
    turns_n = int(m.group(1)) if m else None
    duration = (
        f"{turns_n} turn{'s' if turns_n != 1 else ''}" if turns_n
        else infer_duration_from_name(cn) or '-'
    )
    suffix_str = f" {turns_n}" if turns_n else ""

    while_m = re.search(r'WHILE_(\w+)', cn)
    while_str = ""
    if while_m:
        while_str = f", removed if user hasn't [{while_m.group(1).replace('_', ' ').title()}]"
        duration = "-"

    common_name = name_base + suffix_str
    effects = eff_base + while_str

    return {
        'Common Name': common_name,
        'Effects': effects,
        'Default Duration': duration,
    }


def pattern_used_ability_counter(cn):
    PREFIX = 'USED_ABILITY_COUNTER_'
    if not cn.startswith(PREFIX):
        return None
    suffix = cn[len(PREFIX):]
    ability_name = suffix.replace('_', ' ').title()
    return {
        'Common Name': f"{ability_name} Uses",
        'Effects': f"Keeps track of the number of uses of {ability_name} (0~7)",
        'Default Duration': '25 seconds',
    }


def pattern_dual_awake_mode(cn):
    PREFIX = 'DUAL_AWAKE_MODE_'
    if not cn.startswith(PREFIX):
        return None
    rest = cn[len(PREFIX):]
    if rest.startswith('FIRST_'):
        mode_num, suffix = 'I', rest[len('FIRST_'):]
    elif rest.startswith('SECOND_'):
        mode_num, suffix = 'II', rest[len('SECOND_'):]
    else:
        return None

    char_name, elements, extra = char_name_from_suffix(suffix)
    elem_word = '/'.join(elements) if elements else ''

    if elem_word:
        common_name = f"Dual Awoken {elem_word} Mode {mode_num}: {char_name}"
        effects = (
            f"{elem_word} abilities deal 5/10/15/20/30% more damage at ability rank 1/2/3/4/5, "
            f"{elem_word} abilities trigger 1 additional time, "
            f"cast speed x1.20 for {elem_word} abilities, "
            f"removed if the character hasn't [Synchro Mode]"
        )
    else:
        common_name = f"Dual Awoken Mode {mode_num}: {char_name}"
        effects = f"Grants Dual Awoken Mode {mode_num} for {char_name}"

    return {
        'Common Name': common_name,
        'Effects': effects,
        'Default Duration': '15 seconds',
    }


def pattern_increase_executed_damage_element(cn):
    # Must NOT match the BY_ABILITY variant (handled above)
    if not cn.startswith('INCREASE_EXECUTED_DAMAGE_'):
        return None
    if cn.startswith('INCREASE_EXECUTED_DAMAGE_BY_ABILITY_'):
        return None

    size_map = {'EXTRA_SMALL': '9%', 'SMALL': '15%', 'MEDIUM': '30%', 'LARGE': '50%'}
    rest = cn[len('INCREASE_EXECUTED_DAMAGE_'):]

    size = None
    for s in ['EXTRA_SMALL', 'SMALL', 'MEDIUM', 'LARGE']:
        if f'_{s}' in rest:
            size = s
            break

    pct = size_map.get(size, '15%') if size else '15%'
    element_raw = rest.split(f'_{size}')[0] if size else rest
    element = ELEMENT_NAMES.get(element_raw, element_raw.replace('_', ' ').title())

    m = re.search(r'_TURN_(\d+)', cn)
    turns_n = int(m.group(1)) if m else None
    duration = (
        f"{turns_n} turn{'s' if turns_n != 1 else ''}" if turns_n
        else infer_duration_from_name(cn) or '-'
    )

    common_name = f"{element} +{pct} Boost" + (f" {turns_n}" if turns_n else "")
    effects = f"{element} attacks deal {pct} more damage"

    return {
        'Common Name': common_name,
        'Effects': effects,
        'Default Duration': duration,
    }


def pattern_seq_ability_repeat_element_while(cn):
    """SEQ_ABILITY_REPEAT_{n}_TIMES_FOR_ELEMENT_{ELEM[_ELEM2]}_MAX_{m}_WHILE_{MODE}
    Combined Dualcast + Instant Cast for elemental abilities in a specific mode."""
    m = re.match(
        r'SEQ_ABILITY_REPEAT_(\d+)_TIMES_FOR_ELEMENT_([A-Z_]+?)_MAX_(\d+)_WHILE_([A-Z_]+)$',
        cn
    )
    if not m:
        return None

    repeat_n = int(m.group(1))
    elem_raw = m.group(2)   # e.g. 'WIND' or 'FIRE_ICE'
    max_n    = int(m.group(3))
    mode_raw = m.group(4)   # e.g. 'TACTICAL_AWAKE_MODE'

    elem_parts = elem_raw.split('_')
    elems = [ELEMENT_NAMES[p] for p in elem_parts if p in ELEMENT_NAMES]
    if not elems:
        return None
    elem_str = ', '.join(elems)

    repeat_name = {1: 'Dualcast', 2: 'Triplecast'}.get(repeat_n, f'{repeat_n + 1}xcast')
    qualifier = WHILE_MODE_MAP.get(mode_raw, f'(while {mode_raw.replace("_", " ").title()})')
    duration = f'{max_n} turn{"s" if max_n != 1 else ""}'

    common_name = f'{repeat_name}, Instant Cast {elem_str} {qualifier}'
    effects = (
        f'{elem_str} abilities trigger an additional time; '
        f'Cast speed x999999 for {elem_str} abilities'
    )

    return {'Common Name': common_name, 'Effects': effects, 'Default Duration': duration}


def pattern_custom_param(cn):
    """CUSTOM_PARAM_[MULTI_]{params}_{duration?}[_FOR_{qualifier?}]
    Handles both MULTI (alternating param/val) and non-MULTI (shared single value) forms."""
    if not cn.startswith('CUSTOM_PARAM_'):
        return None

    STAT_DISPLAY = {
        'ATK': 'ATK', 'MATK': 'MAG', 'DEF': 'DEF', 'MDEF': 'RES',
        'MND': 'MND', 'CRITICAL': 'Critical chance', 'SPD': 'SPD',
        'ACC': 'ACC', 'EVA': 'EVA',
    }

    rest = cn[len('CUSTOM_PARAM_'):]
    is_multi = rest.startswith('MULTI_')
    if is_multi:
        rest = rest[len('MULTI_'):]

    # Strip trailing condition qualifier (_FOR_...)
    qualifier = None
    m_for = re.search(r'_FOR_([A-Z_]+)$', rest)
    if m_for:
        for_what = m_for.group(1)
        rest = rest[:m_for.start()]
        if 'TACTICAL' in for_what:
            qualifier = '(Tactical)'
        else:
            return None  # e.g. FOR_VALKYRIE_MODE — those entries have real names

    # Extract non-turns duration from trailing tokens
    duration = None
    dur_subs = [
        (r'_WITH_DURATION_LARGE$',  '25 seconds'),
        (r'_WITH_DURATION_(\d+)$',  lambda m: f'{int(m.group(1)) // 1000} seconds'),
        (r'_SMALL_(\d+)$',          lambda m: f'{int(m.group(1)) // 1000} seconds'),
        (r'_LARGE$',                '25 seconds'),
        (r'_(\d{4,5})$',            lambda m: f'{int(m.group(1)) // 1000} seconds'),
    ]
    for pat, repl in dur_subs:
        m = re.search(pat, rest)
        if m:
            duration = repl(m) if callable(repl) else repl
            rest = rest[:m.start()]
            break

    # Parse (display_name, signed_int_value) pairs
    params = []
    tokens = rest.split('_')

    if is_multi:
        # Format: PARAM_VAL_PARAM_VAL_... (each param has its own value)
        i = 0
        leftover = []
        while i < len(tokens):
            tok = tokens[i]
            if tok in STAT_DISPLAY and i + 1 < len(tokens):
                vt = tokens[i + 1]
                if vt.isdigit():
                    params.append((STAT_DISPLAY[tok], int(vt)))
                    i += 2
                    continue
                elif vt.startswith('M') and vt[1:].isdigit():
                    params.append((STAT_DISPLAY[tok], -int(vt[1:])))
                    i += 2
                    continue
            leftover.append(tok)
            i += 1
        # Leftover 1-2 digit tokens after all param/val pairs = turns count
        if not duration:
            for tok in leftover:
                if tok.isdigit() and 1 <= int(tok) <= 99:
                    n = int(tok)
                    duration = f'{n} turn{"s" if n != 1 else ""}'
                    break
    else:
        # Format: PARAM1[_PARAM2...]_VALUE  (all params share one value)
        val_idx = None
        for j in range(len(tokens) - 1, -1, -1):
            t = tokens[j]
            if t.isdigit() or (t.startswith('M') and t[1:].isdigit()):
                val_idx = j
                break
        if val_idx is None:
            return None
        vt = tokens[val_idx]
        val = -int(vt[1:]) if vt.startswith('M') else int(vt)
        for tok in tokens[:val_idx]:
            if tok in STAT_DISPLAY:
                params.append((STAT_DISPLAY[tok], val))

    if not params:
        return None

    # Group params by value, preserving first-occurrence order
    seen_order = []
    groups = {}
    for name, val in params:
        if val not in groups:
            groups[val] = []
            seen_order.append(val)
        groups[val].append(name)

    def names_str(names):
        if len(names) == 1:
            return names[0]
        if len(names) == 2:
            return f'{names[0]} and {names[1]}'
        return ', '.join(names[:-1]) + f' and {names[-1]}'

    effects_parts = []
    for val in seen_order:
        names = groups[val]
        regular = [n for n in names if n != 'Critical chance']
        has_crit = 'Critical chance' in names
        if regular:
            sign = '+' if val >= 0 else '-'
            effects_parts.append(f'{names_str(regular)} {sign}{abs(val)}%')
        if has_crit:
            effects_parts.append(f'Critical chance ={val}%')
    effects = ', '.join(effects_parts)

    # Build duration suffix for Common Name
    dur_suffix = ''
    if duration:
        m_sec = re.match(r'(\d+) seconds?', duration)
        m_turn = re.match(r'(\d+) turns?', duration)
        if m_sec:
            dur_suffix = f' ({m_sec.group(1)}s)'
        elif m_turn:
            dur_suffix = f' {m_turn.group(1)}'  # "100% Critical 2" style

    qual_suffix = f' {qualifier}' if qualifier else ''

    # Pure critical: "X% Critical..." format
    is_pure_critical = (len(params) == 1 and params[0][0] == 'Critical chance')
    if is_pure_critical:
        common_name = f'{params[0][1]}% Critical{dur_suffix}{qual_suffix}'
    else:
        common_name = f'{effects}{dur_suffix}{qual_suffix}'

    return {
        'Common Name': common_name,
        'Effects':     effects,
        'Default Duration': duration or '-',
    }


def pattern_increase_element_atk(cn):
    """INCREASE_ELEMENT_ATK_{ELEMENT}_{M?LEVEL}[_TIME_{DURATION}]
    Level N = N*10%. Positive = Buff, negative (MN) = Debuff.
    Duration: TIME_MEDIUM=15s, TIME_SMALL_5000=5s, TIME_SMALL_8000=8s."""
    if not cn.startswith('INCREASE_ELEMENT_ATK_'):
        return None

    TIME_MAP = {
        'MEDIUM':      '15 seconds',
        'SMALL_5000':  '5 seconds',
        'SMALL_8000':  '8 seconds',
    }

    rest = cn[len('INCREASE_ELEMENT_ATK_'):]  # e.g. FIRE_M4_TIME_MEDIUM

    # Extract optional TIME suffix
    duration = None
    m_time = re.search(r'_TIME_(.+)$', rest)
    if m_time:
        time_key = m_time.group(1)
        if time_key == '0':
            return None  # level-0 reset status, no meaningful inference
        duration = TIME_MAP.get(time_key)
        rest = rest[:m_time.start()]

    # Parse element and level: {ELEMENT}_{M?N}
    m = re.match(r'^([A-Z]+)_(M?)(\d+)$', rest)
    if not m:
        return None

    elem_raw, neg, level_str = m.group(1), m.group(2), m.group(3)
    elem = ELEMENT_NAMES.get(elem_raw)
    if not elem:
        return None
    level = int(level_str)
    if level == 0:
        return None
    pct = level * 10
    is_debuff = bool(neg)

    dur_suffix = f' ({TIME_MAP[m_time.group(1)].split()[0]}s)' if duration else ''

    if is_debuff:
        common_name = f'Debuff {elem} {pct}%{dur_suffix}'
        effects = f'Reduces {elem} damage dealt by {pct}%, cumulable'
    else:
        common_name = f'Buff {elem} {pct}%{dur_suffix}'
        effects = f'Increases {elem} damage dealt by {pct}%, cumulable'

    return {
        'Common Name':      common_name,
        'Effects':          effects,
        'Default Duration': duration or '-',
    }


# Ordered list of patterns (applied for Common Name generation and gap-filling)
PATTERNS = [
    pattern_accel_buddy_mode,                  # 1
    pattern_ultimate_buddy_mode,               # 2
    pattern_master_buddy_mode,                 # 3
    pattern_crystal_buddy_mode,                # 4
    pattern_limit_break_soul_drive_mode,       # 5
    pattern_tactical_awake_mode,               # 6
    pattern_enhance_shin_ougi,                 # 7
    pattern_change_cast_time,                  # 8
    pattern_increase_damage_by_ability,        # 9
    pattern_increase_atb_time_factor,          # 10
    pattern_used_ability_counter,              # 11
    pattern_dual_awake_mode,                            # 12
    pattern_increase_executed_damage_element,           # 13
    pattern_seq_ability_repeat_element_while,           # 14
    pattern_custom_param,                               # 15
    pattern_increase_element_atk,                       # 16
]

# ---------------------------------------------------------------------------
# Build reverse ailments map: ID (int) -> coded name string
# ---------------------------------------------------------------------------

def build_id_to_coded_name():
    if not AILMENTS_FILE.exists():
        return {}
    with open(AILMENTS_FILE, encoding='utf-8') as f:
        ailments = json.load(f)
    # ailments: { "CODED_NAME": id_int, ... }
    mapping = {}
    for name, id_val in ailments.items():
        try:
            id_int = int(id_val)
        except (ValueError, TypeError):
            continue
        # Keep earlier alphabetical name on collision
        if id_int not in mapping or name < mapping[id_int]:
            mapping[id_int] = name
    return mapping

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    with open(INPUT_FILE, encoding='utf-8') as f:
        data = json.load(f)

    id_to_coded_name = build_id_to_coded_name()

    # Primary source: JS-derived Effects/Duration from StatusAilmentsConfig block
    js_defs = parse_js_status_defs()
    # Secondary source: _.extend assignments (cast time, param boosts, etc.)
    extend_defs = parse_js_extend_defs()
    for name, info in extend_defs.items():
        if name not in js_defs:
            js_defs[name] = info
    # Tertiary source: object-style duration blocks
    js_durations = parse_js_durations()

    print(f"JS function defs loaded: {len(js_defs) - len(extend_defs)} entries")
    print(f"JS extend defs loaded:   {len(extend_defs)} entries")
    print(f"JS durations loaded:     {len(js_durations)} entries")

    output_rows = []
    inferred_counts = {
        'Coded Name':       0,
        'Common Name':      0,
        'Effects':          0,
        'Default Duration': 0,
    }

    for row in data:
        cn = row.get('Coded Name')
        coded_name_inferred = False

        # --- Step 1: fill coded name from battle.js if missing ---
        if is_blank(cn):
            try:
                id_int = int(float(str(row.get('ID', ''))))
            except (ValueError, TypeError):
                id_int = None
            if id_int and id_int in id_to_coded_name:
                cn = id_to_coded_name[id_int]
                coded_name_inferred = True
            else:
                continue  # no coded name available, skip
        else:
            cn = str(cn).strip()

        # Check if at least one target field is blank (or we just inferred coded name).
        # '-' is a valid duration; only truly empty duration triggers inference.
        needs_inference = coded_name_inferred or any(
            is_blank(row.get(k)) for k in ['Common Name', 'Effects']
        ) or not str(row.get('Default Duration', '')).strip()
        if not needs_inference:
            continue

        # --- Step 2a: get JS-derived Effects/Duration as primary source ---
        js_info = js_defs.get(cn, {})

        # --- Step 2b: run name-based patterns (for Common Name and gap-filling) ---
        pattern_info = None
        for pattern_fn in PATTERNS:
            result = pattern_fn(cn)
            if result is not None:
                pattern_info = result
                break
        pattern_info = pattern_info or {}

        # --- Step 2c: merge all sources ---
        # Priority: existing CSV value > js_defs value > pattern value
        merged = {}
        newly_inferred = []

        for field in ['Common Name', 'Effects', 'Default Duration']:
            existing = row.get(field)
            if not is_blank(existing):
                # Existing CSV value wins
                merged[field] = str(existing).strip()
            elif field in js_info and js_info[field] not in (None, ''):
                # JS-derived value is primary inference source
                merged[field] = js_info[field]
                newly_inferred.append(field)
            elif field in pattern_info and pattern_info[field] not in (None, ''):
                # Name-based pattern fills the gap
                merged[field] = pattern_info[field]
                newly_inferred.append(field)
            else:
                # Default Duration should always have something
                if field == 'Default Duration':
                    merged[field] = '-'
                else:
                    merged[field] = ''

        # Must have inferred something (coded name or another field)
        if not coded_name_inferred and not newly_inferred:
            continue

        if coded_name_inferred:
            inferred_counts['Coded Name'] += 1
        for f in newly_inferred:
            inferred_counts[f] += 1

        output_rows.append({
            'ID':               row.get('ID', ''),
            'Common Name':      merged['Common Name'],
            'Effects':          merged['Effects'],
            'Default Duration': merged['Default Duration'],
            'MND Modifier':     '-',
            'Exclusive Status': '-',
            'Coded Name':       cn,
            'Notes':            'inferred',
        })

    # --- Pass 2: synthetic rows for ailment IDs missing from the status sheet ---
    sheet_ids = set()
    for row in data:
        try:
            sheet_ids.add(int(float(str(row.get('ID', '')))))
        except (ValueError, TypeError):
            pass

    # Build reverse map: coded_name -> id  (prefer lower id on collision)
    coded_name_to_id = {}
    if AILMENTS_FILE.exists():
        with open(AILMENTS_FILE, encoding='utf-8') as f:
            ailments_raw = json.load(f)
        for name, id_val in ailments_raw.items():
            try:
                id_int = int(id_val)
            except (ValueError, TypeError):
                continue
            if id_int not in sheet_ids:
                if name not in coded_name_to_id or id_int < coded_name_to_id[name]:
                    coded_name_to_id[name] = id_int

    for cn, id_int in coded_name_to_id.items():
        pattern_info = None
        for pattern_fn in PATTERNS:
            result = pattern_fn(cn)
            if result is not None:
                pattern_info = result
                break
        if not pattern_info:
            continue  # nothing to infer for this orphan

        js_info = js_defs.get(cn, {})
        merged = {}
        newly_inferred = []
        for field in ['Common Name', 'Effects', 'Default Duration']:
            if field in js_info and js_info[field] not in (None, ''):
                merged[field] = js_info[field]
                newly_inferred.append(field)
            elif field in pattern_info and pattern_info[field] not in (None, ''):
                merged[field] = pattern_info[field]
                newly_inferred.append(field)
            else:
                merged[field] = '-' if field == 'Default Duration' else ''

        if not newly_inferred:
            continue

        for f in newly_inferred:
            inferred_counts[f] += 1

        output_rows.append({
            'ID':               id_int,
            'Common Name':      merged['Common Name'],
            'Effects':          merged['Effects'],
            'Default Duration': merged['Default Duration'],
            'MND Modifier':     '-',
            'Exclusive Status': '-',
            'Coded Name':       cn,
            'Notes':            'inferred',
        })

    # Sort by integer ID
    output_rows.sort(key=lambda r: int(r['ID']) if str(r['ID']).isdigit() else 0)

    # Write CSV
    fieldnames = ['ID', 'Common Name', 'Effects', 'Default Duration', 'MND Modifier', 'Exclusive Status', 'Coded Name', 'Notes']
    with open(OUTPUT_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(output_rows)

    # Summary
    print(f"Output written to: {OUTPUT_FILE}")
    print(f"Total rows written: {len(output_rows)}")
    print(f"Fields inferred:")
    print(f"  Coded Name:       {inferred_counts['Coded Name']}")
    print(f"  Common Name:      {inferred_counts['Common Name']}")
    print(f"  Effects:          {inferred_counts['Effects']}")
    print(f"  Default Duration: {inferred_counts['Default Duration']}")


if __name__ == '__main__':
    main()
