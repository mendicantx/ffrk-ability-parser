require_relative '../../lib/data_loader'

# Serves the cached sheets and battle.js from DataStore to both tools.
# Nothing here fetches from the network except POST /data/refresh.
class DataController < ApplicationController
  # How often anyone may trigger a refresh from the browser.
  REFRESH_COOLDOWN = 5.minutes
  # How often the Status and Other sheets may be reloaded on their own.
  QUICK_REFRESH_COOLDOWN = 1.minute

  NO_DATA_MESSAGE = 'No cached data yet. Run: rake data:refresh'.freeze

  before_action { DataStore.instance.reload_if_changed! }

  # GET /data/sheets?names=status,other  (all sheets when names is omitted)
  def sheets
    store = DataStore.instance
    return render(json: { error: NO_DATA_MESSAGE }, status: :service_unavailable) if store.sheets.empty?

    names = params[:names].present? ? params[:names].split(',').map { |n| n.strip.to_sym } : store.sheets.keys
    result = names.to_h { |name| [name, store.sheet(name)] }
    result[:last_refreshed_at] = store.last_refreshed_at&.iso8601
    render json: result
  end

  # GET /data/battle_js — the unpacked battle.js text
  def battle_js
    js = DataStore.instance.battle_js_data
    return render(plain: "// #{NO_DATA_MESSAGE}", status: :service_unavailable) if js.blank?

    render plain: js, content_type: 'text/plain'
  end

  # GET /data/status
  def status
    render json: status_json
  end

  # POST /data/refresh — re-fetches every source, at most once per REFRESH_COOLDOWN
  # POST /data/refresh?sheets=status,other — re-fetches only those sheets (any of
  # DataLoader::QUICK_SHEETS), at most once per QUICK_REFRESH_COOLDOWN
  def refresh
    store = DataStore.instance
    if params[:sheets].present?
      names = params[:sheets].split(',').map { |n| n.strip.to_sym }.uniq
      unless (names - DataLoader::QUICK_SHEETS).empty?
        return render(json: status_json.merge(error: "Only the #{DataLoader::QUICK_SHEETS.to_sentence} sheets can be reloaded on their own."),
                      status: :bad_request)
      end
      return if cooling_down?(store.sheets_refreshed_at, QUICK_REFRESH_COOLDOWN)

      DataLoader.refresh_sheets(names)
    else
      return if cooling_down?(store.last_refreshed_at, REFRESH_COOLDOWN)

      DataLoader.refresh_all
    end
    render json: status_json
  end

  private

  # Renders the "try again" error and returns true when time is within cooldown.
  def cooling_down?(time, cooldown)
    return false unless time && time > cooldown.ago

    wait = (time + cooldown - Time.current).ceil
    render(json: status_json.merge(error: "Data was refreshed recently. Try again in #{wait} seconds."),
           status: :too_many_requests)
    true
  end

  def status_json
    store = DataStore.instance
    {
      last_refreshed_at: store.last_refreshed_at&.iso8601,
      sheets_refreshed_at: store.sheets_refreshed_at&.iso8601,
      sheets: store.sheets.transform_values(&:size),
      battle_js_chars: store.battle_js_data&.length || 0,
      refresh_errors: store.refresh_errors,
    }
  end
end
