import { getDb } from '../storage/index.js'
import { decompressPayload } from './logger.js'

export interface LogRecord {
  id: number
  timestamp: number
  session_id: string | null
  provider: string
  model: string
  client_model: string | null
  latency_ms: number | null
  status_code: number | null
  input_tokens: number | null
  output_tokens: number | null
  cached_tokens: number | null
  ttft_ms: number | null
  tpot_ms: number | null
  error: string | null
}

export interface LogListOptions {
  limit?: number
  offset?: number
  provider?: string
  model?: string
  status?: 'success' | 'error'
  from?: number
  to?: number
}

export interface LogListResult {
  total: number
  items: LogRecord[]
}

export function queryLogs(options: LogListOptions = {}): LogListResult {
  const db = getDb()
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const offset = Math.max(options.offset ?? 0, 0)

  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (options.provider) {
    conditions.push('provider = @provider')
    params.provider = options.provider
  }

  if (options.model) {
    conditions.push('model = @model')
    params.model = options.model
  }

  if (options.status === 'success') {
    conditions.push('error IS NULL')
  } else if (options.status === 'error') {
    conditions.push('error IS NOT NULL')
  }

  if (typeof options.from === 'number') {
    conditions.push('timestamp >= @from')
    params.from = options.from
  }

  if (typeof options.to === 'number') {
    conditions.push('timestamp <= @to')
    params.to = options.to
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS count FROM request_logs ${whereClause}`)
    .get(params) as { count: number } | undefined

  const items = db
    .prepare(
      `SELECT id, timestamp, session_id, provider, model, client_model, latency_ms, status_code, input_tokens, output_tokens, cached_tokens, ttft_ms, tpot_ms, error
       FROM request_logs
       ${whereClause}
       ORDER BY timestamp DESC
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset }) as LogRecord[]

  return {
    total: totalRow?.count ?? 0,
    items
  }
}

export function listLogs(limit = 50, offset = 0): LogRecord[] {
  return queryLogs({ limit, offset }).items
}

export function getLogDetail(id: number): LogRecord | null {
  const db = getDb()
  const record = db
    .prepare(
      `SELECT id, timestamp, session_id, provider, model, client_model, latency_ms, status_code, input_tokens, output_tokens, cached_tokens, ttft_ms, tpot_ms, error
       FROM request_logs
       WHERE id = ?`
    )
    .get(id) as LogRecord | undefined
  return record ?? null
}

export function getLogPayload(id: number): { prompt: string | null; response: string | null } | null {
  const db = getDb()
  const payload = db
    .prepare(`SELECT prompt, response FROM request_payloads WHERE request_id = ?`)
    .get(id) as { prompt: string | null; response: string | null } | undefined
  if (!payload) {
    return null
  }
  return {
    prompt: decompressPayload(payload.prompt),
    response: decompressPayload(payload.response)
  }
}

export function cleanupLogsBefore(timestamp: number): number {
  const db = getDb()
  const stmt = db.prepare(`DELETE FROM request_logs WHERE timestamp < ?`)
  const result = stmt.run(timestamp)
  return Number(result.changes ?? 0)
}

export interface DailyMetric {
  date: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  avgLatencyMs: number
}

export function getDailyMetrics(days = 7): DailyMetric[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT date, request_count AS requestCount, total_input_tokens AS inputTokens,
              total_output_tokens AS outputTokens, total_latency_ms AS totalLatency
         FROM daily_metrics
         ORDER BY date DESC
         LIMIT ?`
    )
    .all(days) as Array<{
    date: string
    requestCount: number
    inputTokens: number | null
    outputTokens: number | null
    totalLatency: number | null
  }>

  return rows
    .map((row) => ({
      date: row.date,
      requestCount: row.requestCount ?? 0,
      inputTokens: row.inputTokens ?? 0,
      outputTokens: row.outputTokens ?? 0,
      avgLatencyMs: row.requestCount ? Math.round((row.totalLatency ?? 0) / row.requestCount) : 0
    }))
    .reverse()
}

export interface MetricsOverview {
  totals: {
    requests: number
    inputTokens: number
    outputTokens: number
    avgLatencyMs: number
  }
  today: {
    requests: number
    inputTokens: number
    outputTokens: number
    avgLatencyMs: number
  }
}

export function getMetricsOverview(): MetricsOverview {
  const db = getDb()
  const totalsRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(request_count), 0) AS requests,
         COALESCE(SUM(total_input_tokens), 0) AS inputTokens,
         COALESCE(SUM(total_output_tokens), 0) AS outputTokens,
         COALESCE(SUM(total_latency_ms), 0) AS totalLatency
       FROM daily_metrics`
    )
    .get() as {
    requests: number
    inputTokens: number
    outputTokens: number
    totalLatency: number
  }

  const todayKey = new Date().toISOString().slice(0, 10)
  const todayRow = db
    .prepare(
      `SELECT request_count AS requests,
              total_input_tokens AS inputTokens,
              total_output_tokens AS outputTokens,
              total_latency_ms AS totalLatency
         FROM daily_metrics WHERE date = ?`
    )
    .get(todayKey) as
    | {
        requests: number | null
        inputTokens: number | null
        outputTokens: number | null
        totalLatency: number | null
      }
    | undefined

  const resolveAvg = (totalLatency: number, requests: number) => (requests > 0 ? Math.round(totalLatency / requests) : 0)

  const totalsRequests = totalsRow.requests ?? 0
  const totalsLatency = totalsRow.totalLatency ?? 0

  const todayRequests = todayRow?.requests ?? 0
  const todayLatency = todayRow?.totalLatency ?? 0

  return {
    totals: {
      requests: totalsRequests,
      inputTokens: totalsRow.inputTokens ?? 0,
      outputTokens: totalsRow.outputTokens ?? 0,
      avgLatencyMs: resolveAvg(totalsLatency, totalsRequests)
    },
    today: {
      requests: todayRequests,
      inputTokens: todayRow?.inputTokens ?? 0,
      outputTokens: todayRow?.outputTokens ?? 0,
      avgLatencyMs: resolveAvg(todayLatency, todayRequests)
    }
  }
}

export interface ModelUsageMetric {
  model: string
  provider: string
  requests: number
  inputTokens: number
  outputTokens: number
  avgLatencyMs: number
}

export function getModelUsageMetrics(days = 7, limit = 10): ModelUsageMetric[] {
  const db = getDb()
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  const rows = db
    .prepare(
      `SELECT
         model,
         provider,
         COUNT(*) AS requests,
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COALESCE(SUM(latency_ms), 0) AS totalLatency
       FROM request_logs
       WHERE timestamp >= ?
       GROUP BY provider, model
       ORDER BY requests DESC
       LIMIT ?`
    )
    .all(since, limit) as Array<{
    model: string
    provider: string
    requests: number
    inputTokens: number
    outputTokens: number
    totalLatency: number
  }>

  return rows.map((row) => ({
    model: row.model,
    provider: row.provider,
    requests: row.requests ?? 0,
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    avgLatencyMs: row.requests ? Math.round((row.totalLatency ?? 0) / row.requests) : 0
  }))
}
