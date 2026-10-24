# ffrk-community-db

A Rails 7 app for maintaining the FFRK community Google Sheet, intended to eventually serve as a public-facing website. It has two tools:

- **Ability Parser** (`/ability_parser`): paste a soul break's JSON and get its rows for the sheet (Soul Breaks, Other and Extra tabs), ready to copy. Statuses the Status tab doesn't have yet are listed with a row to paste into that tab.
- **Status Decoder** (`/status_decoder`): look up any status by coded name or ID and get its Status-tab row.

Both read the community sheet and the game's own code (battle.js). The dashboard (`/`) shows the cached data.

## How we work

These are the owner's standing decisions. Follow them without asking again.

- **The sheet is the reference.** Where the tools and the sheet disagree, the tools follow the sheet. Where the sheet disagrees with itself, follow its most common form: count the variants in the snapshot, write the counts and the rule in [`docs/decisions.md`](docs/decisions.md), and ask the owner only when the counts are close.
- **The Status tab comes first.** For a status, both tools use what the Status tab has and generate text only for what it lacks. Names of abilities (follow-ups) come from the Other tab as it has them. A follow-up and the status it grants are different things, even when similarly named.
- **Don't paper over the sheet.** When the sheet contradicts itself or the game data (a name that doesn't match, a stripped character), don't special-case it in code. Show what's there and raise it with the owner, with the counts and examples.
- **Record decisions.** Every rule about meanings, names, wording or sheet columns goes in `docs/decisions.md`, with the evidence (row counts, examples). Check it before changing behaviour; where it already settles a question, follow it.
- **Placeholders, not guesses.** Something the data can't tell us (an ability missing from the Other tab, a localized name) gets a visible placeholder such as `<ability missing from Other Tab>`, not an invented value. Assumptions are allowed only when the owner has approved them and they're recorded (for example, standard Soul Drive modes grant [Instant ATB 1]).
- **Localized names can't be derived.** Many older names ("Dark Bargain", "Awoken Savior") come from the English Global version's localization. Statuses added after Global closed have none, so the generated forms ("ATK +30%, DEF -30% (8s)") are what new rows use.

### Branches, backlog and releases

- The current work is the parser/decoder refactor. Its backlog, open questions and findings are in [`docs/refactor-backlog.md`](docs/refactor-backlog.md).
- Work happens on `feature/parser-decoder-refactor`, with one `task/<short-name>` branch per piece of work. When a task's tests pass, merge it into the feature branch with `--no-ff` and push.
- `main` gets the feature branch only after the owner has tested it end to end. Don't merge to `main` or deploy on your own.
- Deploys: a push to `main` deploys automatically once the Tests workflow passes (`.github/workflows/deploy.yml`). The owner can also deploy by hand with `bundle exec cap production deploy`, which needs a typed password, so never run it yourself. Give any command the owner must run as one copy-pasteable block that starts with `cd E:\workspaces\ffrk-ability-parser`.
- The GitHub CLI (`gh`) is signed in with the owner's fine-grained token: their own repositories only, no organizations or gists, and no access to repository secrets. Secrets are added by the owner in the browser.
- Run the automated tests yourself and keep going between tasks; the owner tests at the end.

### Soul break fixtures

- The owner supplies soul break JSON on request: ask for it by the soul break's **Name (JP)** (and its ID), as listed on the Soul Breaks tab.
- Save each paste as `test/fixtures/battles/<character>-<tier>.txt` exactly as pasted, except remove `additional_animation_infos` (animation data only). Add a row to `test/fixtures/battles/README.md` saying what it covers.
- Then compare the parser's rows with the sheet, fix what that turns up, regenerate the golden files and raise the parser floor. Each fixture so far has found real parser bugs.

## Project decisions

| Aspect | Decision | Reason |
|---|---|---|
| Framework | Rails 7.0 (7.0.10) | User preference for Ruby web layer |
| Ruby | 4.0.9 via asdf | `.tool-versions` pins the exact version; the Gemfile allows `~> 4.0` |
| Database | None; data is cached as files in `data/` | Keeps it simple for now |
| Google Sheets | Published CSV export URL per tab | No credentials needed; sheet must be published publicly |
| battle.js | Dean Edwards p,a,c,k,e,r packed JS | Unpacked to raw JS string; content is AMD module code, not JSON |
| Game data | battle.js is executed (Web Worker in the browser, `vm` in tests) | Gives every status's real config instead of guessing from source text |
| Data refresh | `rake data:refresh`, the Refresh button on either tool, or a daily cron | The server only reads the cache; it never fetches on page load |

