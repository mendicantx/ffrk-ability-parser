require "test_helper"
require "tmpdir"

class DataSnapshotTest < ActiveSupport::TestCase
  def with_dirs
    Dir.mktmpdir do |dir|
      source = File.join(dir, "data")
      target = File.join(dir, "snapshot")
      FileUtils.mkdir_p(File.join(source, "sheets"))
      File.write(File.join(source, "battle_js.txt"), "define('x', [], function(){})")
      File.write(File.join(source, "sheets/status.json"), '[{"ID":"1"}]')
      File.write(File.join(source, "metadata.json"), '{"last_refreshed_at":"now"}')
      yield source, target
    end
  end

  test "writes gzipped copies and a manifest, skipping metadata.json" do
    with_dirs do |source, target|
      changed = DataSnapshot.write(source: source, target: target)
      assert_equal %w[battle_js.txt sheets/status.json], changed
      assert_equal '[{"ID":"1"}]', Zlib::GzipReader.open(File.join(target, "sheets/status.json.gz"), &:read)
      assert_not File.exist?(File.join(target, "metadata.json.gz"))
      assert_match "sheets/status.json", File.read(File.join(target, "SNAPSHOT.md"))
    end
  end

  test "second run with unchanged data writes nothing" do
    with_dirs do |source, target|
      DataSnapshot.write(source: source, target: target)
      before = Dir.glob("#{target}/**/*").to_h { |f| [f, File.file?(f) && File.binread(f)] }
      assert_empty DataSnapshot.write(source: source, target: target, now: 1.day.from_now)
      after = Dir.glob("#{target}/**/*").to_h { |f| [f, File.file?(f) && File.binread(f)] }
      assert_equal before, after
    end
  end

  test "only changed and removed files are rewritten" do
    with_dirs do |source, target|
      DataSnapshot.write(source: source, target: target)
      File.write(File.join(source, "sheets/status.json"), '[{"ID":"2"}]')
      File.delete(File.join(source, "battle_js.txt"))
      assert_equal %w[sheets/status.json battle_js.txt], DataSnapshot.write(source: source, target: target)
      assert_not File.exist?(File.join(target, "battle_js.txt.gz"))
    end
  end
end
