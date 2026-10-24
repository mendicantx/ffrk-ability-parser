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
- **Status:** done (`task/shared-core`). Only `extractConstantMap`, `invert` and the `/data` helpers were truly shared without changing output. The name formatting, target classification and `describeStatus` differ between the pages, so they move in story 13 along with the owner's naming decisions. The harness now imports the pages as real ES modules.

### 13. Shared display tables
As the maintainer, I want the hard-coded naming tables in one shared module, read by both tools, so that names can't drift again.
- `app/javascript/ffrk/names.js` holds series, element and character naming, used by both pages. Character names come from the Characters sheet where possible, with corrections only for coded names that don't title-case correctly.
- The owner's naming answers are applied (see *Owner answers*), each as its own commit with its golden diff.
- The decoder's Learning Mode wording matches the sheet. `decoder.sheet-match.test.mjs` reports how many decoded names and effects match the sheet, and fails if that drops.
- **Test:** `node --test "test/js/*.test.mjs"`

### 14. Decoder dispatch that survives repacks
As the maintainer, I want decoders chosen by status-key family and function-body fingerprint, so that a battle.js repack doesn't break decoding.
- A registry of family, module, fingerprint and decoder replaces the function-name `if` chain in `decodeStatus`.
- The assignment scan finds its pattern instead of hard-coding `O[m.`, `c[s.` and `h[o.`.
- The copied name and condition parsing in the seven decoders uses the core helpers.
- **Test:** `node --test "test/js/*.test.mjs"`, which includes `repack.test.mjs`. That test renames minified identifiers in the snapshot and checks that the goldens still pass.
- **Status:** done (`task/decoder-fingerprints`). This also fixed three dispatch bugs from the July 2026 repack: 74 Learning Mode statuses and Gordon's SB cost reduction are decoded again, and 20 `SEQ_ABILITY_REPEAT_*` statuses are no longer mis-decoded as "Reduced SS Cost".

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
- **Status:** done (`task/relations-context`), ahead of stories 15 and 16 because it needs no owner input. The seven maps became named fields of one `relations` object built by `recordRelations()`; `markSuppressedSubAbilities()` holds the card-suppression rule. Buster and Tactical Awoken branches have no capture yet, so they're covered only by the rename being mechanical.

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
- **Status:** dropped. The owner scoped the refactor to the two tools.

## Battle captures needed

A battle capture holds every soul break for every party member, so one or two captures can cover everything. One 2023 capture already exists (`E:\workspaces\FFRK-js\bossai\battle_init.js`, Ace) and is used first. Still needed, in the order stories need them:

1. **For story 6:** received. Ace's CASB (2023 capture) and Seymour's XSB (pasted by the owner).
2. **For story 16:** a Buster soul break, a Tactical Awoken soul break (TASB), a healing soul break and a hybrid (NAT) attack.
3. **For story 18:** a soul break with an IF/ELSE block or party condition (often a Dual Awakening soul break or ADSB), a Synchro soul break, a Chain soul break, and anything with a cut-in ability.

## Findings from the captures

- **Ability Crash gets a Soul Break row.** In the Seymour XSB, Ability Crash (22540040) renders a Soul Break preview with character "Unknown" as well as its Other-tab follow-up row. decisions.md routes Ability Crash to the Other tab and the Soul Breaks sheet has no row for it. Fixed in `task/ability-crash-row`: Ability Crash now gets only its Other-tab row.
- **Statuses missing from the Status sheet show coded names.** `EXTRA_BUDDY_MODE_SEYMOUR` (56777) and `CUSTOM_PARAM_MULTI_ATK_15_MATK_15_DEF_25_MDEF_25_MND_15_LARGE` (6116) aren't in the sheet, so the effects text shows the raw key. The decoder can describe the Extra Mode status; a shared `describeStatus` (sheet first, decoder fallback) in story 13 fixes this.