## Data sources

Configure via environment variables (copy `.env.example` to `.env`):

### Google Sheets tabs (same spreadsheet, different gid per tab)

| Env var | Sheet tab | gid |
|---|---|---|
| `SOUL_BREAKS_SHEET_URL` | Soul Breaks tab | 344457459 |
| `CHARACTERS_SHEET_URL` | Characters tab | 1771023676 |
| `STATUS_SHEET_URL` | Status tab | 1899148923 |
| `OTHER_SHEET_URL` | Other tab | 2001933731 |
| `HERO_ABILITIES_SHEET_URL` | Hero Abilities tab | 329671300 |
| `EXTRA_SHEET_URL` | Extra tab | 1700445928 |

To add a new sheet tab: add an entry to `GOOGLE_SHEETS` in `lib/data_loader.rb`, add its env var to `.env.example`, and set it in `.env`. `GOOGLE_SHEETS` is the only sheet list.

The CSV is read as UTF-8 (`SheetsImporter.parse_csv`), so Japanese text such as Name (JP) is kept; only invalid bytes and a leading byte-order mark are dropped.

### Action Args sheet (separate spreadsheet)

| Env var | Sheet | Notes |
|---|---|---|
| `ACTION_ARGS_SHEET_URL` | Actions Args | Different spreadsheet ID; accessed via gviz CSV export (no gid needed, uses sheet name in URL) |

Maps `action_id` → formula class name + named parameter list (e.g. `damageFactor`, `atkElement`, `saId`). The parser uses it to know what each arg in an ability's options means. Where a row is missing or blank, `ACTION_ARG_SUPPLEMENTS` in `ability_parser.js` fills the gaps (it never overrides the sheet).

### Other sources

- `BATTLE_JS_URL` — `https://dff.sp.mbga.jp/dff/static/js/event/challenge/battle.js`
  Dean Edwards p,a,c,k,e,r packed JavaScript, unpacked to a raw JS string (AMD module code). The unpacked text is byte-identical to what a browser's `eval` produces, so it can be executed.

## Key files

| File | Purpose |
|---|---|
| `app/models/data_store.rb` | Singleton that reads the `data/` cache (`DataStore.instance`); reloads when `metadata.json` changes |
| `app/controllers/data_controller.rb` | Serves the cache to both tools: `/data/sheets`, `/data/battle_js`, `/data/status`, and the rate-limited `POST /data/refresh` |
| `lib/data_loader.rb` | `DataLoader.refresh_all` fetches every source into `data/`; defines the `GOOGLE_SHEETS` registry |
| `lib/importers/sheets_importer.rb` | Fetches and parses Google Sheets CSV (UTF-8) |
| `lib/importers/battle_js_importer.rb` | Fetches battle.js, unpacks p,a,c,k,e,r JS (base 62, JS string unescaping), returns raw JS string |
| `lib/http_fetch.rb` | `HttpFetch.get`: GET with redirect following, used by both importers |
| `lib/data_snapshot.rb` | Writes the gzipped test snapshot of `data/` with a SHA-256 manifest |
| `lib/tasks/data.rake` | `rake data:refresh`, `rake data:battle_js`, `rake data:status`, `rake data:snapshot` |
| `app/javascript/pages/ability_parser.js` | Ability Parser page: parses soul break JSON, builds the sheet previews, lists statuses missing from the Status tab |
| `app/javascript/pages/status_decoder.js` | Status Decoder page: loading, search and rendering around the shared engine |
| `app/javascript/ffrk/status_decoder.js` | The Status Decoder engine, `createStatusDecoder()`: battle.js assignment scanning, helper decoders, `decodeStatus`. Used by both pages |
| `app/javascript/ffrk/status_text.js` | Describes a status from its game config: per-effect wording, mode families (Master, Zenith, Soul Drive, Dual Awoken, Awoken, …), and older statuses read from their coded names |
| `app/javascript/ffrk/status_context.js` | Builds the lookups `status_text` needs from the sheets (names, Other-tab sources and effects, characters) |
| `app/javascript/ffrk/battle_runtime.js` | Runs battle.js (Web Worker in the browser, `vm` under Node) and returns `{ conf, statusParams }` |
| `app/javascript/ffrk/names.js` | Shared naming: realms, schools (SHOOTER is "Sharpshooter"), elements, character corrections (`CHAR_CORRECTIONS`), `titleCase` |
| `app/javascript/ffrk/battle_js.js`, `server_data.js` | Constant extraction from battle.js text; `/data` fetch helpers |
| `public/vendor/` | underscore 1.13.7, loaded only inside the battle.js Worker |
| `docs/decisions.md` | Every rule about meanings, names and wording, with evidence |
| `docs/refactor-backlog.md` | Stories, findings, open questions for the owner, release steps |
| `.github/workflows/test.yml` | CI: Ruby, JavaScript and Python tests on every push |
| `.github/workflows/deploy.yml` | Deploys `main` with Capistrano after Tests pass, or by hand (needs the `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS` secrets) |
| `config/deploy.rb`, `config/deploy/production.rb` | Capistrano: `mendicant.com` as `jason`, repo cloned over HTTPS, no agent forwarding |
| `test/js/harness.mjs` | Runs both pages unchanged in Node with a fake DOM and a fetch that serves the snapshot; golden-file helpers |
| `test/browser/smoke.mjs` | Browser smoke test: drives both tools in headless Edge/Chrome over the DevTools Protocol |
| `test/fixtures/battles/` | Soul break JSON pasted by the owner, one fixture per soul break |
| `test/fixtures/snapshot/` | Gzipped copy of `data/` the tests run against |
| `test/fixtures/golden/` | Saved output: `statuses.jsonl` (every status key) and `parser/<fixture>.{tsv,html}` |
| `config/initializers/data_refresh.rb` | Loads the `data/` cache into `DataStore` on boot (no network) |
| `app/views/dashboard/index.html.erb` | Collapsible sections per sheet + battle.js; js-beautify formats JS in browser |

