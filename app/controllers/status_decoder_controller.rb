require_relative '../../lib/importers/sheets_importer'
require_relative '../../lib/data_loader'

class StatusDecoderController < ApplicationController
  def index
  end

  SHEETS = %i[status other extra].freeze

  # GET /status_decoder/sheet_data
  # Fetches the Status, Other and Extra sheets live on every request.
  def sheet_data
    urls = DataLoader.sheet_urls(SHEETS)
    unless urls.key?(:status)
      render json: { error: 'STATUS_SHEET_URL not configured' }, status: :internal_server_error
      return
    end
    render json: urls.transform_values { |url| SheetsImporter.fetch(url) }
  rescue => e
    render json: { error: e.message }, status: :internal_server_error
  end
end
