# ffrk-community-db

A Rails 7 data mashup and analysis app for FFRK community data, intended to eventually serve as a public-facing website.

## Decisions log

Decisions made during development — field meanings, naming conventions, sheet column mappings, and parsing choices — are tracked in [`docs/decisions.md`](docs/decisions.md). When a new decision is made (e.g. "this field means X in the sheet", "we call this mechanic Y"), add it there so future sessions have context.

## Project decisions

| Aspect | Decision | Reason |
|---|---|---|
| Framework | Rails 7.0.3 | User preference for Ruby web layer |
| Ruby | 4.0.9 via asdf | `.tool-versions` pins the exact version; the Gemfile allows `~> 4.0` |
| Database | None; data is cached as files in `data/` | Keeps it simple for now |
| Google Sheets | Published CSV export URL per tab | No credentials needed; sheet must be published publicly |
| battle.js | Dean Edwards p,a,c,k,e,r packed JS | Unpacked to raw JS string; content is AMD module code, not JSON |
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

### Action Args sheet (separate spreadsheet)

| Env var | Sheet | Notes |
|---|---|---|
| `ACTION_ARGS_SHEET_URL` | Actions Args | Different spreadsheet ID; accessed via gviz CSV export (no gid needed, uses sheet name in URL) |

Maps `action_id` → formula class name + named parameter list (e.g. `damageFactor`, `atkElement`, `saId`).
Used by the ability translator to know what each arg in an ability's JSON options means.

### Other sources

- `BATTLE_JS_URL` — `https://dff.sp.mbga.jp/dff/static/js/event/challenge/battle.js`
  Dean Edwards p,a,c,k,e,r packed JavaScript. Unpacked to a raw JS string (AMD module code).
  Stored as a string in `DataStore#battle_js_data`. Displayed formatted via js-beautify CDN in the dashboard.

## Key files

| File | Purpose |
|---|---|
| `app/models/data_store.rb` | Singleton that reads the `data/` cache (`DataStore.instance`); reloads when `metadata.json` changes |
| `app/controllers/data_controller.rb` | Serves the cache to both tools: `/data/sheets`, `/data/battle_js`, `/data/status`, and the rate-limited `POST /data/refresh` |
| `lib/data_loader.rb` | `DataLoader.refresh_all` fetches every source into `data/`; defines the `GOOGLE_SHEETS` registry |
| `lib/importers/sheets_importer.rb` | Fetches and parses Google Sheets CSV |
| `lib/importers/battle_js_importer.rb` | Fetches battle.js, unpacks p,a,c,k,e,r JS (supports base 62), returns raw JS string |
| `lib/tasks/data.rake` | `rake data:refresh`, `rake data:battle_js`, `rake data:status`, `rake data:snapshot` |
| `test/js/harness.mjs` | Runs both pages' scripts unchanged in a Node `vm` with a fake DOM and a fetch that serves the snapshot; golden-file helpers |
| `lib/data_snapshot.rb` | Writes the gzipped test snapshot of `data/` with a SHA-256 manifest |
| `config/initializers/data_refresh.rb` | Loads the `data/` cache into `DataStore` on boot (no network) |
| `app/controllers/dashboard_controller.rb` | Root page; reads from DataStore |
| `app/views/dashboard/index.html.erb` | Collapsible sections per sheet + battle.js; js-beautify formats JS in browser |

## Common commands

```bash
# Start the server (reads the data/ cache; run rake data:refresh first on a fresh checkout)
bin/rails server

# Manually refresh all data
rake data:refresh

# Fetch and print battle.js to stdout
rake data:battle_js

# Check what's in the data/ cache
rake data:status

# Run the Ruby tests
bin/rails test

# Run the JavaScript tests (page scripts run in Node against the test snapshot)
node --test "test/js/*.test.mjs"

# Run the Python tests (scripts/infer_statuses.py)
python -I -m unittest discover -s test/python

# Freeze data/ into the gzipped test snapshot (test/fixtures/snapshot)
rake data:snapshot
```

## Production data

`data/` is a Capistrano linked dir (`shared/data` on the server), so the cache survives deploys. On a deploy where `shared/data/metadata.json` doesn't exist, the `data:refresh_if_missing` hook in `config/deploy.rb` runs `rake data:refresh` before Passenger restarts.

To refresh daily, add a cron entry for the deploy user on the server:

```
0 6 * * * cd /data/www/ffrk-ability-parser/current && RAILS_ENV=production /data/www/ffrk-ability-parser/shared/asdf-wrapper bundle exec rake data:refresh
```

## Architecture notes

- `DataStore` uses Ruby's `Singleton` module — one instance per Rails process.
  It loads the `data/` files on boot, and `DataController` calls `reload_if_changed!` on each request
  so a refresh by cron or rake is picked up without a restart.
- Both tools fetch from `DataController` (`/data/*`). The older `/ability_parser/sheet_data`,
  `/ability_parser/battle_js` and `/status_decoder/sheet_data` URLs are aliases.
- Sheet data is stored in a hash keyed by symbol: `DataStore.instance.sheets` → `{ soul_breaks: [...], ... }`.
  Access a single sheet with `DataStore.instance.sheet(:soul_breaks)`.
- `SheetsImporter` follows HTTP redirects (Google Sheets redirects before serving CSV).
- `BattleJsImporter` unpacks p,a,c,k,e,r JS using a custom base-62 decoder (Ruby's `String#to_i` only supports up to base 36).
  Returns the unpacked JS as a plain string — content is AMD `define()` module code, not JSON.
- `DataLoader` is the only code that fetches from the network (rake tasks and `POST /data/refresh`).
- Importers live in `lib/importers/`; `DataLoader` lives in `lib/`. Both are eager-loaded via `config/application.rb`.
- The dashboard formats battle.js in the browser using js-beautify (CDN) on first expand of the `<details>` element.

## Roadmap / next steps

- Determine what data to extract from battle.js (BGM IDs, battle IDs, event logic, etc.)
- Write analysis/mashup logic against the Google Sheets data
- Style the dashboard beyond plain HTML
- Consider adding more data sources as needed
