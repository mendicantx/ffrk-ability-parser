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

  # The body arrives as bytes: read it as UTF-8 (keeping Japanese text such as the
  # Name (JP) column), drop only invalid bytes, and drop a leading byte-order mark so
  # the first header stays "ID".
  def self.parse_csv(raw)
    raw = raw.dup.force_encoding('UTF-8').scrub('').delete_prefix("﻿")
    rows = CSV.parse(raw, headers: true)
    rows.map(&:to_h)
  end
end
