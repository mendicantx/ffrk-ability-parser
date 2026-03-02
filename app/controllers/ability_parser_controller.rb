require_relative '../../lib/importers/battle_js_importer'
require_relative '../../lib/importers/sheets_importer'

class AbilityParserController < ApplicationController
  # GET /ability_parser
  def index
  end

  # GET /ability_parser/sheet_data
  # Fetches all required sheets live from their configured URLs on every request.
  SHEET_VARS = {
    status:      'STATUS_SHEET_URL',
    action_args: 'ACTION_ARGS_SHEET_URL',
    soul_breaks: 'SOUL_BREAKS_SHEET_URL',
    other:       'OTHER_SHEET_URL',
    characters:  'CHARACTERS_SHEET_URL',
  }.freeze

  def sheet_data
    result = {}
    SHEET_VARS.each do |key, env_var|
      url = ENV[env_var]
      next if url.blank?
      result[key] = SheetsImporter.fetch(url)
    end
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
