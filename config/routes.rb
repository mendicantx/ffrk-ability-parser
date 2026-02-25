Rails.application.routes.draw do
  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  root "dashboard#index"

  get  '/ability_parser',            to: 'ability_parser#index'
  get  '/ability_parser/battle_js',  to: 'ability_parser#battle_js'
  get  '/ability_parser/sheet_data', to: 'ability_parser#sheet_data'
end
