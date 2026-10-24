require "test_helper"
require "tmpdir"

# DataLoader.refresh_all checks each download before it replaces the cached file, so
# an error page, an unpublished sheet or a broken battle.js can't wipe the cache.
class DataLoaderRefreshTest < ActiveSupport::TestCase
  include TestHelpers

  PATH_CONSTANTS = %i[DATA_DIR SHEETS_DIR BATTLE_JS_FILE AILMENTS_FILE METADATA_FILE].freeze

  # Points DataStore's file paths at a temporary folder for the block, so the
  # refresh never touches data/.
  def with_temp_data_dir
    saved = PATH_CONSTANTS.to_h { |c| [c, DataStore.const_get(c)] }
    Dir.mktmpdir do |dir|
      root = Pathname(dir)
      replace = { DATA_DIR: root, SHEETS_DIR: root.join("sheets"), BATTLE_JS_FILE: root.join("battle_js.txt"),
                  AILMENTS_FILE: root.join("status_ailments.json"), METADATA_FILE: root.join("metadata.json") }
      silence_warnings { replace.each { |c, v| DataStore.send(:remove_const, c); DataStore.const_set(c, v) } }
      FileUtils.mkdir_p(root.join("sheets"))
      yield root
    end
  ensure
    silence_warnings { saved.each { |c, v| DataStore.send(:remove_const, c); DataStore.const_set(c, v) } }
    DataStore.instance.reload!
  end

  # Only the Status sheet is configured, so each test fetches exactly one source.
  def only_status_sheet(&block)
    vars = DataLoader::GOOGLE_SHEETS.values.to_h { |v| [v, nil] }
    with_env(vars.merge("STATUS_SHEET_URL" => "https://example.test/status", "BATTLE_JS_URL" => nil), &block)
  end

  def status_rows(count)
    Array.new(count) { |i| { "ID" => (i + 1).to_s, "Common Name" => "Status #{i}" } }
  end

  test "a good sheet is saved and no errors are reported" do
    with_temp_data_dir do |root|
      only_status_sheet do
        rows = status_rows(10)
        stub_singleton(SheetsImporter, :fetch, ->(_url) { rows }) do
          assert_equal({}, DataLoader.refresh_all)
        end
      end
      assert_equal 10, JSON.parse(File.read(root.join("sheets/status.json"))).size
      assert_equal({}, JSON.parse(File.read(root.join("metadata.json")))["errors"])
    end
  end

  test "an error page instead of the sheet keeps the previous data and is reported" do
    with_temp_data_dir do |root|
      File.write(root.join("sheets/status.json"), JSON.generate(status_rows(10)))
      only_status_sheet do
        # What CSV parsing makes of an HTML error page: one row keyed by its first line.
        error_page = [{ "<!DOCTYPE html>" => "<title>Sorry, unable to open the file</title>" }]
        stub_singleton(SheetsImporter, :fetch, ->(_url) { error_page }) do
          errors = DataLoader.refresh_all
          assert_match(/no ID column/, errors["status"])
        end
      end
      assert_equal 10, JSON.parse(File.read(root.join("sheets/status.json"))).size, "previous rows kept"
      assert_match(/no ID column/, JSON.parse(File.read(root.join("metadata.json")))["errors"]["status"])
      assert_match(/no ID column/, DataStore.instance.refresh_errors["status"])
    end
  end

  test "a sheet that shrinks to under half its rows keeps the previous data" do
    with_temp_data_dir do |root|
      File.write(root.join("sheets/status.json"), JSON.generate(status_rows(100)))
      only_status_sheet do
        rows = status_rows(30)
        stub_singleton(SheetsImporter, :fetch, ->(_url) { rows }) do
          assert_match(/only 30 rows, down from 100/, DataLoader.refresh_all["status"])
        end
      end
      assert_equal 100, JSON.parse(File.read(root.join("sheets/status.json"))).size
    end
  end

  test "a failed battle.js is reported and the sheets are still saved" do
    with_temp_data_dir do |root|
      only_status_sheet do
        with_env("BATTLE_JS_URL" => "https://example.test/battle.js") do
          rows = status_rows(5)
          stub_singleton(SheetsImporter, :fetch, ->(_url) { rows }) do
            stub_singleton(BattleJsImporter, :fetch, ->(_url) { raise "HTTP 404 fetching battle.js" }) do
              errors = DataLoader.refresh_all
              assert_equal ["battle_js"], errors.keys
            end
          end
        end
      end
      assert_equal 5, JSON.parse(File.read(root.join("sheets/status.json"))).size
    end
  end
end