## Common commands

```bash
# Start the server (reads the data/ cache; run rake data:refresh first on a fresh checkout)
bin/rails server

# Refresh all data, then freeze it into the test snapshot
rake data:refresh
rake data:snapshot

# Check what's in the data/ cache
rake data:status

# Ruby tests
bin/rails test

# JavaScript tests (page scripts run in Node against the test snapshot)
node --test "test/js/*.test.mjs"

# Regenerate golden files after an intended output change (bash; in PowerShell: $env:UPDATE_GOLDEN='1')
UPDATE_GOLDEN=1 node --test "test/js/*.test.mjs"

# Python tests (scripts/infer_statuses.py, out of scope for the refactor but still in CI)
python -I -m unittest discover -s test/python

# Browser smoke test against a running server (needs Edge or Chrome)
node test/browser/smoke.mjs http://localhost:3000
```

## Testing

- **Golden files** must stay byte-identical for changes that only move code. When output is meant to change, regenerate them in the same commit and check the diff: in `statuses.jsonl`, no status that was decoded may stop being decoded (`"decoded":true` lines removed, `"decoded":false` lines added), and every changed row should be explainable.
- **Floors** measure progress and may only go up:
  - `parser.sheet-match.test.mjs`: parser cells that match the sheet (`FLOOR_TOTAL`).
  - `decoder.sheet-match.test.mjs`: decoded names and effects that match the Status tab, overall and per family (`FLOORS`). It compares the decoder's *generated* text, to measure the generator.
  - `decoder.coverage.test.mjs`: statuses missing from the Status tab that the decoder can describe (`FLOOR`).
  Raise a floor when a change improves it. Lower one only for a recorded reason (an owner decision or a sheet change), with a comment saying why.
- **`repack.test.mjs`** renames battle.js's minified helpers and checks the decoder still decodes the same statuses: decoders are chosen by fingerprint, never by minified names.
- **Smoke test:** start a server on a spare port, run `test/browser/smoke.mjs` against it, then stop the server. On Windows, stop it by port; `kill $(cat tmp/pids/server.pid)` doesn't stop it:
  ```powershell
  Get-NetTCPConnection -LocalPort 3017 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
  ```
- **New battle.js or sheet data:** `rake data:refresh`, `rake data:snapshot`, run the tests, review the golden diffs, and raise or explain any floor changes.

## Architecture notes

