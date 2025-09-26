import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib'
import { runQuery } from '../storage/index.js'

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
      return brotliDecompressSync(value).toString('utf8')
    } catch {
      return value.toString('utf8')
    }
  }
  return null
}

export async function recordLog(entry: LogEntry): Promise<number> {
  const result = await runQuery(
    `INSERT INTO request_logs (
      timestamp, session_id, provider, model, client_model, stream,
      latency_ms, status_code, input_tokens, output_tokens, cached_tokens, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.timestamp,
      entry.sessionId ?? null,
      entry.provider,
      entry.model,
      entry.clientModel ?? null,
      entry.stream ? 1 : 0,
      entry.latencyMs ?? null,
      entry.statusCode ?? null,
      entry.inputTokens ?? null,
      entry.outputTokens ?? null,
      entry.cachedTokens ?? null,
      entry.error ?? null
    ]
  )
  return Number(result.lastID)
}

export async function updateLogTokens(
  requestId: number,
  values: {
    inputTokens: number
    outputTokens: number
    cachedTokens?: number | null
    ttftMs?: number | null
    tpotMs?: number | null
  }
): Promise<void> {
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

  params.push(requestId)

  await runQuery(`UPDATE request_logs SET ${setters.join(', ')} WHERE id = ?`, params)
}

export async function finalizeLog(
  requestId: number,
  info: {
    latencyMs?: number
    statusCode?: number | null
    error?: string | null
    clientModel?: string | null
  }
): Promise<void> {
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

  values.push(requestId)
  await runQuery(`UPDATE request_logs SET ${setters.join(', ')} WHERE id = ?`, values)
}

export async function upsertLogPayload(
  requestId: number,
  payload: { prompt?: string | null; response?: string | null }
): Promise<void> {
  if (payload.prompt === undefined && payload.response === undefined) {
    return
  }

  const promptData = payload.prompt === undefined ? null : compressPayload(payload.prompt)
  const responseData = payload.response === undefined ? null : compressPayload(payload.response)

  await runQuery(
    `INSERT INTO request_payloads (request_id, prompt, response)
     VALUES (?, ?, ?)
     ON CONFLICT(request_id) DO UPDATE SET
       prompt = COALESCE(excluded.prompt, request_payloads.prompt),
       response = COALESCE(excluded.response, request_payloads.response)`,
    [requestId, promptData, responseData]
  )
}

export async function updateMetrics(date: string, delta: {
  requests: number
  inputTokens: number
  outputTokens: number
  latencyMs: number
}): Promise<void> {
  await runQuery(
    `INSERT INTO daily_metrics (date, request_count, total_input_tokens, total_output_tokens, total_latency_ms)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       request_count = daily_metrics.request_count + excluded.request_count,
       total_input_tokens = daily_metrics.total_input_tokens + excluded.total_input_tokens,
       total_output_tokens = daily_metrics.total_output_tokens + excluded.total_output_tokens,
       total_latency_ms = daily_metrics.total_latency_ms + excluded.total_latency_ms`,
    [
      date,
      delta.requests,
      delta.inputTokens,
      delta.outputTokens,
      delta.latencyMs
    ]
  )
}

export async function cleanupLogs(beforeTimestamp: number): Promise<number> {
  const result = await runQuery('DELETE FROM request_logs WHERE timestamp < ?', [beforeTimestamp])
  return Number(result.changes ?? 0)
}
