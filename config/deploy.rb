lock '~> 3.19'

set :application, 'ffrk-ability-parser'
# The repo is public, so the server clones it over HTTPS with no key (if it ever goes
# private, switch back to SSH and add a read-only deploy key on GitHub).
set :repo_url,    'https://github.com/mendicantx/ffrk-ability-parser.git'
set :branch,      'main'

set :deploy_to, '/data/www/ffrk-ability-parser'

# Keep 5 releases on the server
set :keep_releases, 5

# Files and directories to symlink from shared/ into each release
append :linked_files, '.env'
# data/ holds the cached sheets and battle.js (rake data:refresh); sharing it keeps
# the cache across releases instead of starting each deploy empty.
append :linked_dirs,  'log', 'tmp/pids', 'tmp/cache', 'tmp/sockets', 'public/assets', 'data'

# Passenger restart: touching this file signals Passenger to reload the app
namespace :deploy do
  desc 'Restart Passenger'
  task :restart do
    on roles(:app) do
      execute :touch, release_path.join('tmp/restart.txt')
    end
  end
  after :publishing, :restart
end

# Fill the shared data cache on the first deploy (or if it was ever deleted),
# before Passenger restarts, so the tools never come up empty.
namespace :data do
  desc 'Run rake data:refresh if the shared data cache is empty'
  task :refresh_if_missing do
    on roles(:app) do
      if test("[ -f #{shared_path.join('data/metadata.json')} ]")
        info 'Shared data cache present; skipping data:refresh'
      else
        within release_path do
          with rails_env: fetch(:rails_env, 'production') do
            execute :rake, 'data:refresh'
          end
        end
      end
    end
  end
end
after 'deploy:updated', 'data:refresh_if_missing'
