require "test_helper"
require "net/http"

class BattleJsImporterTest < ActiveSupport::TestCase
  # A tiny p,a,c,k,e,r payload: word indices 0-2 map to the keyword list.
  PACKED = "eval(function(p,a,c,k,e,r){e=String;if(!''.replace(/^/,String)){while(c--)r[c]=k[c]||c;k=[function(e){return r[e]}];e=function(){return'\\w+'};c=1};while(c--)if(k[c])p=p.replace(new RegExp('\\b'+e(c)+'\\b','g'),k[c]);return p}('0(\"1\",[],2(){})',3,3,'define|battle|function'.split('|'),0,{}))"

  test "unpack replaces encoded words with keywords" do
    assert_equal 'define("battle",[],function(){})', BattleJsImporter.unpack(PACKED)
  end

  test "unpack keeps words whose keyword slot is empty" do
    packed = PACKED.sub("'define|battle|function'", "'define||function'")
    assert_equal 'define("1",[],function(){})', BattleJsImporter.unpack(packed)
  end

  test "unpack rejects source that is not packed" do
    assert_raises(RuntimeError) { BattleJsImporter.unpack("define('x',[],function(){})") }
  end

  test "word_to_index decodes base 62 (beyond Ruby's base 36 limit)" do
    assert_equal 9,  BattleJsImporter.word_to_index("9", 62)
    assert_equal 10, BattleJsImporter.word_to_index("a", 62)
    assert_equal 36, BattleJsImporter.word_to_index("A", 62)
    assert_equal 61, BattleJsImporter.word_to_index("Z", 62)
    assert_equal 62, BattleJsImporter.word_to_index("10", 62)
    assert_equal 255, BattleJsImporter.word_to_index("ff", 16)
  end

  test "extract_status_ailments merges every block and expands exponents" do
    js = "a={STATUS_AILMENTS_TYPE:{HASTE:10,BRAVE:2e3}};b={STATUS_AILMENTS_TYPE:{PROTECT:7}}"
    assert_equal({ "HASTE" => 10, "BRAVE" => 2000, "PROTECT" => 7 }, BattleJsImporter.extract_status_ailments(js))
  end
end

class SheetsImporterTest < ActiveSupport::TestCase
  test "parse_csv returns header-keyed rows, including quoted commas and newlines" do
    csv = "ID,Name,Effects\n1,Haste,\"Grants a, b\"\n2,Protect,\"line one\nline two\"\n"
    rows = SheetsImporter.parse_csv(csv)
    assert_equal [{ "ID" => "1", "Name" => "Haste", "Effects" => "Grants a, b" },
                  { "ID" => "2", "Name" => "Protect", "Effects" => "line one\nline two" }], rows
  end

  test "parse_csv drops invalid bytes instead of failing" do
    rows = SheetsImporter.parse_csv("ID,Name\n1,Caf\xE9\n".b)
    assert_equal "Caf", rows.first["Name"]
  end
end

class HttpFetchTest < ActiveSupport::TestCase
  def response(klass, code, body: "", location: nil)
    r = klass.new("1.1", code, "")
    r["location"] = location if location
    r.instance_variable_set(:@body, body)
    r.instance_variable_set(:@read, true)
    r
  end

  test "follows relative and absolute redirects" do
    responses = {
      "https://example.test/a" => response(Net::HTTPFound, "302", location: "/b"),
      "https://example.test/b" => response(Net::HTTPFound, "302", location: "https://other.test/c"),
      "https://other.test/c" => response(Net::HTTPOK, "200", body: "done"),
    }
    stub_singleton(Net::HTTP, :get_response, ->(uri) { responses.fetch(uri.to_s) }) do
      assert_equal "done", HttpFetch.get("https://example.test/a")
    end
  end

  test "gives up after too many redirects" do
    loop_response = response(Net::HTTPFound, "302", location: "https://example.test/a")
    stub_singleton(Net::HTTP, :get_response, ->(_uri) { loop_response }) do
      error = assert_raises(RuntimeError) { HttpFetch.get("https://example.test/a") }
      assert_match "Too many redirects", error.message
    end
  end

  test "raises on an error status" do
    not_found = response(Net::HTTPNotFound, "404")
    stub_singleton(Net::HTTP, :get_response, ->(_uri) { not_found }) do
      error = assert_raises(RuntimeError) { HttpFetch.get("https://example.test/missing") }
      assert_match "HTTP 404", error.message
    end
  end
end

class BattleJsUnpackFidelityTest < ActiveSupport::TestCase
  # Builds a minimal packer expression: payload words 0..n map to the keyword list.
  def packed(payload, keywords)
    "eval(function(p,a,c,k,e,r){return p}('#{payload}',62,#{keywords.size},'#{keywords.join('|')}'.split('|'),0,{}))"
  end

  BS = 92.chr # one backslash, spelled out to keep the escaping readable

  test "unescapes the payload like a JS string literal" do
    # Packed literal: 0(\'a\\b\',\"x\")\n
    payload = "0(#{BS}'a#{BS}#{BS}b#{BS}',#{BS}\"x#{BS}\")#{BS}n"
    assert_equal "say('a#{BS}b',\"x\")\n", BattleJsImporter.unpack(packed(payload, %w[say]))
  end

  test "keeps Japanese text and decodes unicode escapes" do
    # Packed literal: 0:"毒ス"
    payload = "0:\"毒#{BS}u30b9\""
    assert_equal 'name:"毒ス"', BattleJsImporter.unpack(packed(payload, %w[name]))
  end

  test "word boundaries are ASCII-only, as in JS" do
    # In JS, 0 next to a Japanese character is still a separate word and gets replaced.
    js = BattleJsImporter.unpack(packed(%q{"毒0"+a_0}, %w[poison]))
    assert_equal '"毒poison"+a_0', js
  end
end
