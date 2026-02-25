require_relative '../../lib/importers/battle_js_importer'

class AbilityParserController < ApplicationController
  # GET /ability_parser
  def index
  end

  # GET /ability_parser/sheet_data
  # Returns server-cached sheet data as JSON, avoiding client-side CORS issues with Google Sheets.
  def sheet_data
    store = DataStore.instance
    render json: {
      status:      store.sheet(:status),
      action_args: store.sheet(:action_args),
      soul_breaks: store.sheet(:soul_breaks),
      other:       store.sheet(:other),
    }
  end

  # GET /ability_parser/battle_js
  # Proxies BATTLE_JS_URL and returns the unpacked JS text, bypassing browser CORS restrictions.
  def battle_js
    url = ENV['BATTLE_JS_URL']
    if url.blank?
      render plain: '// BATTLE_JS_URL not configured', status: :internal_server_error
      return
    end
    js_text = BattleJsImporter.fetch(url)
    render plain: js_text, content_type: 'text/plain'
  rescue => e
    render plain: "// Error fetching battle.js: #{e.message}", status: :internal_server_error
  end
end
