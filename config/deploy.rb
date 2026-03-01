lock '~> 3.19'

set :application, 'ffrk-ability-parser'
set :repo_url,    'git@github.com:mendicantx/ffrk-ability-parser.git'
set :branch,      'main'

set :deploy_to, '/data/www/ffrk-ability-parser'

# Keep 5 releases on the server
set :keep_releases, 5

# Files and directories to symlink from shared/ into each release
append :linked_files, '.env'
append :linked_dirs,  'log', 'tmp/pids', 'tmp/cache', 'tmp/sockets', 'public/assets'

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
