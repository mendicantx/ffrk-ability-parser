require_relative '../data_loader'

namespace :data do
  desc "Refresh all data sources and store results in DataStore"
  task refresh: :environment do
    DataLoader.refresh_all
    puts "[data:refresh] Done. Last refreshed: #{DataStore.instance.last_refreshed_at}"
  end

  desc "Fetch battle.js and print the extracted JSON to stdout"
  task battle_js: :environment do
    url = ENV.fetch('BATTLE_JS_URL') do
      abort "[data:battle_js] ERROR: BATTLE_JS_URL is not set."
    end

    puts "[data:battle_js] Fetching and unpacking #{url} ..."
    puts BattleJsImporter.fetch(url)
  rescue => e
    abort "[data:battle_js] ERROR: #{e.message}"
  end

  desc "Show current DataStore status"
  task status: :environment do
    store = DataStore.instance
    if store.refreshed?
      puts "Last refreshed: #{store.last_refreshed_at}"
      DataLoader::GOOGLE_SHEETS.each_key do |name|
        puts "  #{name}: #{store.sheet(name).size} rows"
      end
      puts "battle.js: #{store.battle_js_data&.length || 0} chars"
    else
      puts "No data files found. Run: rake data:refresh"
    end
  end
end
