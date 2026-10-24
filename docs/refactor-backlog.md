# Refactor backlog: Ability Parser and Status Decoder

This backlog splits the clean-up of the two tools into small stories, in the order they should be done. Each story is built on its own task branch off `feature/parser-decoder-refactor`. It is merged into the feature branch once its automated test passes. The app keeps working after every story.

The plan comes from two reviews of the code, one on architecture and one on domain modelling:

- Today both tools are large blocks of inline JavaScript inside ERB views.
- Shared logic has been copied three times and the copies have drifted. The copies are in the parser, the decoder and `scripts/infer_statuses.py`.
- The Status Decoder depends on minified function names, so it breaks on every battle.js repack.
- There are no tests.

## How we work

- **Branches:** `feature/parser-decoder-refactor` off `main`, with one `task/<short-name>` branch per story. Each task branch is merged into the feature branch with `--no-ff` once its tests pass.
- **Tests:** every story ends with an automated command, listed under *Test*. All commands run from the project root in PowerShell.
- **Golden files:** these are saved reference output under `test/fixtures/golden/`. A story that is only meant to move code must leave them byte-identical. A story that is meant to change output updates them in the same commit, and the commit message says which rule changed.
- **Drift bugs:** where `docs/decisions.md` already says what is correct, the code is fixed to match. Where it is silent, the question goes to the owner (see *Open questions*). The answer is then recorded in `docs/decisions.md`.
- **Releases:** the feature branch is merged to `main` only once every story is done and the owner has tested it, so `main` stays as it is until then. A fix for a battle.js repack goes on `main` first and is then merged into the feature branch. The owner deploys with `cap production deploy`.

## Stories

### 1. One sheet registry
As the maintainer, I want one list of sheets, so that the loader, the controllers, `.env.example` and the docs cannot disagree. It comes first because the test snapshot needs the Extra and Hero Abilities sheets.
- `DataLoader::GOOGLE_SHEETS` includes `extra` and `hero_abilities`. `AbilityParserController::SHEET_VARS` is deleted and both controllers read the registry.
- `.env.example` and CLAUDE.md list every sheet.
- **Test:** `bin/rails test`
- **Status:** done (`task/one-sheet-registry`).

### 2. Freeze a test data snapshot
As the maintainer, I want a frozen copy of battle.js and the sheet data in the repo, so that tests give the same answer every time and need no network.
- `rake data:snapshot` copies `data/` into `test/fixtures/snapshot/`, gzipped, with `SNAPSHOT.md` recording the date and each file's SHA-256.
- Running it again when `data/` has not changed leaves the files untouched.
- **Test:** `rake data:snapshot; git status --short test/fixtures` shows no changes on the second run.
- **Status:** done (`task/test-data-snapshot`).

