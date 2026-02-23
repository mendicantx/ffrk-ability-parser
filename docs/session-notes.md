# Session Notes — ffrk-ability-parser

This document captures the current state of the project so work can be
resumed in a new Claude session (e.g. on a different machine).

---

## What this project is

A Rails 7 web app that pulls FFRK (Final Fantasy Record Keeper) community
data from two sources:

- **Google Sheets** — four published CSV tabs: Soul Breaks, Characters,
  Status, Other. No credentials needed; sheet must be publicly published.
- **battle.js** — the game's packed JavaScript file, fetched from a URL,
  unpacked using Dean Edwards p,a,c,k,e,r decoder, and parsed for JSON.

Data is held in a `DataStore` singleton (in-memory). `rake data:refresh`
is the only thing that touches the network. Files are written to `data/`
(gitignored).

The main active work is in `scripts/infer_statuses.py`.

---

## scripts/infer_statuses.py

A standalone Python 3 script. Run from the repo root:

```
python3 scripts/infer_statuses.py
```

Reads:
- `data/sheets/status.json` — the Status sheet exported as JSON
- `data/status_ailments.json` — `{ "CODED_NAME": id_int, ... }` map
- `data/battle_js.txt` — the unpacked battle.js (5+ MB)

Writes: `inferred_statuses.csv` (gitignored)

### What it does

For each row in `status.json` that has at least one blank field among
Common Name, Effects, or Default Duration (or has no Coded Name at all),
it infers the missing fields and writes the result to the CSV.

**Skip condition**: a row is skipped entirely if all five fields are
already populated — ID, Common Name, Effects, Coded Name, Default Duration
— where `-` is a valid value for Default Duration.

### Inference pipeline (per row)

1. **Coded Name lookup** — if the row has no Coded Name, look up the ID in
   the reverse ailments map (`data/status_ailments.json`) to find it.

2. **JS-derived Effects/Duration** (primary source) — three parsers run at
   startup and build dicts of `{ coded_name -> { Effects, Default Duration } }`:
   - `parse_js_status_defs()` — reads `StatusAilmentsConfig` function-call
     style definitions (~2494 entries)
   - `parse_js_extend_defs()` — reads `_.extend(...)` style assignments
     (~262 entries) for cast time, param boosts, etc.
   - `parse_js_durations()` — reads object-style duration blocks (~562)

3. **Name-based pattern handlers** (secondary source) — the `PATTERNS`
   list (see below) is tried in order; first match wins. Patterns infer
   Common Name and fill in Effects/Duration when JS data isn't available.

4. **Merge priority**: existing sheet value > JS-derived > pattern-derived.
   Existing sheet values are NEVER overwritten.

---

## Pattern handlers (PATTERNS list)

Each `pattern_*` function takes a coded name string and returns a dict
`{ 'Common Name': ..., 'Effects': ..., 'Default Duration': ... }` or
`None` if the pattern doesn't apply.

| # | Function | Handles |
|---|----------|---------|
| 1 | `pattern_accel_buddy_mode` | `ACCEL_BUDDY_MODE_*` — JS-parsed, see below |
| 2 | `pattern_ultimate_buddy_mode` | `ULTIMATE_BUDDY_MODE_*` — JS-parsed, see below |
| 3 | `pattern_master_buddy_mode` | `MASTER_BUDDY_MODE_*` |
| 4 | `pattern_crystal_buddy_mode` | `CRYSTAL_BUDDY_MODE_*` / `CRYSTAL_FORCE_MODE_*` |
| 5 | `pattern_limit_break_soul_drive_mode` | `LIMIT_BREAK_SOUL_DRIVE_MODE_*` |
| 6 | `pattern_tactical_awake_mode` | `TACTICAL_AWAKE_MODE_*` |
| 7 | `pattern_enhance_shin_ougi` | `ENHANCE_SHIN_OUGI_*` (Synchro boost while in mode) |
| 8 | `pattern_change_cast_time` | `CHANGE_CAST_TIME_*` |
| 9 | `pattern_increase_damage_by_ability` | `INCREASE_DAMAGE_BY_ABILITY_*` |
| 10 | `pattern_increase_atb_time_factor` | `INCREASE_ATB_TIME_FACTOR_*` |
| 11 | `pattern_used_ability_counter` | `USED_ABILITY_COUNTER_*` |
| 12 | `pattern_dual_awake_mode` | `DUAL_AWAKE_MODE_*` |
| 13 | `pattern_increase_executed_damage_element` | `INCREASE_EXECUTED_DAMAGE_ELEMENT_*` |
| 14 | `pattern_seq_ability_repeat_element_while` | `SEQ_ABILITY_REPEAT_ELEMENT_WHILE_*` |
| 15 | `pattern_custom_param` | `CUSTOM_PARAM_*` (parameter boosts) |
| 16 | `pattern_increase_element_atk` | `INCREASE_ELEMENT_ATK_*` (element debuffs) |

