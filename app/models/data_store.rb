# File-backed singleton store for all ingested data.
# Data is written to disk by DataLoader (rake data:refresh) and read back here.
# On server boot, reload! is called automatically — no network calls needed.
#
# Usage:
#   DataStore.instance.sheet(:soul_breaks)       # => Array of CSV row hashes
#   DataStore.instance.sheets                    # => { soul_breaks: [...], ... }
#   DataStore.instance.battle_js_data            # => Unpacked JS string
#   DataStore.instance.status_ailments_from_js  # => { "KEY" => id, ... }
#   DataStore.instance.last_refreshed_at        # => Time or nil

require 'singleton'
require 'json'

class DataStore
  include Singleton

  DATA_DIR       = Rails.root.join('data').freeze
  SHEETS_DIR     = DATA_DIR.join('sheets').freeze
  BATTLE_JS_FILE = DATA_DIR.join('battle_js.txt').freeze
  AILMENTS_FILE  = DATA_DIR.join('status_ailments.json').freeze
  METADATA_FILE  = DATA_DIR.join('metadata.json').freeze

  attr_reader :sheets, :battle_js_data, :status_ailments_from_js, :last_refreshed_at

  def initialize
    load_from_disk!
  end

  def reload!
    load_from_disk!
  end

  def sheet(name)
    @sheets[name] || []
  end

  def refreshed?
    !@last_refreshed_at.nil?
  end

  private

  def load_from_disk!
    @sheets                  = load_sheets
    @battle_js_data          = load_text(BATTLE_JS_FILE)
    @status_ailments_from_js = load_json(AILMENTS_FILE) || {}
    @last_refreshed_at       = load_timestamp
  end

  def load_sheets
    result = {}
    return result unless SHEETS_DIR.exist?

    SHEETS_DIR.glob('*.json').each do |path|
      name = path.basename('.json').to_s.to_sym
      data = load_json(path)
      result[name] = data if data
    end
    result
  end

  def load_json(path)
    return nil unless File.exist?(path)
    JSON.parse(File.read(path, encoding: 'UTF-8'))
  rescue JSON::ParserError
    nil
  end

  def load_text(path)
    return nil unless File.exist?(path)
    File.read(path, encoding: 'UTF-8')
  end

  def load_timestamp
    meta = load_json(METADATA_FILE)
    return nil unless meta && meta['last_refreshed_at']
    Time.parse(meta['last_refreshed_at'])
  rescue ArgumentError
    nil
  end
end
