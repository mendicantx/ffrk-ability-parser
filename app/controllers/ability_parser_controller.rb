require_relative '../../lib/importers/battle_js_importer'
require_relative '../../lib/importers/sheets_importer'
require_relative '../../lib/data_loader'

class AbilityParserController < ApplicationController
  # GET /ability_parser
  def index
  end

  # GET /ability_parser/sheet_data
  # Fetches every sheet in DataLoader::GOOGLE_SHEETS live on every request.
  def sheet_data
    result = DataLoader.sheet_urls.transform_values { |url| SheetsImporter.fetch(url) }
    render json: result
  rescue => e
    render json: { error: e.message }, status: :internal_server_error
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