- **Learning Mode wording differs from the sheet.** The newly decoded Learning Mode statuses use the decoder's wording ("Keeps track of Learning Mode: Aerith (Wind) level, increases damage dealt by Wind Abilities by 5/10/…%"), while the sheet says "(0~5)" and "Wind attacks deal …% more damage", and names the no-element variants with a series ("Learning Mode: Aerith (VII)"). Names match the sheet for 40 of 68, effects for 16 of 68.
- **Gordon's SB cost reduction names its soul break by coded name** (`[SHIN_OUGI_OF_MISSION_TIME]`) because the soul break isn't found by ID; the sheet calls it "Hour of Purpose".

## Describing statuses from game data (in progress)

Since running battle.js became possible, the Status Decoder describes statuses from the game's own config (`ffrk/status_text.js`) when no helper decoder applies. Progress is measured two ways:
- `decoder.coverage.test.mjs`: statuses missing from the Status sheet that the decoder can describe, now 1026 of 1259.
- `decoder.sheet-match.test.mjs`: decoded statuses matching the sheet's existing rows, now 2633 names and 2062 effects. A row matches if the sheet has the decoder's text with or without the optional clauses in the test (the zero-hone-cost line).

Described so far: element damage and resistance, multicast, quick and instant cast, ability, weakness and capped damage boosts, damage caps (plain, ability and element), DEF/RES piercing, single-ability follow-ups (including Chain Force limits), Master Mode, Zenith Mode, Soul Drive Mode, Dual Awoken Mode, Awoken Mode, and simple ATB, stat, Resonance and piercing statuses.

**Zenith Mode** (`ULTIMATE_BUDDY_MODE_*`): 291 of 311 decode. Of the 284 with sheet rows, 268 names and 137 effects match the sheet. The rest differ because:
- 55 Spirit Attacks aren't on the Other tab yet, so they show `<ability missing from Other Tab>`.
- The text includes "Hero Abilities have zero hone cost" on every Zenith (owner decision), and only 64 of 307 sheet rows have it. battle.js has no per-status effect for it: the Hero Abilities a Zenith swaps in are Kiwami panels, and `AbilityPanel.isNoConsumption()` is always true for those. The match test accepts the sheet text with or without the line: 11 rows match with it and 126 without.
- Minority wordings and typos in the sheet ("Fire infusion" without brackets, "Water and Wind", a stray comma before "(max 1)").

Zenith statuses still undecoded (20): healers (`INCREASE_EXECUTED_HEAL`, "WHT actions restore 20% more HP"), chases triggered by breaking a Damage Reduction Barrier, timed damage boosts, Gogo's per-element chases, and one-offs for Tidus (Water), Thancred, Squall (Ice), Arden, Genesis, Rapha and Aerith.

**Soul Drive Mode** (`LIMIT_BREAK_SOUL_DRIVE_*`): all 199 decode; 154 names and 101 effects match the sheet. What the Soul Break use grants comes from the soul break's own follow-up, which battle.js doesn't link to the mode. When the Other tab doesn't list it, standard modes are assumed to grant [Instant ATB 1] (owner decision) and plain modes get the placeholder.

**Dual Awoken Mode** (`DUAL_AWAKE_MODE_*`): 567 of 698 decode; of the 455 decoded with sheet rows, 295 names and 145 effects match. Most remaining differences are chases not yet on the Other tab and one-off sheet wordings. Still undecoded (131): tiered critical damage and healing, HP-barter and damage counters, barrier chases, Soul Break cost reductions, and a few one-offs.
- **Parser follow-up (done):** the Ability Parser falls back to the decoder's game-data description (`ffrk/status_context`), so Trey's DASB rows name "[Dual Awoken Sharpshooter Mode II (Trey v2)]". The whole decoder engine now lives in `ffrk/status_decoder.js` (`createStatusDecoder()`), so the parser uses its helper decoders too (Crystal Force, Extra and Tactical modes).

Next, largest first among the statuses the sheet is missing:
- Chase modes.
- Accel modes.
- Single follow-ups with extra fields.

These are multi-effect modes, which need per-family composition rules.