### 3. Test harness that runs today's inline scripts
As the maintainer, I want `node --test` to run the existing `<script>` blocks from both views in a sandbox, so that today's behaviour is locked in before any code moves.
- `test/js/harness.mjs` extracts the scripts from the two views and `shared/_ffrk_constants.html.erb`. It runs them in a Node `vm` with a minimal fake DOM.
- Its fake `fetch` serves the snapshot for `/ability_parser/battle_js`, `/ability_parser/sheet_data` and `/status_decoder/sheet_data`, and stubs the translate call.
- No npm dependencies (Node 24's built-in test runner).
- **Test:** `node --test "test/js/*.test.mjs"` passes a smoke test that decodes a known status key.
- **Status:** done (`task/node-test-harness`).

### 4. Decoder golden output for every status key
As the maintainer, I want today's `decodeStatus` output saved for every `STATUS_AILMENTS_TYPE` key, so that any change in decoding is caught.
- `test/fixtures/golden/statuses.jsonl` has one line per key. It is regenerated with `$env:UPDATE_GOLDEN=1`.
- The test prints decoded and undecoded counts per family.
- The current `inferred_statuses.csv` is also committed as a golden file, for story 19.
- **Test:** `node --test test/js/decoder.golden.test.mjs`
- **Status:** done (`task/decoder-golden`).

### 5. Parser golden output from real battle captures
As the maintainer, I want saved battle captures with the sheet rows the parser produces today, so that I notice when any column changes.
- Each `test/fixtures/battles/<name>.json` has a matching `test/fixtures/golden/<name>.tsv` (every preview table's row) and `<name>.effects.txt`.
- The test also derives the other two input shapes, a bare soul break and the mixed `{sb}\nabilities:[...]` format, from each capture.
- A unit test checks the tier table against every Tier value in the Soul Breaks sheet and every `SOUL_STRIKE_CATEGORY` in battle.js, with no capture needed.
- **Test:** `node --test test/js/parser.golden.test.mjs`
- **Inputs:** see *Battle captures needed*.
- **Status:** done (`task/parser-golden`).

### 6. Fix the drift bugs decisions.md already settles
As the owner, I want the known-wrong sheet columns fixed now, so that rows I paste into the sheet stop being wrong.
- **Counter:** N when `shouldIgnoreReflection` is 1 or `counter_enable` is 0, in every preview builder ("Counter column" and "`shouldIgnoreReflection`" in decisions.md). The SB and CF previews ignore it today.
- **Stacking text:** `maxLv` 5 gives "with Secondary Stacking" and 3 gives "with Stacking", everywhere ("`increaseLv` + `maxLv`"). One of the two copies is wrong today.
- **Tier column:** 27 gives XSB, 21 gives CASB ("Soul Breaks sheet Tier column").
- **Python Roman numerals:** include X and XIII–XVI ("`_cap_word`").
- Each fix is its own commit with its golden diff.
- **Test:** `node --test "test/js/*.test.mjs"; python -I -m unittest discover -s test/python`
- **Status:** done (`task/settled-drift-fixes`). The Counter fix is covered by the counter-enabled Ace variant. The Seymour XSB capture covers the stacking wording and the XSB tier.

### 7. Keep data across deploys
As the owner, I want production data to survive a deploy, so that the tools never come up empty once they read from the cache.
- `data` is added to Capistrano's `linked_dirs`.
- A post-publish hook runs `rake data:refresh` when `data/metadata.json` is missing.
- The daily refresh is documented as a cron line.
- **Test:** `bundle exec cap production deploy:check --dry-run` lists `shared/data`. The owner checks the real deploy.
- **Status:** done (`task/keep-data-across-deploys`).

### 8. Serve both tools from the cache
As a user of the tools, I want pages to load from cached data, so that they open quickly instead of downloading and unpacking 6 MB of battle.js on every visit.
- `Api::DataController` serves sheets and battle.js from `DataStore`, including `last_refreshed_at`. It returns a clear 503 when no data exists.
- The old routes stay as aliases. The decoder stops calling the parser's route.
- A **Refresh data** button triggers a server-side refresh, so a sheet edit still shows up on demand.
- The reload button clears every `DB` map, fixing the stale `statusMap` after a reload.
- **Test:** `bin/rails test test/controllers/api/data_controller_test.rb; node --test "test/js/*.test.mjs"`
- **Status:** done (`task/serve-from-cache`).

### 9. Remove dead code and add Ruby unit tests
As the maintainer, I want unused code gone and the importers covered by tests, so that what's left is what runs.
- Delete `BattleJsImporter.extract_json` and `extract_json_string`, and `parseCSV`/`csvToObjects` in the parser view.
- One shared `get_with_redirects` in `lib/http_fetch.rb`.
- Minitest for `BattleJsImporter.unpack`, the base-62 `word_to_index`, and `SheetsImporter` CSV parsing.
- **Test:** `bin/rails test; node --test "test/js/*.test.mjs"`
- **Status:** done (`task/remove-dead-code`).

### 10. Move the Status Decoder script into a module
As the maintainer, I want the decoder's JavaScript in `app/javascript/pages/status_decoder.js`, so that the view only holds markup.
- The code moves unchanged and is pinned in `config/importmap.rb`. Inline handlers become `addEventListener`.
- The harness loads the module instead of the view.
- **Test:** `node --test "test/js/*.test.mjs"; $env:RAILS_ENV='production'; bin/rails assets:precompile`
- **Status:** done (`task/decoder-module`). Also adds `test/browser/smoke.mjs`, which drives both tools in headless Edge.

### 11. Move the Ability Parser script into a module
As the maintainer, I want the same for the parser, in `app/javascript/pages/ability_parser.js`.
- As story 10. The copy buttons use delegated listeners.
- **Test:** as story 10. The parser goldens are unchanged.
- **Status:** done (`task/parser-module`).

### 12. Shared core module (no output change)
As the maintainer, I want the logic both tools need in one `app/javascript/ffrk/core.js`, so that fixes land once.
- It covers constant extraction (`extractConstantMap`, `invert`), battle.js loading, element, series and character name formatting, target classification, character-from-status-key and ability-condition text.
- The duplicate copies are deleted. Goldens stay byte-identical.
- **Test:** `node --test "test/js/*.test.mjs"`, which also runs `core.test.mjs` with a unit test per helper.

### 13. Shared display tables
As the maintainer, I want the hard-coded tables in `config/ffrk/*.yml`, read by both tools and the Python script, so that names can't drift again.
- The tables are characters, series, elements, soul break tiers, cast-time factors, action-arg supplements and hard-coded ability names. They are served at `/api/tables`.
- The owner's answers on naming are applied (see *Open questions*), with golden diffs.
- **Test:** `node --test "test/js/*.test.mjs"; bin/rails test`

### 14. Decoder dispatch that survives repacks
As the maintainer, I want decoders chosen by status-key family and function-body fingerprint, so that a battle.js repack doesn't break decoding.
- A registry of family, module, fingerprint and decoder replaces the function-name `if` chain in `decodeStatus`.
- The assignment scan finds its pattern instead of hard-coding `O[m.`, `c[s.` and `h[o.`.
- The copied name and condition parsing in the seven decoders uses the core helpers.
- **Test:** `node --test "test/js/*.test.mjs"`, which includes `repack.test.mjs`. That test renames minified identifiers in the snapshot and checks that the goldens still pass.

### 15. Fix the drift bugs the owner decides
As the owner, I want the four preview builders to agree on shared columns, using the rules I choose.
- One commit per answered question from *Open questions*, each with its golden diff and a `docs/decisions.md` entry.
- **Test:** `node --test "test/js/*.test.mjs"`. This includes `preview-consistency.test.mjs`, which checks that all builders give the same values for shared columns on every capture.

### 16. One column derivation with a schema per tab
As the maintainer, I want one `deriveCombatColumns` and a column schema per sheet tab, so that the four copies of the type, target, multiplier and element logic disappear.
- `renderSBSheetPreview`, `renderCFSheetPreview`, `renderExtraSheetPreview` and `renderFollowUpSheetPreview` shrink to a schema plus overrides.
- **Test:** `node --test "test/js/*.test.mjs"`. Goldens unchanged. `schema.test.mjs` checks each schema against the snapshot sheet's header row.

### 17. One relations map and a render context
As the maintainer, I want one `relations` map and `renderAbility(parsed, depth, ctx)`, so that the seven lookup maps and eleven positional arguments go away.
- **Test:** `node --test "test/js/*.test.mjs"`. Goldens byte-identical.

### 18. Soul break type registry
As the maintainer, I want each soul break type described in one place, so that a new type is data rather than new branches.
- The registry is keyed by battle.js enum name (`STANDARD` … `EXTRA_ZETSUGI`).
- Most types are a tier label only. Four need hooks:
  - Crystal Force soul breaks: the CF ability goes to the Crystal Commands tab.
  - Tactical Awoken soul breaks: suppress the attached element, add the implied else-branch, and handle the TP-max and weapon-skill children.
  - Buster soul breaks: suppress the default ability, and send chase abilities to the Other tab.
  - Extra soul breaks: role args, plus the Extra and Other tabs.
- Rules keyed on an arg's role label (weapon skill, cut-in) apply to every type and live in a separate table.
- Tactical Awoken detection uses the coded `TACTICAL_AWAKE_MODE_*` name, not sheet text.
- **Test:** `node --test "test/js/*.test.mjs"`. Goldens unchanged. `sb_types.test.mjs` fails if battle.js has a category the registry doesn't know.

### 19. Retire infer_statuses.py
As the maintainer, I want one status inference engine, so that Python and JavaScript stop disagreeing.
- `node scripts/infer_statuses.mjs` uses the decoder modules to produce `inferred_statuses.csv`. A diff report against the Python golden lists the gaps.
- The work is ported one family at a time, starting with the CBM and TAM families the decoder already handles.
- The Python script is deleted once the diff is empty or every remaining difference is accepted.
- **Test:** `node scripts/infer_statuses.mjs --diff` reports zero unaccepted differences.

## Battle captures needed

A battle capture holds every soul break for every party member, so one or two captures can cover everything. One 2023 capture already exists (`E:\workspaces\FFRK-js\bossai\battle_init.js`, Ace) and is used first. Still needed, in the order stories need them:

1. **For story 6:** received. Ace's CASB (2023 capture) and Seymour's XSB (pasted by the owner).
2. **For story 16:** a Buster soul break, a Tactical Awoken soul break (TASB), a healing soul break and a hybrid (NAT) attack.
3. **For story 18:** a soul break with an IF/ELSE block or party condition (often a Dual Awakening soul break or ADSB), a Synchro soul break, a Chain soul break, and anything with a cut-in ability.

## Findings from the captures

- **Ability Crash gets a Soul Break row.** In the Seymour XSB, Ability Crash (22540040) renders a Soul Break preview with character "Unknown" as well as its Other-tab follow-up row. decisions.md routes Ability Crash to the Other tab and the Soul Breaks sheet has no row for it, so the Soul Break row should be suppressed. To fix in story 18 (Extra soul break hooks).
- **Statuses missing from the Status sheet show coded names.** `EXTRA_BUDDY_MODE_SEYMOUR` (56777) and `CUSTOM_PARAM_MULTI_ATK_15_MATK_15_DEF_25_MDEF_25_MND_15_LARGE` (6116) aren't in the sheet, so the effects text shows the raw key. The decoder can describe the Extra Mode status; story 12's `describeStatus` (sheet first, decoder fallback) fixes this.

## Open questions for the owner

`docs/decisions.md` doesn't settle these. Answers go into story 13 or story 15.

1. Cid: `Cid (XIV)`/`Cid (IV)` or `Cid (Garlond)`/`Cid (Pollendina)`?
2. Series style: `FFVII` or `FF VII`?
3. Element label: `NE` or `Non-elemental`?
4. Which character list is the master, the JavaScript one or the Python one? (Python has entries the JavaScript list lacks, such as Onion Knight.)
5. Tier labels for categories 10 and 14–16, ADSB, and the + variants (Glint+, Glint++, CSB+, LBG+).
6. Should the Tier column prefer the sheet's value when the soul break already has a row, the way Realm and Character do?
7. Target: which of the four preview builders' rules is right?
8. Elements: should NE be filtered out, and should Follow-up rows merge elements across all hits?
9. Should NAT attacks show as Hybrid in the Extra tab?
10. Chase text: "Crystal Force abilities (max 2)" appears on every chase status, including non-CF ones. What should non-CF chases say?
11. The parser translates Japanese names with the unofficial `translate.googleapis.com` endpoint. Keep it, move it server-side with a cache, or drop it?
12. Is `scripts/infer_statuses.py` still in active use? If so, its CSV format is the one the Node port must match.

## Cross-cutting items

- **CI:** a GitHub Actions workflow running `node --test` and `bin/rails test`, added with story 9.
- **HTML escaping:** sheet and capture values go into `innerHTML` unescaped. Fixed when rendering is consolidated in stories 16–17.
- **New battle.js process:** run `rake data:refresh`, then `rake data:snapshot`, then review the golden diff. Documented in story 2 and used by story 14.
- **Production assets and CSP:** checked in stories 10 and 11.
