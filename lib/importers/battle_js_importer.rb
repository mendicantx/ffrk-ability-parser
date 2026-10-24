require_relative '../http_fetch'

# Fetches the battle.js URL whose body contains Dean Edwards p,a,c,k,e,r packed JavaScript,
# unpacks it, and returns the unpacked JavaScript as a plain string.
#
# Usage:
#   BattleJsImporter.fetch("https://example.com/battle.js")
#   # => "define(\"event/challenge/battle/EventLogic\", ...)"
module BattleJsImporter
  def self.fetch(url)
    # The body is UTF-8 (it contains Japanese text); Net::HTTP returns it as bytes.
    body = HttpFetch.get(url).dup.force_encoding('UTF-8').scrub('')
    unpack(body)
  end

  # Extracts all STATUS_AILMENTS_TYPE entries from unpacked battle.js.
  # Scans every define() block for STATUS_AILMENTS_TYPE keys and collects
  # all KEY: integer_id pairs into a flat hash.
  #
  # Returns { "DUAL_AWAKE_MODE_FIRST_GALUF_EARTH_II" => 50416031, ... }
  def self.extract_status_ailments(js)
    ailments = {}
    js.scan(/STATUS_AILMENTS_TYPE:\{([^}]+)\}/) do |block|
      # Keys can contain lower-case letters (CHASE_MODE_FOR_WE_Of_LAST_ILLUSION);
      # values can be in exponent form (55e3 = 55000).
      block[0].scan(/(?<![A-Za-z0-9_$])([A-Z][A-Za-z0-9_]*):(\d+(?:e\d+)?)/) do |key, val|
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

    # Both are single-quoted JS string literals, so undo their escapes first,
    # exactly as a JS engine does before the packer function runs.
    payload  = unescape_js_string(match[1])
    base     = match[2].to_i
    _count   = match[3].to_i
    keywords = unescape_js_string(match[4]).split('|')

    decode_payload(payload, base, keywords)
  end

  JS_ESCAPES = { 'n' => "\n", 'r' => "\r", 't' => "\t", 'b' => "\b", 'f' => "\f", 'v' => "\v", '0' => "\0" }.freeze

  # Interprets the escape sequences in the contents of a JS string literal:
  # \n \t …, \xHH, \uHHHH, line continuations, and \<char> → <char> (\\ \' \").
  def self.unescape_js_string(text)
    text.gsub(/\\(u\h{4}|x\h{2}|\r\n|[\s\S])/) do
      seq = Regexp.last_match(1)
      if seq.length > 1 && seq.start_with?('u', 'x') then seq[1..].to_i(16).chr(Encoding::UTF_8)
      elsif ["\n", "\r\n", "\r"].include?(seq) then ''
      else JS_ESCAPES.fetch(seq, seq)
      end
    end
  end

  private

  # Decodes the packed payload by replacing each encoded word with the
  # corresponding keyword from the keyword list.
  def self.decode_payload(payload, base, keywords)
    # The payload uses base-N encoded indices as word placeholders.
    # Replace each placeholder with the keyword at that index, or leave it
    # as-is if the keyword slot is empty (meaning the original word is used).
    # Word boundaries are ASCII-only, as in JS (Ruby's \b would also treat
    # Japanese characters as word characters).
    payload.gsub(/(?<![0-9A-Za-z_])[0-9A-Za-z]+(?![0-9A-Za-z_])/) do |word|
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
