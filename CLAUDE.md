# ffrk-community-db

A Rails 7 data mashup and analysis app for FFRK community data, intended to eventually serve as a public-facing website.

## Project decisions

| Aspect | Decision | Reason |
|---|---|---|
| Framework | Rails 7.0.3 | User preference for Ruby web layer |
| Ruby | 4.0.1 via asdf | Managed with asdf; `.tool-versions` pins the version |
| Database | None (in-memory only) | Keeps it simple for now |
| Google Sheets | Published CSV export URL per tab | No credentials needed; sheet must be published publicly |
| battle.js | Dean Edwards p,a,c,k,e,r packed JS | Unpacked to raw JS string; content is AMD module code, not JSON |
| Data refresh | On server boot via initializer | `DataLoader.refresh_all` runs automatically; rake task also available |

## Data sources

Configure via environment variables (copy `.env.example` to `.env`):

### Google Sheets tabs (same spreadsheet, different gid per tab)

| Env var | Sheet tab | gid |
|---|---|---|
| `SOUL_BREAKS_SHEET_URL` | Soul Breaks tab | 344457459 |
| `CHARACTERS_SHEET_URL` | Characters tab | 1771023676 |
| `STATUS_SHEET_URL` | Status tab | 1899148923 |
| `OTHER_SHEET_URL` | Other tab | 2001933731 |

To add a new sheet tab: add an entry to `GOOGLE_SHEETS` in `lib/data_loader.rb` and set the corresponding env var.

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
| `app/models/data_store.rb` | Singleton in-memory store (`DataStore.instance`) |
| `lib/data_loader.rb` | `DataLoader.refresh_all`; defines `GOOGLE_SHEETS` config table; used by initializer and rake |
| `lib/importers/sheets_importer.rb` | Fetches and parses Google Sheets CSV |
| `lib/importers/battle_js_importer.rb` | Fetches battle.js, unpacks p,a,c,k,e,r JS (supports base 62), returns raw JS string |
| `lib/tasks/data.rake` | `rake data:refresh`, `rake data:battle_js`, `rake data:status` |
| `config/initializers/data_refresh.rb` | Triggers `DataLoader.refresh_all` on server boot (skipped during rake tasks) |
| `app/controllers/dashboard_controller.rb` | Root page; reads from DataStore |
| `app/views/dashboard/index.html.erb` | Collapsible sections per sheet + battle.js; js-beautify formats JS in browser |

## Common commands

```bash
# Start the server (auto-loads all data on boot)
bin/rails server

# Manually refresh all data
rake data:refresh

# Fetch and print battle.js to stdout
rake data:battle_js

# Check what's currently in memory
rake data:status
```

## Architecture notes

- `DataStore` uses Ruby's `Singleton` module — one instance per Rails process.
  Data loads automatically on boot via `config/initializers/data_refresh.rb`.
- Sheet data is stored in a hash keyed by symbol: `DataStore.instance.sheets` → `{ soul_breaks: [...], ... }`.
  Access a single sheet with `DataStore.instance.sheet(:soul_breaks)`.
- `SheetsImporter` follows HTTP redirects (Google Sheets redirects before serving CSV).
- `BattleJsImporter` unpacks p,a,c,k,e,r JS using a custom base-62 decoder (Ruby's `String#to_i` only supports up to base 36).
  Returns the unpacked JS as a plain string — content is AMD `define()` module code, not JSON.
- `DataLoader` is the shared entry point used by both the boot initializer and rake tasks.
- Importers live in `lib/importers/`; `DataLoader` lives in `lib/`. Both are eager-loaded via `config/application.rb`.
- The dashboard formats battle.js in the browser using js-beautify (CDN) on first expand of the `<details>` element.

## Roadmap / next steps

- Determine what data to extract from battle.js (BGM IDs, battle IDs, event logic, etc.)
- Write analysis/mashup logic against the Google Sheets data
- Style the dashboard beyond plain HTML
- Consider adding more data sources as needed
