Rails.application.routes.draw do
  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  root "dashboard#index"

  get  '/ability_parser', to: 'ability_parser#index'
  get  '/status_decoder', to: 'status_decoder#index'

  # Cached data for both tools (see DataController)
  get  '/data/sheets',    to: 'data#sheets'
  get  '/data/battle_js', to: 'data#battle_js'
  get  '/data/status',    to: 'data#status'
  post '/data/refresh',   to: 'data#refresh'

  # Older URLs, kept as aliases
  get  '/ability_parser/battle_js',  to: 'data#battle_js'
  get  '/ability_parser/sheet_data', to: 'data#sheets'
  get  '/status_decoder/sheet_data', to: 'data#sheets', defaults: { names: 'status,other,extra' }
end