- `DataStore` uses Ruby's `Singleton` module — one instance per Rails process. It loads the `data/` files on boot, and `DataController` calls `reload_if_changed!` on each request so a refresh by cron or rake is picked up without a restart.
- Both tools fetch from `DataController` (`/data/*`). The older `/ability_parser/sheet_data`, `/ability_parser/battle_js` and `/status_decoder/sheet_data` URLs are aliases.
- `DataLoader` is the only code that fetches from the network (rake tasks and `POST /data/refresh`).
- Page scripts are ES modules under `app/javascript/pages/`, loaded with `javascript_import_module_tag`; shared code lives in `app/javascript/ffrk/` and is imported as `ffrk/<name>` (importmap in the browser, a resolve hook in `test/js/harness.mjs` under Node). Pages export the names the Node tests read. Generated HTML must not use inline `onclick="fn()"` handlers that call module functions; use delegated listeners (enforced by `test/js/harness.test.mjs`).
- **Describing a status** (`createStatusDecoder().decodeStatus(key)`) tries, in order: a helper decoder chosen by the fingerprint of the battle.js helper that assigns the status; the status's game config (`status_text.describeStatus`: mode families first, then one clause per effect, all or nothing); the values spelled out in an older coded name (`describeStatusFromKey`). A status is described only when every effect is understood.
- **Game data** comes from executing battle.js (`battle_runtime.js`) with stub `define`/`require`, an `FF` namespace proxy and underscore. Both pages start it after battle.js loads; parsing doesn't wait for it, and the parser re-renders the last parse when it arrives. The test harness runs it once per test process.
- **The Ability Parser** names statuses from the Status tab and falls back to the decoder engine. Statuses without a Status-tab row are underlined in the previews and listed in a "Not on the Status tab" section, each with its paste-ready row and the existing status it goes after (the tab is kept in ascending ID order and rows are added one at a time).
- Second Soul Breaks rows under the same ID — a Tactical soul break's "(Weapon Skill)" and a Dual Awoken soul break's "(Dual Shift)" — come from `SECOND_ROWS` in `ability_parser.js`, with `-ws` / `-ds` on-page ids.
- The dashboard formats battle.js in the browser using js-beautify (CDN) on first expand of the `<details>` element.

## Production

The site runs on `mendicant.com` (Passenger) from `/data/www/ffrk-ability-parser`. GitHub Actions deploys it after Tests pass on a push to `main`; manual deploys use the same command locally. Setup and checks for the Actions deploy are in the backlog under "Release: deploy from GitHub Actions".

`data/` is a Capistrano linked dir (`shared/data` on the server), so the cache survives deploys. On a deploy where `shared/data/metadata.json` doesn't exist, the `data:refresh_if_missing` hook in `config/deploy.rb` runs `rake data:refresh` before Passenger restarts.

To refresh daily, add a cron entry for the deploy user on the server:

```
0 6 * * * cd /data/www/ffrk-ability-parser/current && RAILS_ENV=production /data/www/ffrk-ability-parser/shared/asdf-wrapper bundle exec rake data:refresh
```

## Tooling notes (Windows)

The shell is Git Bash on Windows. These cost real time in past sessions:

- **Escapes get mangled** when JavaScript or Ruby containing regexes is written through bash heredocs, inline `python -`/`node -e` scripts or `sed`: `\b` became a backspace character and `\d` lost its backslash. Make code edits with the Edit or Write tools, which take text literally. If a script did write code, scan for control characters and check regexes before moving on.
- **`String.prototype.replace` with a string replacement** treats `$&`, `$'` and `$1` in the inserted text as patterns, which corrupted moved code once. When a script inserts code, pass a function: `s.replace(a, () => b)`.
- **Check what a scripted edit did** (`git diff --stat`) before committing: one edit to `docs/refactor-backlog.md` once dropped the rest of the file.
- The scratchpad directory is for comparison scripts and other throwaway files; nothing there is part of the project.

## Roadmap / next steps

The live list is in `docs/refactor-backlog.md`. In short:

- **Owner:** end-to-end testing of the feature branch, merge to `main`, deploy, then press **Refresh data** once in production so its cache gets the Japanese text.
- **Owner:** the GitHub Actions deploy is built; it needs the one-time key and secrets setup in the backlog ("Release: deploy from GitHub Actions") before its first run.
- **Waiting on JSON:** Lasswell's AASB (八垓抜刀 軌ら星, 23500020), Enna Kros's ASB (轟・Aの力, 23280023), Tama's SASB (99プラザの日常, 23290014).
- **Open question:** the 34 Tactical rows that say "[ATB_10%]" (backlog).
- **Requested features:** a link from `<ability missing from Other Tab>` to a page that parses that item; reloading only the Status and Other sheets.
- **Decoder:** about 230 statuses missing from the Status tab still don't decode — mostly one-offs, debug entries and damage trackers whose names only the localization has.
