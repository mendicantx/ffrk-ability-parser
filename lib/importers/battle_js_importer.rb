require 'net/http'
require 'uri'
require 'json'

# Fetches the battle.js URL whose body contains Dean Edwards p,a,c,k,e,r packed JavaScript,
# unpacks it, and returns the unpacked JavaScript as a plain string.
#
# Usage:
#   BattleJsImporter.fetch("https://example.com/battle.js")
#   # => "define(\"event/challenge/battle/EventLogic\", ...)"
module BattleJsImporter
  MAX_REDIRECTS = 5

  def self.fetch(url)
    body = get_with_redirects(url)
    unpack(body).encode('UTF-8', 'binary', invalid: :replace, undef: :replace, replace: '')
  end

  # Extracts all STATUS_AILMENTS_TYPE entries from unpacked battle.js.
  # Scans every define() block for STATUS_AILMENTS_TYPE keys and collects
  # all KEY: integer_id pairs into a flat hash.
  #
  # Returns { "DUAL_AWAKE_MODE_FIRST_GALUF_EARTH_II" => 50416031, ... }
  def self.extract_status_ailments(js)
    ailments = {}
    js.scan(/STATUS_AILMENTS_TYPE:\{([^}]+)\}/) do |block|
      block[0].scan(/([A-Z][A-Z0-9_]+):(\d+(?:e\d+)?)/) do |key, val|
        ailments[key] = val.to_f.to_i
      end
    end
    ailments
  end

  # Unpacks a Dean Edwards p,a,c,k,e,r encoded string.
  # The packed format looks like:
  #   eval(function(p,a,c,k,e,r){...}('encoded',base,count,'word|list',0,{}))
  def self.unpack(source)
    # Extract the arguments passed to the packer function:
    #   p  = the encoded payload string
    #   a  = the base (radix) used for encoding
    #   c  = the word count
    #   k  = '|'-delimited keyword list
    match = source.match(
      /eval\(function\(p,a,c,k,e[^)]*\)\{.+?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/
    )

    raise "Source does not appear to be p,a,c,k,e,r packed" unless match

    payload  = match[1]
    base     = match[2].to_i
    _count   = match[3].to_i
    keywords = match[4].split('|')

    decode_payload(payload, base, keywords)
  end

  # Searches the unpacked JS for the first JSON object `{...}` or array `[...]`
  # and parses it.
  def self.extract_json(unpacked_js)
    # Try to find a JSON object or array literal
    # Look for the first { or [ and find the matching closing bracket
    json_string = extract_json_string(unpacked_js)
    raise "No JSON found in unpacked source" unless json_string

    JSON.parse(json_string)
  rescue JSON::ParserError => e
    raise "Failed to parse extracted JSON: #{e.message}"
  end

  private

  def self.get_with_redirects(url, redirect_limit = MAX_REDIRECTS)
    raise "Too many redirects" if redirect_limit.zero?

    uri = URI.parse(url)
    response = Net::HTTP.get_response(uri)

    case response
    when Net::HTTPSuccess
      response.body
    when Net::HTTPRedirection
      get_with_redirects(response['location'], redirect_limit - 1)
    else
      raise "Failed to fetch packed source (HTTP #{response.code}): #{url}"
    end
  end

  # Decodes the packed payload by replacing each encoded word with the
  # corresponding keyword from the keyword list.
  def self.decode_payload(payload, base, keywords)
    # The payload uses base-N encoded indices as word placeholders.
    # Replace each placeholder with the keyword at that index, or leave it
    # as-is if the keyword slot is empty (meaning the original word is used).
    payload.gsub(/\b([0-9a-zA-Z]+)\b/) do |word|
      index = word_to_index(word, base)
      replacement = keywords[index]
      (replacement.nil? || replacement.empty?) ? word : replacement
    end
  end

  # Converts a packer-encoded word to an integer index.
  # Ruby's String#to_i only handles bases 2-36; packer can use up to base 62
  # with the alphabet: 0-9 (0-9), a-z (10-35), A-Z (36-61).
  def self.word_to_index(word, base)
    return word.to_i(base) if base <= 36

    word.chars.reduce(0) do |acc, char|
      digit = case char
              when '0'..'9' then char.ord - '0'.ord
              when 'a'..'z' then char.ord - 'a'.ord + 10
              when 'A'..'Z' then char.ord - 'A'.ord + 36
              else 0
              end
      acc * base + digit
    end
  end

  # Extracts the first balanced JSON object or array from a string.
  def self.extract_json_string(source)
    # Find the first { or [
    start_index = source.index(/[\{\[]/)
    return nil unless start_index

    opener = source[start_index]
    closer = opener == '{' ? '}' : ']'

    depth = 0
    in_string = false
    escape_next = false

    source[start_index..].each_char.with_index do |char, i|
      if escape_next
        escape_next = false
        next
      end

      if char == '\\' && in_string
        escape_next = true
        next
      end

      if char == '"'
        in_string = !in_string
        next
      end

      next if in_string

      depth += 1 if char == opener
      depth -= 1 if char == closer

      if depth.zero?
        return source[start_index, i + 1]
      end
    end

    nil
  end
end
