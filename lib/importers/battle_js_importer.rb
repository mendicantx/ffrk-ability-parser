require_relative '../http_fetch'

# Fetches the battle.js URL whose body contains Dean Edwards p,a,c,k,e,r packed JavaScript,
# unpacks it, and returns the unpacked JavaScript as a plain string.
#
# Usage:
#   BattleJsImporter.fetch("https://example.com/battle.js")
#   # => "define(\"event/challenge/battle/EventLogic\", ...)"
module BattleJsImporter
  def self.fetch(url)
    body = HttpFetch.get(url)
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

  private

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

end