**Tactical mode-row summary (settled by the owner's style decision):** some Tactical mode rows hold a hand-written summary ("Tactical Awoken Mode & +500 ATK to user Tactical Awoken Mode: Dark Ability Boost, …"). The owner prefers the broken-out style (statuses named on the soul break row, each described in its own Status-tab row), which is what the parser produces; the parser's "Not on the Status tab" section supplies the status rows.

**Hero Boost (done):** Master Mode Star Strikes now end with "increases Hero Boost level by 1", from the sub-action's `increaseLevel` on the `masterBuddyModeEnhance` level. Other level keys are left out until the sheet shows how it words them (`LEVEL_KEY_NAMES` in `ability_parser.js`).

## Known bug to fix

### Keep Japanese text when importing the sheets (done)
`SheetsImporter.parse_csv` (`lib/importers/sheets_importer.rb`) used to re-encode the downloaded CSV from "binary", which deleted every non-ASCII character (Name (JP) "覚醒チャージAショット" became "A"). It now reads the body as UTF-8, drops only invalid bytes and a leading byte-order mark, and has tests for both. The cache and the test snapshot were refreshed: the parser now matches the Name (JP) column (274 of 306 cells).

**ATB follow-up names (owner decision):** the Other tab names Tactical ATB follow-ups 31545795 and 31545796 "ATB短縮_10%" and "ATB短縮_20%", but the Status tab calls them "[ATB_10%]" and "[ATB_20%]" (34 rows). The owner prefers the names without Japanese, so `ABILITY_NAME_CORRECTIONS` in `ffrk/status_context.js` uses "ATB_10%" / "ATB_20%" for them in both tools.

## Release: deploy from GitHub Actions (when the feature branch is ready to ship)

### What the current config shows
- **Repo fetch:** `repo_url` is SSH (`git@github.com:mendicantx/ffrk-ability-parser.git`), and `ssh_options` has `forward_agent: true`. So the server clones with whatever key the deploying machine's agent holds.
- **Repo visibility:** the repo is public.
- **Ruby on the server:** nothing hard-codes a Ruby version or PATH. `capistrano-asdf` uploads a wrapper that sources `~/.asdf/asdf.sh` (present in asdf v0.14.1) and runs commands through `asdf exec`. asdf reads the release's `.tool-versions` (`ruby 4.0.9`), which takes precedence over `~/.tool-versions`, so the server must have 4.0.9 installed, which it does.
- **Gems on the server:** `capistrano/bundler` installs `without development:test`, so the server doesn't need the Capistrano gems.
- **Stage:** `production` (`config/deploy/production.rb`, server `mendicant.com`, user `jason`).
- **Capistrano gems:** in the Gemfile's `:development` group. `ruby/setup-ruby` with `bundler-cache: true` installs every group unless `BUNDLE_WITHOUT` is set, so the runner gets them. The workflow must not set `BUNDLE_WITHOUT`/`BUNDLE_DEPLOYMENT` to exclude development.

### Story: add `.github/workflows/deploy.yml`
As the owner, I want a push to `main` to deploy automatically, so that I don't have to run `cap production deploy` by hand.
- Trigger on push to `main`, plus `workflow_dispatch`. Run on `ubuntu-latest`, with a `concurrency` group (for example `deploy-production`, `cancel-in-progress: false`) so two deploys never overlap.
- Steps:
  1. `actions/checkout@v4`.
  2. `ruby/setup-ruby@v1` with `bundler-cache: true`, reading `.ruby-version`.
  3. `webfactory/ssh-agent@v0.9.0` with `ssh-private-key: ${{ secrets.DEPLOY_SSH_KEY }}`.
  4. Append `${{ secrets.DEPLOY_KNOWN_HOSTS }}` to `~/.ssh/known_hosts`. Host key checking stays on.
  5. `bundle exec cap production deploy`.
- Only deploy when the tests pass: run after the existing `Tests` workflow succeeds on `main` (`workflow_run`), or make the test job a `needs:` of the deploy job.
- Watch out for the Ruby version: `.ruby-version` is `4.0.9`, released 2026-10-23. If `ruby/setup-ruby` doesn't have a 4.0.9 build yet, the job fails at setup. The test workflow uses `ruby-version: "4.0"` for this reason; the deploy job can do the same until 4.0.9 is available.
- Local deploys keep working unchanged, since nothing in the Capistrano config changes.
- **Test:** a `workflow_dispatch` run deploys, `current/REVISION` on the server matches the pushed commit, and a second dispatch while one is running waits.

### Story: decide how the server fetches the repo
Agent forwarding means the server clones from GitHub over SSH with the runner's deploy key, so GitHub must accept that key. Even for a public repo, SSH clones need a registered key.
- **Option A (no config change):** add `gha_deploy.pub` to the repo as a read-only Deploy Key.
- **Option B:** since the repo is public, switch `repo_url` to `https://github.com/mendicantx/ffrk-ability-parser.git`. Then no GitHub key is needed for the clone, `forward_agent` becomes unnecessary, and local deploys work too. Recommended unless the repo might go private.

### Manual steps for the owner
1. **Generate the key pair:** `ssh-keygen -t ed25519 -C "github-actions-deploy" -f ./gha_deploy -N ""`.
2. **Let it log in:** append `gha_deploy.pub` to `/home/jason/.ssh/authorized_keys` on the droplet.
3. **Let the server pull the repo:** with Option A, add `gha_deploy.pub` as a read-only Deploy Key on this repo. With Option B, skip this step.
4. **Get the host key:** `ssh-keyscan mendicant.com`. Check the ed25519 fingerprint against `sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the droplet.
5. **Add repo secrets:**
   - `DEPLOY_SSH_KEY`: the private key contents.
   - `DEPLOY_KNOWN_HOSTS`: the keyscan output.

   Then delete the local private key.
6. **Check the firewall:** the DigitalOcean cloud firewall and ufw must allow SSH (22) from GitHub-hosted runners, whose IPs vary widely. If SSH is limited to a home IP, the alternatives are:
   - a self-hosted runner on the droplet, which deploys to itself with no inbound SSH;
   - a Tailscale step (`tailscale/github-action`) with the droplet on the tailnet.
7. **Shared files:** `.env` is a Capistrano linked file. It already exists in `shared/` on the server, so nothing changes.

### Cost
GitHub-hosted runners are free for public repos (this repo is public).

## Requested features (owner, 2026-10-23, for later)

1. **Jump from a placeholder to fixing it.** Where the decoder writes `<ability missing from Other Tab>`, show a popup or a link that opens a new tab directly on that item, ready to parse and add to the sheet. Open question: the missing item is an ability (a follow-up), and the Ability Parser needs its JSON to describe it. The link could open the parser pre-filled with what's known (ability ID, the status it belongs to, character), asking for the paste.
2. **Reload just the statuses.** After filling in the sheet, reload only the Status (and Other) sheet data so the decoder picks up the new names, without a full refresh of everything (today's Refresh data re-fetches all sheets and battle.js, at most once per 5 minutes).

## Owner answers (2026-10-23)

Recorded in `docs/decisions.md` under "Sheet conventions":
- Naming defaults accepted: `Cid (XIV)` and the other Cids as in the Characters sheet (`Cid Raines` for FFXIII, `Cidolfus` for FFXVI), series as `FFVII`, `NE`, the Characters sheet as the master list, and the sheet's Tier when a row exists.
- Decoder wording should match the sheet (Learning Mode first).
- The Element column always includes NE. Conditional elements are joined with "or".
- Hybrid means two damage types, not "Type is NAT".
- Non-CF chase text is handled case by case.
- `scripts/infer_statuses.py` is out of scope (story 19 dropped).
- Keep the translate call.
- Soul break JSON will come as pasted soul breaks, not whole battles.

Still open, to settle with examples once the Buster and Tactical captures arrive:
- **Target rules:** the four preview builders pick the Target column differently.
- **Follow-up elements:** merge across all hits, with "or" for conditional elements, as Kiros's Buster chase does.

## Cross-cutting items

- **CI:** a GitHub Actions workflow running `node --test` and `bin/rails test`, added with story 9.
- **HTML escaping:** sheet and capture values go into `innerHTML` unescaped. Fixed when rendering is consolidated in stories 16–17.
- **New battle.js process:** run `rake data:refresh`, then `rake data:snapshot`, then review the golden diff. Documented in story 2 and used by story 14.
- **Production assets and CSP:** checked in stories 10 and 11.
