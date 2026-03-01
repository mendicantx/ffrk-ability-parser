# Load DSL and set up stages
require "capistrano/setup"

# Include default deployment tasks
require "capistrano/deploy"

# Git SCM plugin (explicit as of Capistrano 3.19+)
require "capistrano/scm/git"
install_plugin Capistrano::SCM::Git

# Load asdf integration (manages Ruby version via .tool-versions)
require "capistrano/asdf"

# Bundler: run `bundle install` on each deploy
require "capistrano/bundler"

# Rails tasks: asset precompile, etc. (no migrations since no DB)
require "capistrano/rails/assets"

# Load custom tasks from `lib/capistrano/tasks` if you have any
Dir.glob("lib/capistrano/tasks/*.rake").each { |r| import r }
