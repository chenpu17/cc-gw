export interface LogRecord {
  id: number
  timestamp: number
  session_id: string | null
  endpoint: string
  provider: string
  model: string
  client_model: string | null
  stream: boolean
  latency_ms: number | null
  status_code: number | null
  input_tokens: number | null
  output_tokens: number | null
  cached_tokens: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  ttft_ms: number | null
  tpot_ms: number | null
  error: string | null
  api_key_id: number | null
  api_key_name: string | null
  api_key_value_masked?: string | null
  api_key_value_available?: boolean
}

export interface LogPayload {
  prompt: string | null
  response: string | null
}

export interface LogDetail extends LogRecord {
  payload: LogPayload | null
}

export interface LogListResponse {
  total: number
  items: LogRecord[]
}
