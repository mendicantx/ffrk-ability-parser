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

### Status decoder: assignment scanning and decoder dispatch
battle.js assigns statuses as `X[Y.STATUS_KEY]=helper(args)`. `X`, `Y` and `helper` are minified names that change on every repack (for example `A[v.` became `O[m.`, and the Learning Mode helper went from `Or` to `qr`/`Rr`/`zr` to `Wr`).

Decision: the decoder depends on none of those names.
- **Scanning:** `buildStatusAssignments` detects each block's `X[Y.` prefix as the one used most often with known `STATUS_AILMENTS_TYPE` keys (`detectAssignmentPrefix`).
- **Dispatch:** `STATUS_DECODERS` in `status_decoder.js` picks a decoder by the define() module plus a fingerprint of the helper's body: the effect types and option names it uses (`INCREASE_RECEIVED_DAMAGE`, `generalValueToAbilityDamageRateMap`, `ABILITY_BOOST`, `chaseAbilityDoneCountForIsDone`, …). These are game-logic strings, which the minifier leaves alone. When several fingerprints match, the first decoder that accepts the arguments wins.

`test/js/repack.test.mjs` renames the minified names in the snapshot and checks the decoder still gives the same output. If a real repack stops a family decoding, check its fingerprint against the helper body (the decoder page's "Source" panel shows it).

Switching to fingerprints fixed three name-dispatch bugs from the July 2026 repack:
- 74 `LEARNING_MODE_*` statuses weren't decoded (helper now `Wr`).
- `REDUCE_CONSUME_POINT_SHIN_OUGI_FOR_GORDON` wasn't decoded (helper now `hi`).
- 20 `SEQ_ABILITY_REPEAT_*_WHILE_TACTICAL_AWAKE_MODE` statuses were mis-decoded as "Reduced SS Cost" (`oi` now builds sequence abilities).

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

### extraRepeat always says "Extra Abilities"
The `extraRepeat: !0` effect uses `abilityCondition:{isExtraKiwamiAbility:true}` — it fires for the specific extra kiwami abilities defined in the soul strike (arg3/5/7/9/11), NOT for all element-matching abilities.

**Decision**: always render as `Extra Abilities trigger 1 additional time (max 5)`. Reason: new extra kiwami abilities are added over time and a dynamic name lookup would go stale without re-parsing every affected soul break.

**Discarded approach**: an earlier implementation looked up ability names from the Extra sheet via `DB.extraByCharacter[charName]` (character → [Name] from the Extra sheet). The infrastructure is still in place (the Extra sheet is loaded into `DB.extraByCharacter` in the status decoder) in case it becomes useful elsewhere.

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

## Running battle.js

Decision (owner, 2026-10-23): the tools may run battle.js to read the game's own data, instead of picking values out of the source text.

`app/javascript/ffrk/battle_runtime.js` runs battle.js's AMD modules with stand-ins for what the game framework provides:
- a stub `define`/`require`;
- an auto-creating `FF` namespace;
- underscore 1.13.7 (`public/vendor/`);
- small shims for the game's `util` and `lib/ClassBase`.

It builds the `Conf` modules first, because other modules read `FF.ns.battle.Conf` at build time without declaring it. It returns plain data:
- `conf`: the 194 battle constant tables;
- `statusParams`: the real config (effects, durations, values) for about 6,700 of the 7,965 statuses, via the game's own `StatusAilmentsConfig.getParam`.

In the browser it runs in a Web Worker, isolated from the page. In the Node tests it runs in a `vm` context. The Status Decoder shows this data for every status ("Game data (battle.js)"), and it is the base for describing statuses from the game's data rather than from regex-decoded helper calls.

This depends on battle.js being unpacked byte-for-byte, so the unpacker undoes the packed payload's JS string escapes, keeps UTF-8 (Japanese text), and uses ASCII-only word boundaries.

---

## Describing statuses from game data

Statuses that no helper decoder handles are described from their battle.js config by `app/javascript/ffrk/status_text.js`: one clause per game effect, joined with ", ". A status is described only when every effect is understood, so there is never partial text. Duration comes from the config: TURN gives "N turns", TIME gives "N seconds".

Where the Status sheet words the same thing more than one way, the wording that matches more of the sheet's rows for the statuses being described wins:
- **Element damage and resistance:** "Increases Fire damage dealt by 20%, cumulable" / "Reduces …"; "Fire Resistance +10%" / "-10%".
- **Multicast:** "Fire or Holy abilities trigger 1 additional time".
- **Ability damage:** "Fire or Holy abilities deal 15% more damage".
- **Cast speed:**
  - "Cast speed x2.00 for Fire abilities"; elements slash-joined ("Water/Holy"); "attacks" when the condition isn't ability-only.
  - "Cast speed x… for Fire while in Tactical Awoken Mode" when tied to another status.
- **Tied to another status (other effects):** ", removed if the character hasn't [X]".
- **Category names:** follow the sheet (SHOOTER is "Sharpshooter").

Elements are listed in game order (Fire, Ice, … Poison).

**Names** for single-effect statuses follow the sheet's patterns:
- "Buff Fire 20% (5s)" / "Debuff …", "Resist …" / "Imperil …".
- "Dualcast / Triplecast / Quadracast / Pentacast Fire, Dark 1" ("Prismatic" for all nine elements).
- "Water/Holy Ability Quick Cast 1" and "… Instant Cast …" (`castTimeFactor` 10000000 is instant).
- "Fire, Holy Ability +15% Boost 3", "Summoning +15% Boost 1", "Weakness +9% Boost 1".
- "Damage Cap +20000 1".

The trailing number is the turn count, "(15s)" a timed duration, and "(Tactical)" a status tied to Tactical Awoken Mode.

`decoder.sheet-match.test.mjs` tracks the result. For the 1486 decoded statuses with sheet rows, names matching went from 481 to 1226 and effects from 329 to 1049.

**Mode families** bundle several effects into one sentence, so each is recognised by its effects and composed in the sheet's wording (`MODE_FAMILIES` in `status_text.js`). **Master Mode: <character>** reads: "Casts [Star Strike: X] every 2s (max 5), grants Damage Cap +20000/…/+70000 after 0/…/5 chases, casts [North Star: …] after 15s, removed if user hasn't Master Mode".
- The North Star isn't part of the status. It is the Master soul break's closing follow-up, found on the Other tab under the mode's Source.
- The 15s is the base Master Mode status's timer.
- Instant cast, SB cost and Hero Boost belong to the base [Master Mode] row and are left out, as the sheet does.
- When one ability is listed under several modes on the Other tab, the row under this mode wins.

**Abilities not yet on the Other tab** are written as `<ability missing from Other Tab>` (the old decoder's convention), so a new status is still described and the gap is obvious to fill.

---

## Sheet conventions (owner decisions, 2026-10-23)

The community sheet is the reference: where the tools and the sheet disagree, the tools should match the sheet.

### Element column includes NE
A non-elemental hit is listed as `NE` alongside the real elements (for example `Dark, NE`), in every tab. If a boss resists every other element, the attack falls back to NE, so NE matters. The sheet already does this, including in Other-tab follow-up rows (`Water, NE`).

### Elements that depend on a condition are joined with "or"
When the element depends on a condition, such as the character's attach element, the alternatives are joined with ` or `. Example: Kiros's Buster chase is `Ice, NE or Dark, NE`.

### Hybrid formula
`Hybrid` in the Formula column means the attack deals two damage types (for example physical and magical). It does not mean "Type is NAT": a NAT ability can be Hybrid or not. The Type column is the ability's class (NAT for INBORN abilities). Formula comes from the attacks' sub-action types: PHYSICAL_ATTACK is Physical; BLACK_MAGIC, WHITE_MAGIC, SUMMON and NINJUTSU attacks are Magical; both kinds together, or an INBORN attack, is Hybrid. For example, Firion's "North Star: Rose Requiem" is NAT / Physical. Hybrid rows show both multipliers in the effects, such as "(8.00 or 26.50 each)", and `-` in the Multiplier column.

### Naming
- **Realms (series):** the Soul Breaks sheet's Realm column values: `Core`, `I`–`XVI`, `FFT`, `Type-0`, `KH`, `Beyond`. Effects text uses the same names ("if the character's Realm is VII", "VII characters"). Both tools use `realmName()` in `app/javascript/ffrk/names.js`.
- **Element label:** `NE`.
- **Characters:** the Characters sheet is the master list. The decoder corrects JP romanisations in `CHAR_CORRECTIONS` (`app/views/shared/_ffrk_constants.html.erb`): for example `SHERUKU` is Shelke, `ARDEN` is Ardyn, `ORLANDU` is Orlandeau and `CID_HIGHWIND` is Cid (VII). The Cids are `Cid (IV)`, `Cid (VII)`, `Cid (XIV)`, `Cid Raines` (FFXIII) and `Cidolfus` (FFXVI).
- **School "Special":** battle.js names no ability category 18 (Spirit Attacks such as "Spirit Attack: Rain", and Crystal Force abilities). The sheet calls them "Special" (104 Spirit Attack rows in the Other tab), so the parser does too.
- **Tier column:** use the Soul Breaks sheet's Tier when the soul break already has a row. Otherwise derive it from the soul strike category, using the sheet's own labels (Glint, Glint+, CSB, LBG, LBGS, ADSB, …).

### Decoder wording follows the sheet
Where the Status Decoder generates a name or effects text for a status family the sheet already covers (for example Learning Mode), it should produce the sheet's wording.

### Target and Auto Target
- **Target:** the first attack's target. With no attack, the widest target among the sub-actions; otherwise the ability's own range.
- **Auto Target:** repeats the Target ("All enemies", "Self", "All allies") unless the game picks a specific target: "Lowest HP% enemy" (lowercase, the sheet's majority), "Random enemy", and so on.
- **Other-tab follow-ups:** the same rule. A single-target follow-up is "Lowest HP% enemy" (902 rows in the Other tab), and the SB column is "0" (1189 rows vs 389 for "-").

All four previews take these columns, plus Type, Formula, Multiplier, Element and Counter, from `combatColumns()` in `ability_parser.js`. Where the sheet is ambiguous, the most common form in the sheet wins.

### Buster soul breaks
A Buster has two Soul Breaks rows:
- **Break Glint**, under the Buster's own ID. It describes the first use, and its Points is the first use's cost from `buster_shingi_abilities[0]` (0).
- **Break Arte**, under the repeat ability's ID (`arg2`).

### Master soul breaks
A Master (MASB) soul break's Soul Breaks row lists its statuses by name ("Grants [Master Mode], [Master Mode: Firion], …"). Each status is described in its own Status-tab row, which is the style the owner prefers. Its `arg2` (`masterFinishAbilityId`, the follow-up cast when Master Mode ends, "North Star: …") goes on the Other tab with Source "Master Mode: <character>". The Action Args sheet has no arg names for action 239, so `ACTION_ARG_SUPPLEMENTS` fills them in. Supplements fill blanks in a sheet row and never override it.

### Tactical soul breaks
A Tactical (TASB) soul break has two Soul Breaks rows with the same ID (166 of 280 TASB IDs in the sheet):
- **The mode:** NAT, Self.
- **"<name> (Weapon Skill)":** the `weaponSkillAbilityId` attack, Points 0, the same SB Ver.

The parser shows the weapon skill under the soul break's ID and "(Weapon Skill)" name; its on-page ids carry a `-ws` suffix. The mode row's Effects in the sheet is a hand-written summary of the Tactical Awoken Mode status, which the parser doesn't produce yet. TP MAX follow-ups without an Other row are named `TPMAX<Character>`, as the sheet names them.

### Dual Awoken soul breaks
A Dual Awoken (DASB) soul break has two Soul Breaks rows with the same ID, like a Tactical soul break:
- **The soul break itself.**
- **"<name> (Dual Shift)":** the `dualShiftAbilityId` (arg2) ability, Self, with the same SB Ver.

The parser shows the Dual Shift under the soul break's ID and "(Dual Shift)" name; its on-page ids carry a `-ds` suffix. Both kinds of second row ("(Weapon Skill)" and "(Dual Shift)") come from `SECOND_ROWS` in `ability_parser.js`.

### Action 226 arg1 is not a wrapped ability
`SubActionAction` (action 226) never reads its own arg1: battle.js uses only arg6 and the parent ability's args. arg1 points at a related ability, such as a mode's chase (Trey's Dual Shift points at the Dual Awoken Mode II chase, Rain's Zenith at its Spirit Attack). `ACTION_ARG_SUPPLEMENTS` names it `relatedAbilityId`, so the parser no longer describes the related ability's effects as the ability's own.

### Party conditions with several thresholds
IF / ELSE IF / ELSE blocks on the same kind of ally are listed fewest allies first, as in the sheet's "0-3/4/5 VII allies": "Grants [A] to the user/[A], [B] to the user/[A], [C] to the user if there are 0-2/3/4+ Sharpshooter allies in the party". Job names use the sheet's school names (`schoolName()` in `ffrk/names.js`: SHOOTER is "Sharpshooter"), in both tools.

### Attack wording
The Effects text follows the sheet's majority wording:
- A hit on all enemies is a **group** attack: "One group attack (8.00)".
- "(x each)" is used only for more than one hit: "Six single attacks (0.90 each)", but "One single attack (26.50)".

### Effects punctuation
Effects text is one sentence in the sheet's most common style:
- Clauses are joined with ", ", and a following verb is lower-case ("…capped at 19999, grants [X] to the user").
- No final period.
- Statuses are listed as "[A], [B] and [C]", in follow-ups too.
- An attach element chosen by the entry attack: "grants [Attach Fire 2 with Stacking]/[Attach Earth 2 with Stacking] if entry damage was Fire/Earth" (42 rows, vs 22 for "based on").
- "to the user".
- Caps have no thousands separator ("19999").

This holds in every ID range of the sheet, including the newest soul breaks (about 2:1). Rows written in the other style ("capped at 99,999. Grants … to user.") are the minority.

### Learning Mode wording (decoder)
The Status sheet's Learning Mode rows use several wordings, so the decoder uses the most common one:
- **Name:** `Learning Mode: <Character>`, plus `(<Element or category>)` only when the character has more than one Learning Mode and this one is conditional, for example `Learning Mode: Aerith (Wind)`.
- **Effects:** `Keeps track of Learning Mode: <Character> level (0~5), <Qualifier> attacks deal 5/10/…% more damage at Learning Mode: <Character> level 0/1/2/3/4/5`, or `increases damage dealt by 5/10/…%` when there is no condition. No trailing period.
- **Damage table:** taken from the status's arguments, otherwise the helper's own default (some helpers use 25–50%), otherwise 5–30%.

About 20 older sheet rows use the decoder's previous wording and now differ. `test/js/decoder.sheet-match.test.mjs` tracks how many names and effects match the sheet; the counts may only go up.

### Zenith Mode wording (decoder)
`Zenith Mode: <Character>` statuses (`ULTIMATE_BUDDY_MODE_*`) use the sheet's most common order (176 of 307 rows): Infusion, cast speed, extra triggers, Spirit Attack, zero hone cost, maximum HP, Astra, "removed if the character hasn't [Zenith Mode]". For example: "Increases [Fire/Earth Infusion] damage bonus by 20%, cast speed x1.10 for PHY attacks, Fire or Earth abilities trigger 1 additional time, casts Spirit Attack: Rain after using three Fire or Earth abilities (max 1), Hero Abilities have zero hone cost, maximum HP +1500, grants [Astra] after taking the next action, removed if the character hasn't [Zenith Mode]".
- **Name:** the Spirit Attack's Other-tab Source ("Zenith Mode: Ace (Fire)"). Without one, it's built from the coded name, with a trailing roman numeral kept ("Zenith Mode: Rinoa II").
- **Elements:** in element order ("Fire/Ice/Holy", "Fire, Ice or Holy"), the sheet's majority (22 rows vs 13 in game-config order).
- **Cast speed:** `physicalDamageAbilities` is "PHY attacks"; `magicDamageAbilities` is "BLK, WHT, BLU, SUM or NAT attacks that deal magical damage". With no condition it's just "cast speed x1.10".
- **Chases:** "(max N)" only when the chase has a limit; "after another ally uses …" when allies' abilities trigger it.
- **"Hero Abilities have zero hone cost"** is on every generated Zenith, just before "maximum HP" (owner decision, 2026-10-23). It isn't a per-status effect: the Hero Abilities a Zenith swaps in are Kiwami panels, and battle.js's `AbilityPanel.isNoConsumption()` is always true for those. Only 64 of 307 sheet rows (mostly the newer Zeniths) have the line, so `decoder.sheet-match.test.mjs` counts a row as matching if the sheet has the decoder's text with or without that line.

### Status names in the Ability Parser
The Ability Parser names a status from its Status-tab row. When the sheet has no row, it uses the Status Decoder's description from the game data (`ffrk/status_context`, the same code the decoder uses), so new modes appear by name ("[Dual Awoken Sharpshooter Mode II (Trey v2)]") instead of by coded name. The parser runs battle.js in the background; parsing doesn't wait for it, and the last parse is shown again when the game data arrives. Statuses the decoder only handles with its older helper decoders (Crystal Force, Extra and Tactical modes) still show their coded names in the parser.

### Dual Awoken Mode wording (decoder)
`DUAL_AWAKE_MODE_FIRST_*` / `_SECOND_*` statuses use the sheet's most common order and wording: damage cap, rank boost ("Sharpshooter abilities deal 5/10/15/20/30% more damage at ability rank 1/2/3/4/5"), extra triggers, cast speed, use-count tiers ("cast speed x2.00/x2.50/x3.00 and critical chance =50%/75%/100% for equipped Sharpshooter abilities after casting 1/2/3+ Sharpshooter abilities"), damage, critical chance, chase ("casts Dual Arrow Force after using Sharpshooter abilities"), "casts X when removed".
- **Subjects** join with "and" (79 rows vs 76 with slashes). Elements keep the game's order ("Dark and Fire", 28 rows vs 2 sorted), unlike Zenith rows.
- **Cast speed:** "instant cast speed" (191 vs 31 for "x999999"); fixed speeds are "for X abilities" (Mode I rows split 30/30 with "for equipped X abilities"; Mode II rows are plain).
- **Chases** that need several uses: "after using two X abilities".
- **Name:** from the Other-tab Source of the mode's chase; Mode I borrows its Mode II partner's. Otherwise built from the coded name: "Dual Awoken Earth Mode I (Biggs)", and a trailing `II` is "(Fang v2)", the sheet's usual form.
- **Default Duration:** Mode I is 15 seconds. Mode II lasts as long as its soul break's Dual Shift pattern (`dualShiftPatternId`, arg4: pattern 0 is [3,3,2,1,0] turns, pattern 1 is [1]), which the status doesn't know, so the decoder uses the sheet's most common value, "1 turn" (149 vs 120 for "3/3/2/1/0 turns (Dual Shift)").

### Soul Drive Mode wording (decoder)
`Soul Drive Mode: <Character>` statuses (`LIMIT_BREAK_SOUL_DRIVE_*`) use the wording every one of the 160 sheet rows shares: "Reduces the SB points cost for Soul Breaks by 250, instant cast speed for Soul Breaks, increases the damage/healing cap by 10000 for Soul Breaks, Soul Breaks deal 50% more damage, grants [Instant ATB 1] after using a Soul Break, removed after triggering, removed if the character hasn't [Soul Drive Mode]". The cap and damage clauses appear only when the status has them.

What the Soul Break use grants isn't part of the status. The base [Soul Drive Mode] casts the soul break's own follow-up (its arg2), and battle.js doesn't link it to the character's mode. The decoder takes it from the Other-tab row listed under the mode (Source "Soul Drive Mode: <Character>"). Without one, a standard mode (with the cap and damage boosts) is assumed to grant [Instant ATB 1], as 102 of 107 sheet rows do (owner decision, 2026-10-23); a plain mode gets the usual placeholder, "casts <ability missing from Other Tab> after using a Soul Break", because plain modes grant different things.

Names keep an element suffix (15 of 18 sheet rows) and drop the `KOKI` word from the coded name.

### Chase text for non-Crystal Force chases
This is handled case by case as new chase types come up. Until then the parser keeps its current wording.

### Scope
The refactor covers the Ability Parser and the Status Decoder. `scripts/infer_statuses.py` is left as it is.

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
