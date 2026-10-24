require "test_helper"

class SheetDataTest < ActionDispatch::IntegrationTest
  FAKE_FETCH = ->(url) { [{ "url" => url }] }

  test "ability parser serves every configured sheet" do
    with_env(all_sheet_env) do
      stub_singleton(SheetsImporter, :fetch, FAKE_FETCH) do
        get "/ability_parser/sheet_data"
      end
    end
    assert_response :success
    body = JSON.parse(response.body)
    assert_equal DataLoader::GOOGLE_SHEETS.keys.map(&:to_s).sort, body.keys.sort
    assert_equal "https://example.test/extra", body["extra"].first["url"]
  end

  test "status decoder serves status, other and extra only" do
    with_env(all_sheet_env) do
      stub_singleton(SheetsImporter, :fetch, FAKE_FETCH) do
        get "/status_decoder/sheet_data"
      end
    end
    assert_response :success
    assert_equal %w[extra other status], JSON.parse(response.body).keys.sort
  end

  test "status decoder reports a missing status sheet" do
    with_env(all_sheet_env.merge("STATUS_SHEET_URL" => nil)) do
      get "/status_decoder/sheet_data"
    end
    assert_response :internal_server_error
    assert_match "STATUS_SHEET_URL", JSON.parse(response.body)["error"]
  end
end
