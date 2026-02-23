# On server boot, load any previously fetched data from disk.
# No network calls are made here — run rake data:refresh to fetch fresh data.
Rails.application.config.after_initialize do
  DataStore.instance.reload!
end
