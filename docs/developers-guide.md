# Developer guide

A short guide to getting the code, running it, and making a change.

## A Claude-driven project

Most of this code is written and changed by Claude (Claude Code), working with the owner (mendicantx). The owner decides what the tools should do and how they should read; Claude does most of the implementation, testing and documentation, and works through task branches and pull requests. Keep that in mind:

- **[`CLAUDE.md`](../CLAUDE.md) is the rulebook.** It records how the project works: the sheet is the reference, the Status tab comes first, branches and releases, the testing routine, the architecture, and known pitfalls. Claude reads it at the start of every session, so keep it current; when a way of working changes, change it there.
- **[`docs/decisions.md`](decisions.md) is the memory for meanings and wording.** Every rule about names, wording or sheet columns is there, with the evidence (row counts, examples). Check it before changing what the tools output.
- **[`docs/refactor-backlog.md`](refactor-backlog.md) holds the work list**, open questions for the owner, and release steps.
- **Expect documentation in the same change as the code.** A behaviour change comes with its `decisions.md` entry, updated golden files, and the test floors that measure it.

You can work by hand, by asking Claude, or both; the same rules apply either way.

## What it is

A Rails 7 app with two tools for maintaining the FFRK community Google Sheet:

- **Ability Parser** (`/ability_parser`): paste a soul break's JSON, get its sheet rows, plus paste-ready Status-tab rows for statuses the tab doesn't have yet.
- **Status Decoder** (`/status_decoder`): look up a status by coded name or ID and get its Status-tab row.

Both read the community sheet and the game's own code (battle.js). The live site is https://ffrktools.mendicant.com.

## Getting the code

The repository is public: https://github.com/mendicantx/ffrk-ability-parser

- **To read or run it:** clone it.
  ```bash
  git clone https://github.com/mendicantx/ffrk-ability-parser.git
  cd ffrk-ability-parser
  ```
- **To contribute:** fork it and open a pull request against `main`, or ask the owner for collaborator access. Only the owner merges, because merging to `main` deploys the live site.

## Running it locally

You need:
- **Ruby 4.0.9** (`.tool-versions` / `.ruby-version`; asdf on Linux and macOS, RubyInstaller on Windows).
- **Node 24**, for the JavaScript tests.
- **Python 3.12**, only for the legacy `scripts/infer_statuses.py` tests.
- **Edge or Chrome**, for the browser smoke test.

```bash
bundle install
cp .env.example .env        # fill in the published sheet URLs and BATTLE_JS_URL (ask the owner)
bin/rake data:refresh       # fetch the sheets and battle.js into data/ (not committed)
bin/rails server            # http://localhost:3000
```

The app has no database: everything it shows comes from the `data/` cache, which `rake data:refresh` (or the Refresh data button) fills.

## Making a change

1. **Branch from `main`:** `git switch -c task/<short-name>`.
2. **Make the change.** For output changes, follow `docs/decisions.md`. Where the sheet is inconsistent, use its most common form and record the counts there. Where it contradicts itself or the game data, raise it with the owner rather than special-casing it in code.
3. **Run the tests:**
   ```bash
   bin/rails test
   node --test "test/js/*.test.mjs"
   ```
   - **Golden files** (`test/fixtures/golden/`) must not change unless you meant the output to change. If you did, regenerate them with `UPDATE_GOLDEN=1 node --test "test/js/*.test.mjs"` (PowerShell: `$env:UPDATE_GOLDEN='1'`) and read the diff.
   - **Floors** in `test/js/*sheet-match*` and `decoder.coverage.test.mjs` count how often the output matches the sheet. They may only go up; raise them when your change improves them.
   - **Browser smoke test**, against a running server: `node test/browser/smoke.mjs http://localhost:3000`.
4. **Open a pull request** to `main`. CI runs the Ruby, JavaScript and Python tests.
5. **After the owner merges it,** GitHub Actions deploys it once the tests pass on `main`. Check the live site with the same smoke test: `node test/browser/smoke.mjs https://ffrktools.mendicant.com`.

## Adding a soul break as a test case

Each new kind of soul break gets a fixture, and each one so far has turned up parser bugs. Save the pasted JSON as `test/fixtures/battles/<character>-<tier>.txt` (removing only `additional_animation_infos`), add a line to that folder's `README.md`, compare the parser's rows with the sheet, fix what that shows, then regenerate the golden files and raise the parser floor.

## Where things are

| Path | What |
|---|---|
| `app/javascript/pages/` | The two tools' page scripts |
| `app/javascript/ffrk/` | Shared modules: the Status Decoder engine, status wording, battle.js runtime, naming |
| `lib/` | Data fetching (`DataLoader`, importers) and the test snapshot |
| `test/js/`, `test/browser/` | JavaScript tests and the browser smoke test |
| `test/fixtures/` | Soul break fixtures, the data snapshot, golden output |
| `.github/workflows/` | CI (`test.yml`) and the deploy (`deploy.yml`) |

`CLAUDE.md` has the full file list and architecture notes.
