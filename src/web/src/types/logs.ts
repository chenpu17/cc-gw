export interface LogRecord {
  id: number
  timestamp: number
  session_id: string | null
  provider: string
  model: string
  latency_ms: number | null
  status_code: number | null
  input_tokens: number | null
  output_tokens: number | null
  cached_tokens: number | null
  error: string | null
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
