source "https://rubygems.org"
git_source(:github) { |repo| "https://github.com/#{repo}.git" }

ruby "4.0.1"

# Bundle edge Rails instead: gem "rails", github: "rails/rails", branch: "main"
gem "rails", "~> 7.0.3"

# The original asset pipeline for Rails [https://github.com/rails/sprockets-rails]
gem "sprockets-rails"

# Use the Puma web server [https://github.com/puma/puma]
gem "puma", "~> 5.0"

# Use JavaScript with ESM import maps [https://github.com/rails/importmap-rails]
gem "importmap-rails"

# Use Kredis to get higher-level data types in Redis [https://github.com/rails/kredis]
# gem "kredis"

# Use Active Model has_secure_password [https://guides.rubyonrails.org/active_model_basics.html#securepassword]
# gem "bcrypt", "~> 3.1.7"


# Reduces boot times through caching; required in config/boot.rb
gem "bootsnap", require: false

# Use Sass to process CSS
# gem "sassc-rails"

gem "csv"
gem "dotenv-rails"
gem "tzinfo"
gem "tzinfo-data"
gem "fiddle"  # required explicitly in Ruby 4.0+ (no longer a default gem)
gem "logger"  # required explicitly in Ruby 4.0+ (no longer a default gem)
gem "tsort"   # will be removed from default gems in Ruby 4.1+

group :development, :test do
  # See https://guides.rubyonrails.org/debugging_rails_applications.html#debugging-with-the-debug-gem
  gem "debug"
end

group :development do
  # Use console on exceptions pages [https://github.com/rails/web-console]
  gem "web-console"

  # Deployment
  gem "capistrano",         require: false
  gem "capistrano-rails",   require: false
  gem "capistrano-bundler", require: false
  gem "capistrano-asdf",    require: false
  gem "ed25519",            require: false  # net-ssh ED25519 key support
  gem "bcrypt_pbkdf",       require: false  # net-ssh ED25519 key support

  # Add speed badges [https://github.com/MiniProfiler/rack-mini-profiler]
  # gem "rack-mini-profiler"

  # Speed up commands on slow machines / big apps [https://github.com/rails/spring]
  # gem "spring"
end

