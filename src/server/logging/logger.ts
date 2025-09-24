import { getDb } from '../storage/index.js'

interface LogEntry {
  timestamp: number
  sessionId?: string
  provider: string
  model: string
  latencyMs?: number
  statusCode?: number
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  error?: string | null
  prompt?: string
  response?: string
}

export function recordLog(entry: LogEntry): number {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO request_logs (
      timestamp, session_id, provider, model,
      latency_ms, status_code, input_tokens, output_tokens, cached_tokens, error
    ) VALUES (@timestamp, @sessionId, @provider, @model, @latencyMs, @statusCode, @inputTokens, @outputTokens, @cachedTokens, @error)
  `)
  const result = stmt.run({
    timestamp: entry.timestamp,
    sessionId: entry.sessionId ?? null,
    provider: entry.provider,
    model: entry.model,
    latencyMs: entry.latencyMs ?? null,
    statusCode: entry.statusCode ?? null,
    inputTokens: entry.inputTokens ?? null,
    outputTokens: entry.outputTokens ?? null,
    cachedTokens: entry.cachedTokens ?? null,
    error: entry.error ?? null
  })
  const requestId = Number(result.lastInsertRowid)

  if (entry.prompt || entry.response) {
    db.prepare(`
      INSERT INTO request_payloads (request_id, prompt, response)
      VALUES (?, ?, ?)
    `).run(requestId, entry.prompt ?? null, entry.response ?? null)
  }

  return requestId
}

export function updateLogTokens(
  requestId: number,
  inputTokens: number,
  outputTokens: number,
  cachedTokens?: number | null
): void {
  const db = getDb()
  db.prepare(`UPDATE request_logs SET input_tokens = ?, output_tokens = ?, cached_tokens = ? WHERE id = ?`).run(
    inputTokens,
    outputTokens,
    cachedTokens ?? null,
    requestId
  )
}

export function updateMetrics(date: string, delta: {
  requests: number
  inputTokens: number
  outputTokens: number
  latencyMs: number
}): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO daily_metrics (date, request_count, total_input_tokens, total_output_tokens, total_latency_ms)
    VALUES (@date, @requests, @inputTokens, @outputTokens, @latencyMs)
    ON CONFLICT(date) DO UPDATE SET
      request_count = daily_metrics.request_count + excluded.request_count,
      total_input_tokens = daily_metrics.total_input_tokens + excluded.total_input_tokens,
      total_output_tokens = daily_metrics.total_output_tokens + excluded.total_output_tokens,
      total_latency_ms = daily_metrics.total_latency_ms + excluded.total_latency_ms
  `).run({
    date,
    requests: delta.requests,
    inputTokens: delta.inputTokens,
    outputTokens: delta.outputTokens,
    latencyMs: delta.latencyMs
  })
}

export function cleanupLogs(beforeTimestamp: number): number {
  const db = getDb()
  const result = db.prepare(`DELETE FROM request_logs WHERE timestamp < ?`).run(beforeTimestamp)
  return Number(result.changes ?? 0)
}
