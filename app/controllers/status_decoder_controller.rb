require_relative '../../lib/importers/sheets_importer'

class StatusDecoderController < ApplicationController
  def index
  end

  # GET /status_decoder/sheet_data
  # Fetches the Status sheet live from STATUS_SHEET_URL on every request.
  def sheet_data
    url = ENV['STATUS_SHEET_URL']
    if url.blank?
      render json: { error: 'STATUS_SHEET_URL not configured' }, status: :internal_server_error
      return
    end
    rows = SheetsImporter.fetch(url)
    render json: { status: rows }
  rescue => e
    render json: { error: e.message }, status: :internal_server_error
  end
end
