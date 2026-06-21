# Decisions & Domain Knowledge

Decisions made during development: field meanings, naming conventions, sheet column mappings, and parsing choices. Add a new entry whenever something non-obvious is established so future sessions have context.

---

## Sub-action arg field meanings

### `shouldIgnoreDefAndMdef: 1`
Maps to the word **"piercing"** inserted before "attack" in the generated effects text.
Example: "One single **piercing** attack (11.00 each) capped at 199,999"
In the sheet: this ability ignores DEF and MDEF on the target.

### `shouldIgnoreReflection: 1`
Maps to the **Counter** column in the sheet — set to **"N"** (cannot be countered / ignores reflect).
A value of 1 means the attack bypasses magic reflection and cannot trigger enemy counter-attacks.
A value of 0 (or absent) means Counter = "Y".
The parser also uses `counter_enable` from the top-level options: 0 = "N", 1 = "Y".
When either `shouldIgnoreReflection: 1` OR `counter_enable: "0"`, the Counter column is "N".

### `damageThresholdLv: N`
Damage cap boost of N × 10,000 per hit.
`capVal = 9,999 + (N * 10,000)` → e.g. `damageThresholdLv: 1` → cap 19,999.

### `secondaryDamageThresholdLv: N`
Hard cap at **199,999** per hit (ignores the normal 9,999 cap entirely).

### `increaseLv: N` + `maxLv: M` (in a type-8 or type-18 sub-action)
Increases the character's element attachment level by N, up to a maximum of M.
- `maxLv: 5` → "with Secondary Stacking"
- `maxLv: 3` → "with Stacking"
Generated as: `[Attach <Element> N with Secondary Stacking]`
Level 1 omits the number: `[Attach Holy with Secondary Stacking]`

---

## Sheet column mappings

### Soul Breaks sheet "Tier" column
Tier values used for different soul strike categories:
- `XSB` — Extra Zetsugi (soul_strike_category_id: 27, ExtraZetsugiAction)
- `CASB` — Crystal Awakening (Crystal Force abilities)

### Counter column
"Y" = enemy can counter-attack; "N" = cannot be countered.
Driven by `counter_enable` (top-level) and `shouldIgnoreReflection` (sub-action arg).

### Status decoder O[m.KEY] pattern
As of the current battle.js, the main `StatusAilmentsConfig` block uses `O[m.KEY]=FUNC(` for assignments.
This was previously `A[v.KEY]=FUNC(`. Variable names shift each time battle.js is repacked by the minifier.
If `buildStatusAssignments` throws "StatusAilmentsConfig block not found or empty", check the pattern.
To find the current pattern: search for `STATUS_AILMENTS_TYPE:{` in the unpacked JS, then look for `VAR[SHORT_VAR.KEY]=FUNC(` assignments nearby.

---

## Extra Zetsugi (XSB) parsing — `ExtraZetsugiAction` (action_id: 243)

### What it is
Soul strike category **27** (`SOUL_STRIKE_CATEGORY.EXTRA_ZETSUGI`). The newest type as of this work,
added after BusterShingi (26). Tier label: **XSB**.

### Arg map (from battle.js `ExtraZetsugiAction`)
| Arg | Meaning |
|-----|---------|
| `arg1` | `wrappedAbilityId` — the main ability executed by the soul strike |
| `arg2` | `abilityCrushSoulStrikeId` — triggered after if a personal ability is equipped |
| `arg3` | extraKiwamiAbilityId #1 |
| `arg4` | replacePersonalAbilityId #1 (hero ability being replaced) |
| `arg5` | extraKiwamiAbilityId #2 |
| `arg6` | replacePersonalAbilityId #2 |
| `arg7–arg12` | same pattern for pairs #3, #4, #5 |

### Wrapped ability (arg1)
A standard ability that executes as the soul strike's main effect.
Has its own sub-actions (the actual attack hit numbers, element, damage factor, etc.).
Also applies statuses to self including:
- `EXTRA_BUDDY_MODE` (status 56415) — the base extra mode status
- Character-specific `EXTRA_BUDDY_MODE_*` (e.g. `EXTRA_BUDDY_MODE_WOL`) — the per-character extra mode

