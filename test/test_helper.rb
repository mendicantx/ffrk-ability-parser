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
