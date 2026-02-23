require 'json'
require 'fileutils'
require_relative 'importers/sheets_importer'
require_relative 'importers/battle_js_importer'

# Fetches all configured data sources and writes each to its own file under data/.
# Used by rake data:refresh. The server reads from those files via DataStore.reload!
module DataLoader
  # Maps DataStore sheet keys to their environment variable names.
  # Add a new entry here to support an additional Google Sheet tab.
  GOOGLE_SHEETS = {
    soul_breaks: 'SOUL_BREAKS_SHEET_URL',
    characters:  'CHARACTERS_SHEET_URL',
    status:      'STATUS_SHEET_URL',
    other:       'OTHER_SHEET_URL',
  }.freeze

  def self.refresh_all
    FileUtils.mkdir_p(DataStore::SHEETS_DIR)

    GOOGLE_SHEETS.each do |name, env_var|
      url = ENV[env_var]
      if url.nil? || url.empty?
        Rails.logger.warn "[DataLoader] SKIPPED #{name}: #{env_var} is not set."
        next
      end

      Rails.logger.info "[DataLoader] Fetching #{name} sheet..."
      rows = SheetsImporter.fetch(url)
      write_json(DataStore::SHEETS_DIR.join("#{name}.json"), rows)
      Rails.logger.info "[DataLoader] #{name}: #{rows.size} rows written."
    rescue => e
      Rails.logger.error "[DataLoader] #{name} failed: #{e.message}"
    end

    battle_js_url = ENV['BATTLE_JS_URL']
    if battle_js_url.nil? || battle_js_url.empty?
      Rails.logger.warn "[DataLoader] SKIPPED battle.js: BATTLE_JS_URL is not set."
    else
      Rails.logger.info "[DataLoader] Fetching battle.js..."
      data = BattleJsImporter.fetch(battle_js_url)
      File.write(DataStore::BATTLE_JS_FILE, data, encoding: 'UTF-8')
      Rails.logger.info "[DataLoader] battle.js: #{data.length} chars written."

      ailments = BattleJsImporter.extract_status_ailments(data)
      write_json(DataStore::AILMENTS_FILE, ailments)
      Rails.logger.info "[DataLoader] battle.js: #{ailments.size} status ailment types written."
    end

    write_json(DataStore::METADATA_FILE, { 'last_refreshed_at' => Time.current.iso8601 })
    DataStore.instance.reload!
  rescue => e
    Rails.logger.error "[DataLoader] refresh failed: #{e.message}"
  end

  def self.write_json(path, data)
    File.write(path, JSON.generate(data), encoding: 'UTF-8')
  end
  private_class_method :write_json
end
