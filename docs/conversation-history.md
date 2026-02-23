# Project Inception Conversation

> Date: 2026-02-21
> Tool: Claude Code (claude-sonnet-4-6)
> Working directory at time of conversation: `/Users/jason/domino/csec/csec-analytics-dbx-ticketmaster-silver`

---

## Summary

This conversation covers the creation of the `ffrk-community-db` project from scratch, including all architectural decisions made interactively.

---

## Conversation transcript

**User:** I would like to start a new project.

**Claude:** What kind of project do you have in mind? A brief description will help me understand the scope, tech stack, and how to best help you get started.

---

**User:** This project will take data from several locations to mash up and do some analysis to start. Eventually, I would like to start serving up that data as a website.

Some of the data I will ingest will be from a google documents spreadsheet.

Some of the data will be from a web address that provides JSON using the PACKER notation.

I would prefer to utilize something simple for the web-layer like ruby.

**Claude:** *(Asked clarifying questions)*

- Ruby framework preference → **Rails**
- PACKER notation clarification → **Dean Edwards p,a,c,k,e,r obfuscation** (packed JavaScript that must be unpacked to extract JSON)
- Data persistence → **In-memory only** (no database)

---

**Claude:** *(Asked follow-up questions)*

- Google Sheets access method → **Published CSV export URL** (no credentials needed; sheet must be published publicly)
- Data refresh strategy → **Manually triggered** (rake task or admin endpoint)

---

**User:** My projects folder is `/Users/jason/workspaces/`. I would like it to live within there. I would like this project to be called `ffrk-community-db`.

**Claude:** *(Verified Ruby 2.7.0 and Rails 7.0.3 were available, then scaffolded the project)*

```bash
rails _7.0.3_ new ffrk-community-db \
  --skip-active-record \
  --skip-action-mailer \
  --skip-action-mailbox \
  --skip-action-text \
  --skip-active-storage \
  --skip-action-cable \
  --skip-hotwire \
  --skip-jbuilder \
  -T
```

---

## Files created during this conversation

| File | Description |
|---|---|
| `app/models/data_store.rb` | Singleton in-memory store using Ruby's `Singleton` module |
| `lib/importers/sheets_importer.rb` | Fetches a publicly published Google Sheet as CSV; follows redirects; returns array of row hashes |
| `lib/importers/packer_importer.rb` | Fetches a URL, applies Dean Edwards p,a,c,k,e,r unpacking via regex + base-N decode, extracts first JSON object/array |
| `lib/tasks/data.rake` | `rake data:refresh` (fetches both sources, populates DataStore) and `rake data:status` |
| `app/controllers/dashboard_controller.rb` | Root controller; reads sheets_data and packer_data from DataStore |
| `app/views/dashboard/index.html.erb` | Basic dashboard: shows last refresh time, sheet rows as HTML table, packer JSON as pretty-printed pre block |
| `config/routes.rb` | Sets `root "dashboard#index"` |
| `config/application.rb` | Adds `lib/importers` to eager_load_paths |
| `.env.example` | Documents `SHEETS_CSV_URL` and `PACKER_JSON_URL` env vars |
| `CLAUDE.md` | Persistent project context for Claude Code sessions |
| `docs/conversation-history.md` | This file |

---

## Key architectural decisions and rationale

### In-memory storage
No database was provisioned. `DataStore` (a Ruby `Singleton`) holds all ingested data for the lifetime of the Rails process. Data is lost on server restart — `rake data:refresh` must be run after each start.

### Google Sheets via published CSV
Rather than using the Google Sheets API (which requires OAuth/service account credentials), the sheet is accessed via its public CSV export URL. The sheet must be published via **File > Share > Publish to web > CSV format**.

### Dean Edwards p,a,c,k,e,r unpacker
Implemented in pure Ruby. The packer format:
```
eval(function(p,a,c,k,e,r){...}('encoded_payload',base,count,'word|list',0,{}))
```
The unpacker:
1. Extracts `p` (payload), `a` (base/radix), `c` (word count), `k` (keyword list) via regex
2. Replaces each base-N encoded placeholder in the payload with the corresponding keyword
3. Scans the resulting JS for the first balanced `{...}` or `[...]` and parses it as JSON

### Manual refresh
Data is loaded by running `rake data:refresh`. No background scheduler or cron is set up. This keeps the initial setup simple; a scheduler can be added later.

---

## Environment variables

| Variable | Description |
|---|---|
| `SHEETS_CSV_URL` | Full published CSV export URL from Google Sheets |
| `PACKER_JSON_URL` | URL of the page serving the p,a,c,k,e,r packed JavaScript |

---

## Next steps (as of end of conversation)

1. Set real values for `SHEETS_CSV_URL` and `PACKER_JSON_URL` in `.env`
2. Validate the packer unpacker regex against the actual source URL
3. Write data analysis / mashup logic once both sources confirm loading
4. Style the dashboard beyond plain HTML tables
5. Consider additional data sources
