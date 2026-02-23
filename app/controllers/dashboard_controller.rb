class DashboardController < ApplicationController
  def index
    store = DataStore.instance
    @last_refreshed_at = store.last_refreshed_at
    @sheets            = store.sheets
    @battle_js_data    = store.battle_js_data

    build_status_ailment_comparison(store)
  end

  private

  def build_status_ailment_comparison(store)
    js_ailments  = store.status_ailments_from_js  # { "KEY" => id }
    status_rows  = store.sheet(:status)            # array of CSV row hashes

    # Find the actual column names case-insensitively, normalising spaces/underscores.
    normalize = ->(s) { s.to_s.downcase.gsub(/[\s_]+/, '_') }
    sample    = status_rows.first&.keys || []
    name_col  = sample.find { |k| normalize.(k) == 'coded_name' }
    id_col    = sample.find { |k| normalize.(k) == 'id' }

    # Index the Status CSV by coded_name for O(1) lookup.
    csv_by_name = {}
    status_rows.each do |row|
      key = name_col && row[name_col]
      next if key.nil? || key.strip.empty?
      csv_by_name[key.strip] = row
    end

    matched     = []  # in both, ids agree
    id_mismatch = []  # in both, ids differ
    js_only     = []  # in JS but not CSV
    csv_only    = []  # in CSV but not JS

    js_ailments.each do |name, js_id|
      if csv_by_name.key?(name)
        csv_id = (id_col && csv_by_name[name][id_col]).to_s.strip.to_i
        if csv_id == js_id
          matched << { name: name, id: js_id }
        else
          id_mismatch << { name: name, js_id: js_id, csv_id: csv_id }
        end
      else
        js_only << { name: name, id: js_id }
      end
    end

    csv_by_name.each do |name, row|
      unless js_ailments.key?(name)
        csv_id = (id_col && row[id_col]).to_s.strip.to_i
        csv_only << { name: name, id: csv_id }
      end
    end

    @status_ailment_comparison = {
      matched:     matched.sort_by     { |r| r[:name] },
      id_mismatch: id_mismatch.sort_by { |r| r[:name] },
      js_only:     js_only.sort_by     { |r| r[:name] },
      csv_only:    csv_only.sort_by    { |r| r[:name] },
    }
  end
end