The wrapped ability sub-action 2 contains the attach element effect:
- `type: 8` (INFLICT_SA) OR `type: 18` (ATTACH_ELEMENT_BY_ATTACK_ELEMENT) — varies by character
- Args: `elementIds: [N], processOrder: 1, increaseLv: 3, maxLv: 5`
- Generates: `[Attach <Element> 3 with Secondary Stacking]` grouped with "to user" statuses

### Ability Crush (arg2)
A second soul strike (also EXTRA_ZETSUGI category) triggered AFTER the wrapped ability completes,
**conditional on the character having one of their personal abilities (arg4/6/8/10/12) equipped**
in a PANEL_FLEXIBLE_1 or PANEL_FLEXIBLE_2 receptor slot.
- Appears in the **Other** tab of the spreadsheet
- Shown in generated effects as: "Immediately casts [Ability Crash] if <PersonalAbilityName> is equipped"
- The ability crush is identified in parsing as the EXTRA_ZETSUGI sub-ability that is NOT the wrapped ability

### Extra Kiwami abilities (arg3/5/7/9/11)
The "ultra-crystallized" versions of the character's personal abilities — they replace the personal abilities
during Extra Mode. These go in the **Extra** sheet (gid: 1700445928, tier: XSB).
Identified in parsing by reading `arg3/5/7/9/11` directly from `opts` (not from sub-abilities,
since they appear in the `abilities` array and are found by the heuristic scan).

### Personal abilities (arg4/6/8/10/12)
The hero abilities being replaced by the extra kiwami versions.
These are **NOT in the `abilities` array** of the parsed JSON — they are hero abilities that the character
already owns. They are stored in `parsed.extraZetsugiPersonalAbilityIds` during `parseAbility`
by reading `opts.arg4/6/8/10/12` directly (skips the heuristic scan).
Look up names from the **Hero Abilities** sheet (gid: 329671300, `DB.heroAbilityNameMap`).

### Extra Buddy Mode statuses (`EXTRA_BUDDY_MODE_*`)
Defined in `scenes/battle/statusAilmentsConfig/ExtraBuddyMode`.
Assignment pattern: `c[s.KEY]=p({...})` — same `c[s.KEY]` pattern as BusterAttack.
The base `EXTRA_BUDDY_MODE` (id: 56415) is applied by the soul strike itself; the character-specific
variant (e.g. `EXTRA_BUDDY_MODE_WOL`) is applied by the wrapped ability.

Status decoder (`buildStatusAssignments`) scans this module by searching the raw JS directly
for `c\[s\.(EXTRA_BUDDY_MODE_[A-Z_0-9]+)\]=` — bypasses `extractDefineBlock` which was unreliable
for this module's structure. Decoded by `decodeEbmP`.

### Key effect parameters (h() function in ExtraBuddyMode config)
| Parameter | Effect |
|-----------|--------|
| `attachElementIds` | Attach element damage boost by Attach level 1–5: 10/20/30/40/50% |
| `abilityCondition: {anyElementIds:[...]}` | Which element the above applies to (always matches attachElementIds so far) |
| `repeatNum: 1` (default from p()) | Matching element abilities trigger 1 additional time |
| `extraRepeat: !0` | Extra kiwami abilities trigger 1 additional time (max 5) — uses `isExtraKiwamiAbility:true` condition |
| `increaseExecutedDamage: !0` | +30% damage (MEDIUM factor) for matching element abilities |
| `increaseCastTimeFactor: !0` | Instant Cast for matching element abilities (CAST_TIME_FACTOR.MAX) |
| `chaseAbilityAtb: !0` | Triggers [200% ATB 1] after using matching abilities (max 3); default ability ID: 31547024 |
| `flightDuration: N` | No air time for jump abilities (e.g. Kain) |

### Parser implementation files
- **Ability parser**: `app/views/ability_parser/index.html.erb`
  - `parseAbility`: stores `extraZetsugiPersonalAbilityIds` from raw args for action_id 243
  - `generateEffectsText` section 3c: emits "Immediately casts [Ability Crash] if X is equipped"
  - `renderAbility`: calls `renderExtraSheetPreview` (Extra tab) and `renderFollowUpSheetPreview` (ability crush → Other tab)
  - `renderExtraSheetPreview`: generates XSB column preview with tier "XSB"
  - `extraKiwamiParentMap`: built from raw `opts.arg3/5/7/9/11`, maps extra kiwami ability IDs → parent SB info
  - `extraAbilityCrushOtherMap`: built from raw `opts.arg2`, maps ability crush ID → parent SB name
