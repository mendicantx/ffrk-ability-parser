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
    soul_breaks:     'SOUL_BREAKS_SHEET_URL',
    characters:      'CHARACTERS_SHEET_URL',
    status:          'STATUS_SHEET_URL',
    other:           'OTHER_SHEET_URL',
    hero_abilities:  'HERO_ABILITIES_SHEET_URL',
    extra:           'EXTRA_SHEET_URL',
    action_args:     'ACTION_ARGS_SHEET_URL',
  }.freeze

  # The column each sheet must have for the tools to use it. A download without it
  # (an error page, an unpublished or reshaped sheet) is rejected, keeping the old file.
  REQUIRED_COLUMNS = {
    soul_breaks:    'ID',
    characters:     'Name',
    status:         'ID',
    other:          'ID',
    hero_abilities: 'Name',
    extra:          'Name',
    action_args:    'action_id',
  }.freeze

  # A source that comes back with fewer than this share of its previous rows (or
  # characters, for battle.js) is treated as broken and not saved.
  MIN_SHARE_OF_PREVIOUS = 0.5

  # Returns { name => url } for the given sheet names (all by default),
  # leaving out any whose env var is not set.
  def self.sheet_urls(names = GOOGLE_SHEETS.keys)
    names.each_with_object({}) do |name, result|
      url = ENV[GOOGLE_SHEETS.fetch(name)]
      result[name] = url if url.present?
    end
  end

  # The sheets the tools can reload on their own, after statuses or follow-ups have been
  # added to the sheet, without a full refresh.
  QUICK_SHEETS = %i[status other].freeze

  # Fetches every source. A source that fails or doesn't look right keeps its previous
  # file. Returns { source => error message } for the ones that failed ({} when all
  # succeeded); the errors are also saved in metadata.json for /data/status.
  def self.refresh_all
    refresh(GOOGLE_SHEETS.keys, battle_js: true)
  end

  # Fetches only the named sheets (a subset of QUICK_SHEETS), with the same checks as
  # refresh_all. The full refresh time is kept; the reload time is saved as
  # sheets_refreshed_at. Returns { sheet => error message } like refresh_all.
  def self.refresh_sheets(names)
    refresh(names, battle_js: false)
  end

  def self.refresh(names, battle_js:)
    FileUtils.mkdir_p(DataStore::SHEETS_DIR)
    errors = {}

    GOOGLE_SHEETS.slice(*names).each do |name, env_var|
      url = ENV[env_var]
      if url.nil? || url.empty?
        Rails.logger.warn "[DataLoader] SKIPPED #{name}: #{env_var} is not set."
        next
      end

      Rails.logger.info "[DataLoader] Fetching #{name} sheet..."
      path = DataStore::SHEETS_DIR.join("#{name}.json")
      rows = SheetsImporter.fetch(url)
      check_sheet(name, rows, previous_size(path))
      write_json(path, rows)
      Rails.logger.info "[DataLoader] #{name}: #{rows.size} rows written."
    rescue => e
      errors[name.to_s] = e.message
      Rails.logger.error "[DataLoader] #{name} failed, previous data kept: #{e.message}"
    end

    refresh_battle_js(errors) if battle_js
    finish(errors, battle_js ? nil : names)
  rescue => e
    errors ||= {}
    errors['refresh'] = e.message
    Rails.logger.error "[DataLoader] refresh failed: #{e.message}"
    finish(errors, battle_js ? nil : names)
  end

  def self.refresh_battle_js(errors)
    url = ENV['BATTLE_JS_URL']
    if url.nil? || url.empty?
      Rails.logger.warn "[DataLoader] SKIPPED battle.js: BATTLE_JS_URL is not set."
      return
    end

    Rails.logger.info "[DataLoader] Fetching battle.js..."
    data = BattleJsImporter.fetch(url)
    ailments = BattleJsImporter.extract_status_ailments(data)
    check_battle_js(data, ailments)
    File.write(DataStore::BATTLE_JS_FILE, data, encoding: 'UTF-8')
    write_json(DataStore::AILMENTS_FILE, ailments)
    Rails.logger.info "[DataLoader] battle.js: #{data.length} chars, #{ailments.size} status ailment types written."
  rescue => e
    errors['battle_js'] = e.message
    Rails.logger.error "[DataLoader] battle.js failed, previous data kept: #{e.message}"
  end

  # Always records the attempt, so the server reloads what did succeed, the refresh
  # cooldown applies to failed refreshes too, and /data/status shows what went wrong.
  # A full refresh (reloaded nil) replaces the metadata; a quick reload of some sheets
  # keeps the full refresh time and the other sources' errors.
  def self.finish(errors, reloaded)
    now = Time.current.iso8601
    meta =
      if reloaded
        previous = read_json(DataStore::METADATA_FILE) || {}
        previous.merge('errors' => (previous['errors'] || {}).except(*reloaded.map(&:to_s)).merge(errors),
                       'sheets_refreshed_at' => now)
      else
        { 'last_refreshed_at' => now, 'errors' => errors }
      end
    write_json(DataStore::METADATA_FILE, meta)
    DataStore.instance.reload!
    errors
  end
  private_class_method :refresh, :refresh_battle_js, :finish

  def self.check_sheet(name, rows, previous)
    raise 'no rows' if rows.empty?
    column = REQUIRED_COLUMNS[name]
    raise "no #{column} column (first columns: #{rows.first.keys.first(3).join(', ')})" if column && !rows.first.key?(column)
    if previous && rows.size < previous * MIN_SHARE_OF_PREVIOUS
      raise "only #{rows.size} rows, down from #{previous}"
    end
  end

  def self.check_battle_js(data, ailments)
    raise 'no STATUS_AILMENTS_TYPE entries found' if ailments.empty?
    previous = File.exist?(DataStore::BATTLE_JS_FILE) ? File.size(DataStore::BATTLE_JS_FILE) : nil
    if previous && data.bytesize < previous * MIN_SHARE_OF_PREVIOUS
      raise "only #{data.bytesize} bytes, down from #{previous}"
    end
  end

  # Rows in the cached file, or nil when there is none (or it can't be read).
  def self.previous_size(path)
    read_json(path)&.size
  end

  # The parsed file, or nil when there is none (or it can't be read).
  def self.read_json(path)
    return nil unless File.exist?(path)
    JSON.parse(File.read(path, encoding: 'UTF-8'))
  rescue JSON::ParserError
    nil
  end

  def self.write_json(path, data)
    File.write(path, JSON.generate(data), encoding: 'UTF-8')
  end
  private_class_method :write_json, :read_json, :check_sheet, :check_battle_js, :previous_size
end
