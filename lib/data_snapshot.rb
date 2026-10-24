require 'digest'
require 'fileutils'
require 'zlib'

# Copies the cached data/ files into a gzipped, committed test fixture so tests
# run against a fixed copy of battle.js and the sheets, with no network.
# Used by rake data:snapshot; read back by the Node test harness.
module DataSnapshot
  DEFAULT_TARGET = Rails.root.join('test/fixtures/snapshot').freeze

  # Files under data/ that make up a snapshot (metadata.json is per-refresh noise).
  def self.source_files(source)
    Dir.glob('**/*', base: source.to_s).sort.select do |rel|
      File.file?(File.join(source, rel)) && rel != 'metadata.json'
    end
  end

  # Writes <target>/<file>.gz for each source file plus SNAPSHOT.md.
  # Returns the list of files whose content changed (empty when up to date).
  def self.write(source: DataStore::DATA_DIR, target: DEFAULT_TARGET, now: Time.current)
    files = source_files(source)
    raise "No data files in #{source}. Run: rake data:refresh" if files.empty?

    digests = files.to_h { |rel| [rel, Digest::SHA256.file(File.join(source, rel)).hexdigest] }
    previous = read_digests(target)
    changed = files.reject { |rel| previous[rel] == digests[rel] && File.exist?(gz_path(target, rel)) }
    removed = previous.keys - files
    return [] if changed.empty? && removed.empty?

    changed.each do |rel|
      out = gz_path(target, rel)
      FileUtils.mkdir_p(File.dirname(out))
      Zlib::GzipWriter.open(out, Zlib::BEST_COMPRESSION) do |gz|
        gz.mtime = 0 # keeps the .gz bytes stable for identical input
        gz.write(File.binread(File.join(source, rel)))
      end
    end
    removed.each { |rel| FileUtils.rm_f(gz_path(target, rel)) }

    File.write(File.join(target, 'SNAPSHOT.md'), manifest(digests, now), encoding: 'UTF-8')
    changed + removed
  end

  def self.gz_path(target, rel)
    File.join(target, "#{rel}.gz")
  end

  def self.read_digests(target)
    path = File.join(target, 'SNAPSHOT.md')
    return {} unless File.exist?(path)

    File.read(path, encoding: 'UTF-8').scan(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/).to_h
  end

  def self.manifest(digests, now)
    rows = digests.map { |rel, sha| "| `#{rel}` | `#{sha}` |" }.join("\n")
    <<~MD
      # Test data snapshot

      A frozen, gzipped copy of `data/` used by the tests. Taken #{now.utc.iso8601}.
      Regenerate with `rake data:refresh` then `rake data:snapshot`, and review the golden-file diffs.

      | File | SHA-256 (uncompressed) |
      |---|---|
      #{rows}
    MD
  end
end
