ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"

module TestHelpers
  # Temporarily sets environment variables for the duration of the block.
  # A nil value unsets the variable.
  def with_env(vars)
    saved = vars.keys.to_h { |k| [k, ENV[k]] }
    vars.each { |k, v| v.nil? ? ENV.delete(k) : ENV[k] = v }
    yield
  ensure
    saved.each { |k, v| v.nil? ? ENV.delete(k) : ENV[k] = v }
  end

  # Temporarily replaces a singleton method (e.g. SheetsImporter.fetch).
  def stub_singleton(object, method_name, replacement)
    original = object.method(method_name)
    object.define_singleton_method(method_name, &replacement)
    yield
  ensure
    object.define_singleton_method(method_name, original)
  end

  # Temporarily replaces what DataStore.instance holds, without touching data/.
  def with_data_store(sheets: {}, battle_js: nil, last_refreshed_at: nil, sheets_refreshed_at: nil)
    store = DataStore.instance
    ivars = %i[@sheets @battle_js_data @last_refreshed_at @sheets_refreshed_at @loaded_metadata_mtime]
    saved = ivars.to_h { |iv| [iv, store.instance_variable_get(iv)] }
    store.instance_variable_set(:@sheets, sheets)
    store.instance_variable_set(:@battle_js_data, battle_js)
    store.instance_variable_set(:@last_refreshed_at, last_refreshed_at)
    store.instance_variable_set(:@sheets_refreshed_at, sheets_refreshed_at)
    # Match the on-disk metadata so reload_if_changed! keeps these values.
    store.instance_variable_set(:@loaded_metadata_mtime, store.send(:metadata_mtime))
    yield store
  ensure
    saved.each { |iv, v| store.instance_variable_set(iv, v) }
  end

  # Every sheet env var set to a recognisable fake URL.
  def all_sheet_env
    DataLoader::GOOGLE_SHEETS.to_h { |name, var| [var, "https://example.test/#{name}"] }
  end
end

class ActiveSupport::TestCase
  include TestHelpers
end

class ActionDispatch::IntegrationTest
  include TestHelpers
end
