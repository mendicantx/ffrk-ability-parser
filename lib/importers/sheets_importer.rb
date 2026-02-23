require 'csv'
require 'net/http'
require 'uri'

# Fetches a publicly published Google Sheet as CSV and returns an array of
# row hashes keyed by the header row.
#
# Usage:
#   SheetsImporter.fetch("https://docs.google.com/spreadsheets/d/.../export?format=csv")
#   # => [{ "Name" => "foo", "Value" => "bar" }, ...]
module SheetsImporter
  MAX_REDIRECTS = 5

  def self.fetch(url)
    raw_csv = get_with_redirects(url)
    parse_csv(raw_csv)
  end

  private

  def self.get_with_redirects(url, redirect_limit = MAX_REDIRECTS)
    raise "Too many redirects fetching Google Sheet" if redirect_limit.zero?

    uri = URI.parse(url)
    response = Net::HTTP.get_response(uri)

    case response
    when Net::HTTPSuccess
      response.body
    when Net::HTTPRedirection
      get_with_redirects(response['location'], redirect_limit - 1)
    else
      raise "Failed to fetch Google Sheet (HTTP #{response.code}): #{url}"
    end
  end

  def self.parse_csv(raw)
    raw = raw.encode('UTF-8', 'binary', invalid: :replace, undef: :replace, replace: '')
    rows = CSV.parse(raw, headers: true)
    rows.map(&:to_h)
  end
end
