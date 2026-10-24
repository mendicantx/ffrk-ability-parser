require "test_helper"

class DataControllerTest < ActionDispatch::IntegrationTest
  SHEETS = {
    status: [{ "ID" => "1", "Common Name" => "Haste" }],
    other: [{ "ID" => "2", "Name" => "Chase" }],
    extra: [{ "ID" => "3", "Name" => "Kiwami" }],
    soul_breaks: [{ "ID" => "4" }],
  }.freeze

  test "serves every cached sheet with the refresh time" do
    at = Time.utc(2026, 10, 1, 12)
    with_data_store(sheets: SHEETS, last_refreshed_at: at) do
      get "/data/sheets"
    end
    assert_response :success
    body = JSON.parse(response.body)
    assert_equal %w[extra last_refreshed_at other soul_breaks status], body.keys.sort
    assert_equal "Haste", body["status"].first["Common Name"]
    assert_equal at.iso8601, body["last_refreshed_at"]
  end

  test "serves only the named sheets" do
    with_data_store(sheets: SHEETS) { get "/data/sheets", params: { names: "status,extra" } }
    assert_equal %w[extra last_refreshed_at status], JSON.parse(response.body).keys.sort
  end

  test "old status decoder URL serves status, other and extra" do
    with_data_store(sheets: SHEETS) { get "/status_decoder/sheet_data" }
    assert_response :success
    assert_equal %w[extra last_refreshed_at other status], JSON.parse(response.body).keys.sort
  end

  test "old ability parser URLs alias the data endpoints" do
    with_data_store(sheets: SHEETS, battle_js: "define('a',[],function(){})") do
      get "/ability_parser/sheet_data"
      assert_includes JSON.parse(response.body).keys, "soul_breaks"
      get "/ability_parser/battle_js"
      assert_equal "define('a',[],function(){})", response.body
    end
  end

  test "sheets and battle.js report 503 when nothing is cached" do
    with_data_store do
      get "/data/sheets"
      assert_response :service_unavailable
      assert_match "rake data:refresh", JSON.parse(response.body)["error"]
      get "/data/battle_js"
      assert_response :service_unavailable
    end
  end

  test "status lists sheet sizes" do
    with_data_store(sheets: SHEETS, battle_js: "abc") { get "/data/status" }
    body = JSON.parse(response.body)
    assert_equal 1, body["sheets"]["status"]
    assert_equal 3, body["battle_js_chars"]
  end

  test "refresh runs the loader when the cooldown has passed" do
    calls = 0
    with_data_store(sheets: SHEETS, last_refreshed_at: 1.hour.ago) do
      stub_singleton(DataLoader, :refresh_all, -> { calls += 1 }) { post "/data/refresh" }
    end
    assert_response :success
    assert_equal 1, calls
  end

  test "refresh is refused within the cooldown" do
    calls = 0
    with_data_store(sheets: SHEETS, last_refreshed_at: 1.minute.ago) do
      stub_singleton(DataLoader, :refresh_all, -> { calls += 1 }) { post "/data/refresh" }
    end
    assert_response :too_many_requests
    assert_equal 0, calls
    assert_match "Try again", JSON.parse(response.body)["error"]
  end
end