- **Status decoder**: `app/views/status_decoder/index.html.erb`
  - `decodeEbmP`: decodes `EXTRA_BUDDY_MODE_*` statuses
  - EBM scan in `buildStatusAssignments`: raw JS scan for `c[s.(EXTRA_BUDDY_MODE_*)]` pattern

---

## Status terminology

### "Zenith" = `ULTIMATE_BUDDY_MODE`
The status coded name family `ULTIMATE_BUDDY_MODE_*` corresponds to what the community calls **Zenith Mode** (ゼニス in JP). When the codebase or sheet uses "Zenith", it refers to these statuses. The status decoder module is `scenes/battle/statusAilmentsConfig/UltimateBuddyMode`.

### "Accel Mode" = `ACCEL_BUDDY_MODE`
Coded name family `ACCEL_BUDDY_MODE_*`. The JP term is アクセル. Community name: Accel Mode.

### "Extra Mode" = `EXTRA_BUDDY_MODE`
Coded name family `EXTRA_BUDDY_MODE_*`. Base status id: 56415. Community name: Extra Mode.
The status decoder `decodeEbmP` handles these; see XSB section above for full detail.

---

## infer_statuses.py decisions

### Accel Mode: fingerprint detection for minified function names
The `ACCEL_BUDDY_MODE` config in battle.js uses four helper functions whose single-letter variable names **change every time battle.js is repacked**. The parser cannot rely on names like `var p = function(...)`.

Decision: detect function types by **body content fingerprints**:
| Fingerprint in body | Function type |
|---------------------|---------------|
| `chaseAbilityId:void 0` | d-type (chase) |
| `CAST_TIME_FACTOR.MEDIUM` | m-type (cast) |
| `COUNT_ABILITY_USED` | v-type (boost) |
| `.each(r.effects` | p-type (pass) |

If battle.js is repacked and Accel Mode inference breaks, check that these fingerprints still appear in the corresponding function bodies. They are stable game-logic strings, not minifier artifacts.

### `CHARACTER_NAMES` corrections (infer_statuses.py)
Title-casing coded name suffixes produces wrong display names for some characters. These are explicitly corrected in the `CHARACTER_NAMES` dict in `infer_statuses.py`:

| Coded fragment | Display name | Reason |
|----------------|--------------|--------|
| `ARTIMISIA` | Ultimecia | JP romanization differs from EN localisation |
| `WOR` | Wol | Abbreviation in coded name |
| `CAIN` | Kain | JP romanization |
| `BUTS` | Bartz | JP romanization |
| `MASH` | Sabin | JP romanization (Mash) |
| `TINA` | Terra | JP name (Tina) |
| `DRMOG` | Dr. Mog | Compound word, needs period |
| `DESHI` | Tyro | JP name (Deshi = "apprentice") |

Add new entries here whenever a coded name suffix title-cases incorrectly.

### `_cap_word` — CID is not a Roman numeral
The original `_cap_word` implementation checked if a word was a Roman numeral using character-class matching (`set(w) ⊆ {I,V,X,L,C,D,M}`). This incorrectly preserved "CID" as all-caps.

Decision: changed to explicit **set membership** (`w in _ROMAN_NUMERALS_SET`) where the set contains only known game-relevant numerals: `{II, III, IV, V, VI, VII, VIII, IX, X, XI, XII, XIII, XIV, XV, XVI}`. Words like CID, DID, MIX are no longer mistaken for Roman numerals.

---

### Google Sheets
| Sheet | Env var | gid | Contents |
|-------|---------|-----|----------|
| Extra | `EXTRA_SHEET_URL` | 1700445928 | Extra kiwami ability entries (tier: XSB) |
| Hero Abilities | `HERO_ABILITIES_SHEET_URL` | 329671300 | Personal hero ability entries, looked up by ID for Ability Crash condition text |
