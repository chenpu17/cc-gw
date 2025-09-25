import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib'
import { getDb } from '../storage/index.js'

interface LogEntry {
  timestamp: number
  sessionId?: string
  provider: string
  model: string
  clientModel?: string
  latencyMs?: number
  statusCode?: number
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  error?: string | null
}

export function recordLog(entry: LogEntry): number {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO request_logs (
      timestamp, session_id, provider, model, client_model,
      latency_ms, status_code, input_tokens, output_tokens, cached_tokens, error
    ) VALUES (@timestamp, @sessionId, @provider, @model, @clientModel, @latencyMs, @statusCode, @inputTokens, @outputTokens, @cachedTokens, @error)
  `)
  const result = stmt.run({
    timestamp: entry.timestamp,
    sessionId: entry.sessionId ?? null,
    provider: entry.provider,
    model: entry.model,
    clientModel: entry.clientModel ?? null,
    latencyMs: entry.latencyMs ?? null,
    statusCode: entry.statusCode ?? null,
    inputTokens: entry.inputTokens ?? null,
    outputTokens: entry.outputTokens ?? null,
    cachedTokens: entry.cachedTokens ?? null,
    error: entry.error ?? null
  })
  const requestId = Number(result.lastInsertRowid)

  return requestId
}

const BROTLI_OPTIONS = {
  params: {
    [zlibConstants.BROTLI_PARAM_QUALITY]: 1
  }
} as const

function compressPayload(value: string | null | undefined): Buffer | null {
  if (value === undefined || value === null) {
    return null
  }
  if (value.length === 0) {
    return Buffer.alloc(0)
  }
  return brotliCompressSync(Buffer.from(value, 'utf8'), BROTLI_OPTIONS)
}

export function decompressPayload(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value === 'string') {
    return value
  }
  if (Buffer.isBuffer(value)) {
    if (value.length === 0) {
      return ''
    }
    try {
      const decompressed = brotliDecompressSync(value)
      return decompressed.toString('utf8')
    } catch {
      return value.toString('utf8')
    }
  }
  return null
}

export function updateLogTokens(
  requestId: number,
  values: {
    inputTokens: number
    outputTokens: number
    cachedTokens?: number | null
    ttftMs?: number | null
    tpotMs?: number | null
  }
): void {
  const db = getDb()
  const setters = ['input_tokens = ?', 'output_tokens = ?', 'cached_tokens = ?']
  const params: Array<number | null> = [
    values.inputTokens,
    values.outputTokens,
    values.cachedTokens ?? null
  ]

  if (values.ttftMs !== undefined) {
    setters.push('ttft_ms = ?')
    params.push(values.ttftMs ?? null)
  }

  if (values.tpotMs !== undefined) {
    setters.push('tpot_ms = ?')
    params.push(values.tpotMs ?? null)
  }

  db.prepare(`UPDATE request_logs SET ${setters.join(', ')} WHERE id = ?`).run(...params, requestId)
}

export function finalizeLog(
  requestId: number,
  info: {
    latencyMs?: number
    statusCode?: number | null
    error?: string | null
    clientModel?: string | null
  }
): void {
  const db = getDb()
  const setters: string[] = []
  const values: Array<number | string | null> = []

  if (info.latencyMs !== undefined) {
    setters.push('latency_ms = ?')
    values.push(info.latencyMs)
  }
  if (info.statusCode !== undefined) {
    setters.push('status_code = ?')
    values.push(info.statusCode ?? null)
  }
  if (info.error !== undefined) {
    setters.push('error = ?')
    values.push(info.error ?? null)
  }
  if (info.clientModel !== undefined) {
    setters.push('client_model = ?')
    values.push(info.clientModel ?? null)
  }

  if (setters.length === 0) return

  const stmt = db.prepare(`UPDATE request_logs SET ${setters.join(', ')} WHERE id = ?`)
  stmt.run(...values, requestId)
}

export function upsertLogPayload(
  requestId: number,
  payload: { prompt?: string | null; response?: string | null }
): void {
  if (payload.prompt === undefined && payload.response === undefined) {
    return
  }
  const db = getDb()
  const promptData =
    payload.prompt === undefined ? null : compressPayload(payload.prompt)
  const responseData =
    payload.response === undefined ? null : compressPayload(payload.response)
  db.prepare(`
    INSERT INTO request_payloads (request_id, prompt, response)
    VALUES (?, ?, ?)
    ON CONFLICT(request_id) DO UPDATE SET
      prompt = COALESCE(excluded.prompt, request_payloads.prompt),
      response = COALESCE(excluded.response, request_payloads.response)
  `).run(
    requestId,
    promptData,
    responseData
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