---

## JS-parsed handlers — the complex ones

### ULTIMATE_BUDDY_MODE (Zenith Mode) — `_parse_js_ultimate_buddy_defs()`

These entries use object-style assignment in JS:
```
p[i.ULTIMATE_BUDDY_MODE_NAME] = { effects: [...], ... }
```

The parser extracts the object block with balanced-brace counting, then
parses the `effects` array. Each effect object's `type` field determines
what text to generate:

| JS type | Generated text |
|---------|---------------|
| `ATTACH_ELEMENT_KIWAMI` | element infusion + damage bonus |
| `REGISTER_CHASE_ABILITY_WHEN_ABILITY_DONE` | "casts [Spirit Attack: X] after using Y abilities" |
| `REGISTER_CHASE_ABILITY_WHEN_ABILITY_DONE_REACT_ALL_ACTOR` | "casts [Spirit Attack: X] after any ally uses Y abilities" |
| `REGISTER_ABILITY_WHEN_UNSET_SA` | "casts [X] when [StatusName] is removed" |
| `REGISTER_CHASE_ABILITY_WHEN_CONSUME_DAMAGE_REDUCTION_BARRIER` | "casts [X] when a Barrier absorbs damage" |
| `INCREASE_CAST_TIME_FACTOR` | "cast speed xN.NN for Y" |
| `REGISTER_SEQ_ABILITY_WHEN_ABILITY_DONE` | "Y abilities trigger 1 additional time, Hero Abilities have zero hone cost" |
| `INCREASE_STATUS` (maxHp) | "maximum HP +N" |
| `INFLICT_SA_AT_NEXT_ACTION` | "grants [StatusName] after next action" |
| `INCREASE_CRITICAL_DAMAGE` | "critical damage +N%" |
| `INCREASE_EXECUTED_DAMAGE` | "N% more damage for Y" |
| `COUNT_ABILITY_USED` + `INCREASE_EXECUTED_DAMAGE` (pair) | "N/M/P% more damage after using 1/2/3 Y abilities" |
| `INCREASE_EXECUTED_HEAL` | "healing +N%" |

Spirit attack name: derived from the coded name suffix via
`char_name_from_suffix()` → `_ubm_spirit_name()`. Format:
`Spirit Attack: {char_name}` or `Spirit Attack: {char_name} ({elem})`.

All Zenith Mode entries end with:
`"removed if the character hasn't [Zenith Mode]"`

If no `REGISTER_SEQ_ABILITY_WHEN_ABILITY_DONE` effect is present, a
standalone `"Hero Abilities have zero hone cost"` line is added.

### ACCEL_BUDDY_MODE (Accel Mode) — `_parse_accel_buddy_mode_js()`

These entries use function-call style in JS. Four minified helper
functions exist in the code, and **the variable letter names change with
each minification**. The parser detects which letter maps to which
function by extracting each function's body with balanced-brace counting
and checking for distinctive fingerprints:

| Fingerprint in body | Function type | Effect |
|---------------------|---------------|--------|
| `chaseAbilityId:void 0` | d-type (chase) | rank-based boost + "casts [Roaring X] after using Y" |
| `CAST_TIME_FACTOR.MEDIUM` | m-type (cast) | rank-based boost + "x2.00 cast speed for Y" |
| `COUNT_ABILITY_USED` | v-type (boost) | rank-based boost + "10/20/30% more damage after using 1/2/3" |
| `.each(r.effects` | p-type (pass) | rank-based boost + each explicit effect parsed |

All four types have `hasAbilityBoost:!0` (true), so all produce:
`"{cond} deal 15/20/25/30/50% more damage at ability rank 1/2/3/4/5"`

