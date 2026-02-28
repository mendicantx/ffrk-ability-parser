require_relative '../../lib/importers/sheets_importer'

class StatusDecoderController < ApplicationController
  def index
  end

  # GET /status_decoder/sheet_data
  # Fetches the Status and Other sheets live on every request.
  def sheet_data
    url = ENV['STATUS_SHEET_URL']
    if url.blank?
      render json: { error: 'STATUS_SHEET_URL not configured' }, status: :internal_server_error
      return
    end
    result = { status: SheetsImporter.fetch(url) }
    other_url = ENV['OTHER_SHEET_URL']
    result[:other] = SheetsImporter.fetch(other_url) if other_url.present?
    render json: result
  rescue => e
    render json: { error: e.message }, status: :internal_server_error
  end
end
