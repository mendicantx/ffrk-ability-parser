require 'net/http'
require 'uri'

# GETs a URL and returns the response body, following redirects
# (Google Sheets redirects before serving CSV). Shared by the importers.
module HttpFetch
  MAX_REDIRECTS = 5

  def self.get(url, redirect_limit = MAX_REDIRECTS)
    raise "Too many redirects fetching #{url}" if redirect_limit.zero?

    response = Net::HTTP.get_response(URI.parse(url))
    case response
    when Net::HTTPSuccess
      response.body
    when Net::HTTPRedirection
      get(URI.join(url, response['location']).to_s, redirect_limit - 1)
    else
      raise "HTTP #{response.code} fetching #{url}"
    end
  end
end
