require 'csv'
require_relative '../http_fetch'

# Fetches a publicly published Google Sheet as CSV and returns an array of
# row hashes keyed by the header row.
#
# Usage:
#   SheetsImporter.fetch("https://docs.google.com/spreadsheets/d/.../export?format=csv")
#   # => [{ "Name" => "foo", "Value" => "bar" }, ...]
module SheetsImporter
  def self.fetch(url)
    raw_csv = HttpFetch.get(url)
    parse_csv(raw_csv)
  end

  private

  def self.parse_csv(raw)
    raw = raw.encode('UTF-8', 'binary', invalid: :replace, undef: :replace, replace: '')
    rows = CSV.parse(raw, headers: true)
    rows.map(&:to_h)
  end
end
