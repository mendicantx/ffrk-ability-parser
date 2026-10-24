require "test_helper"

class DataLoaderTest < ActiveSupport::TestCase
  test "registry lists every sheet the tools use" do
    assert_equal %i[soul_breaks characters status other hero_abilities extra action_args].sort,
                 DataLoader::GOOGLE_SHEETS.keys.sort
  end

  test "every registry env var is documented in .env.example" do
    example = File.read(Rails.root.join(".env.example"))
    DataLoader::GOOGLE_SHEETS.each_value do |var|
      assert_match(/^#{var}=\S+/, example, "#{var} missing from .env.example")
    end
  end

  test "sheet_urls returns only sheets whose env var is set" do
    env = all_sheet_env.merge("EXTRA_SHEET_URL" => nil, "HERO_ABILITIES_SHEET_URL" => "")
    with_env(env) do
      urls = DataLoader.sheet_urls
      assert_not urls.key?(:extra)
      assert_not urls.key?(:hero_abilities)
      assert_equal "https://example.test/status", urls[:status]
    end
  end

  test "sheet_urls can be limited to named sheets" do
    with_env(all_sheet_env) do
      assert_equal %i[status other], DataLoader.sheet_urls(%i[status other]).keys
    end
  end
end