The p-type parses each effect object's `abilityCondition` block to get the
condition (elements, categories, `isFlightAttack`, `isPhysicalAttack`).
Supported p-type effects:
- `INCREASE_CAST_TIME_FACTOR` with MAX → "instant cast for Y"
- `INCREASE_CAST_TIME_FACTOR` with MEDIUM → "x2.00 cast speed for Y"
- `REGISTER_CHASE_ABILITY_WHEN_ABILITY_DONE` → "casts [Roaring X] after using Y (max N)"
- `REGISTER_CHASE_ABILITY_WHEN_CONSUME_DAMAGE_REDUCTION_BARRIER` → "casts [Roaring X] when a Barrier absorbs damage"
- `INCREASE_DAMAGE_THRESHOLD_LV` → "raises damage cap for Y"

Spirit/roaring attack name: same `char_name_from_suffix()` logic, but
prefixed with `"Roaring"` instead of `"Spirit Attack:"`.

All Accel Mode entries end with:
`"removed if the character hasn't [Accel Mode]"`

---

## Key helpers

### `char_name_from_suffix(suffix)`

Parses a coded-name suffix (e.g. `"SQUALL_FIRE"`, `"LION_WATER_II"`)
into `(char_name, elements, extra_parts)`.

Algorithm:
1. Strip trailing Roman numerals (II, III, IV…) into `version_parts`.
2. Strip trailing elements (FIRE, ICE, etc.) into `elements`.
3. Try to match remaining parts against `CHARACTER_NAMES` dict (longest
   first).
4. Fallback: title-case remaining parts; if `version_parts` AND
   `elements` both exist, return `version_parts` as `extra_parts` so the
   caller can place them after the element qualifier
   (e.g. "Lion (Water) II" not "Lion II (Water)").

### `CHARACTER_NAMES` dict

Maps non-obvious JS name fragments to display names. Add entries here
when a character's coded name doesn't title-case correctly:
`BUTS→Bartz`, `MASH→Sabin`, `TINA→Terra`, `ARTIMISIA→Ultimecia`,
`DRMOG→Dr. Mog`, `DESHI→Tyro`, `WOR→Wol`, `CAIN→Kain`, etc.

### `_cap_word(w)`

Title-cases a word but preserves known Roman numerals
(`_ROMAN_NUMERALS_SET = {'II', 'III', 'IV', ...}`). Uses membership in
the set rather than character-class matching — the old approach
incorrectly treated "CID" as a Roman numeral (C, I, D are all in IVXLCDM).

### `_extract_balanced_block(text, start, open_ch, close_ch)`

Extracts a single balanced `{...}` or `[...]` block starting at a known
position. Used extensively in both JS parsers.

### `_extract_object_blocks(arr_content)`

Splits a `{...},{...},...` string into individual top-level object strings.
Used to split the `effects:[...]` array contents.

---

## Output format

`inferred_statuses.csv` columns:
`ID, Common Name, Effects, Default Duration, MND Modifier, Exclusive Status, Coded Name, Notes`

The last column (`Notes`) is set to `"inferred"` for all rows this script
produces. Rows where the sheet already has all fields populated are
skipped entirely.

---

## Things that still need work / known gaps

- **Some ACCEL_BUDDY_MODE Common Names in the sheet use comma-separated
  elements** (e.g. "Accel Mode: Basch (Holy, Fire)") because they were
  entered manually before the script existed. The script preserves these
  since existing sheet values win. The Effects are correctly inferred.
  To fix the names, update them directly in the Google Sheet.

- **Some characters have sheet-supplied Common Names** like
  "Accel Mode: Cid (VII) (Wind)" that include extra qualifiers not
  derivable from the coded name alone. Same situation — preserved as-is.

- **ACCEL_BUDDY_MODE entries not in battle_js.txt** fall back to the
  generic `"Grants Accel Mode for {char_name}, removed..."` text. There
  are currently 3 such entries (all `SAMPLE*` test rows).

- **The `needs_inference` skip gate** means rows where Effects was set by
  a previous (incorrect) run won't be re-inferred. If you need to
  re-infer a row, clear the Effects column in the sheet first.

- **DUAL_AWAKE_MODE** parser exists but may have gaps for unusual entries.

- **No handler yet** for some rarer status families — if you see
  `"Grants [coded_name] effects"` placeholder text, that pattern hasn't
  been written yet.

---

## Data refresh workflow

```bash
# Fetch all data from Google Sheets + battle.js
rake data:refresh

# Re-run inference script
python3 scripts/infer_statuses.py
```

Both steps are independent. The inference script only reads from `data/`;
it never touches the network.
