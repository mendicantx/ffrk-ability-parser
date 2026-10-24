require "test_helper"

class DataStoreTest < ActiveSupport::TestCase
  test "reload_if_changed! reloads only when metadata.json changes" do
    store = DataStore.instance
    reloads = 0
    stub_singleton(store, :reload!, -> { reloads += 1 }) do
      store.instance_variable_set(:@loaded_metadata_mtime, store.send(:metadata_mtime))
      store.reload_if_changed!
      assert_equal 0, reloads

      store.instance_variable_set(:@loaded_metadata_mtime, Time.at(0))
      store.reload_if_changed!
      assert_equal 1, reloads
    end
  ensure
    store.reload!
  end
end
