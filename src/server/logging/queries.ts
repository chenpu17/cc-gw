import { getAll, getOne, runQuery } from '../storage/index.js'
import { decompressPayload } from './logger.js'

export interface LogRecord {
  id: number
  timestamp: number
  session_id: string | null
  provider: string
  model: string
  client_model: string | null
  stream: number | null
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

export async function queryLogs(options: LogListOptions = {}): Promise<LogListResult> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const offset = Math.max(options.offset ?? 0, 0)

  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  if (options.provider) {
    conditions.push('provider = $provider')
    params.$provider = options.provider
  }

  if (options.model) {
    conditions.push('model = $model')
    params.$model = options.model
  }

  if (options.status === 'success') {
    conditions.push('error IS NULL')
  } else if (options.status === 'error') {
    conditions.push('error IS NOT NULL')
  }

  if (typeof options.from === 'number') {
    conditions.push('timestamp >= $from')
    params.$from = options.from
  }

  if (typeof options.to === 'number') {
    conditions.push('timestamp <= $to')
    params.$to = options.to
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const totalRow = await getOne<{ count: number }>(
    `SELECT COUNT(*) AS count FROM request_logs ${whereClause}`,
    params
  )

  const items = await getAll<LogRecord>(
    `SELECT id, timestamp, session_id, provider, model, client_model,
            stream, latency_ms, status_code, input_tokens, output_tokens,
            cached_tokens, ttft_ms, tpot_ms, error
       FROM request_logs
       ${whereClause}
       ORDER BY timestamp DESC
       LIMIT $limit OFFSET $offset`,
    { ...params, $limit: limit, $offset: offset }
  )

  return {
    total: totalRow?.count ?? 0,
    items
  }
}

export async function listLogs(limit = 50, offset = 0): Promise<LogRecord[]> {
  const { items } = await queryLogs({ limit, offset })
  return items
}

export async function getLogDetail(id: number): Promise<LogRecord | null> {
  const record = await getOne<LogRecord>(
    `SELECT id, timestamp, session_id, provider, model, client_model,
            stream, latency_ms, status_code, input_tokens, output_tokens,
            cached_tokens, ttft_ms, tpot_ms, error
       FROM request_logs
       WHERE id = ?`,
    [id]
  )
  return record ?? null
}

export async function getLogPayload(
  id: number
): Promise<{ prompt: string | null; response: string | null } | null> {
  const payload = await getOne<{ prompt: unknown; response: unknown }>(
    'SELECT prompt, response FROM request_payloads WHERE request_id = ?',
    [id]
  )

  if (!payload) {
    return null
  }

  return {
    prompt: decompressPayload(payload.prompt),
    response: decompressPayload(payload.response)
  }
}

export async function cleanupLogsBefore(timestamp: number): Promise<number> {
  const result = await runQuery('DELETE FROM request_logs WHERE timestamp < ?', [timestamp])
  return Number(result.changes ?? 0)
}

export async function clearAllLogs(): Promise<{ logs: number; metrics: number }> {
  const logsResult = await runQuery('DELETE FROM request_logs', [])
  const metricsResult = await runQuery('DELETE FROM daily_metrics', [])
  return {
    logs: Number(logsResult.changes ?? 0),
    metrics: Number(metricsResult.changes ?? 0)
  }
}

export interface DailyMetric {
  date: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  avgLatencyMs: number
}

export async function getDailyMetrics(days = 7): Promise<DailyMetric[]> {
  const rows = await getAll<{
    date: string
    requestCount: number | null
    inputTokens: number | null
    outputTokens: number | null
    totalLatency: number | null
  }>(
    `SELECT date,
            request_count AS requestCount,
            total_input_tokens AS inputTokens,
            total_output_tokens AS outputTokens,
            total_latency_ms AS totalLatency
       FROM daily_metrics
       ORDER BY date DESC
       LIMIT ?`,
    [days]
  )

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

export async function getMetricsOverview(): Promise<MetricsOverview> {
  const totalsRow = await getOne<{
    requests: number
    inputTokens: number
    outputTokens: number
    totalLatency: number
  }>(
    `SELECT
       COALESCE(SUM(request_count), 0) AS requests,
       COALESCE(SUM(total_input_tokens), 0) AS inputTokens,
       COALESCE(SUM(total_output_tokens), 0) AS outputTokens,
       COALESCE(SUM(total_latency_ms), 0) AS totalLatency
     FROM daily_metrics`
  )

  const todayKey = new Date().toISOString().slice(0, 10)
  const todayRow = await getOne<{
    requests: number | null
    inputTokens: number | null
    outputTokens: number | null
    totalLatency: number | null
  }>(
    `SELECT request_count AS requests,
            total_input_tokens AS inputTokens,
            total_output_tokens AS outputTokens,
            total_latency_ms AS totalLatency
       FROM daily_metrics
       WHERE date = ?`,
    [todayKey]
  )

  const resolveAvg = (totalLatency: number, requests: number) => (requests > 0 ? Math.round(totalLatency / requests) : 0)

  const totalsRequests = totalsRow?.requests ?? 0
  const totalsLatency = totalsRow?.totalLatency ?? 0

  const todayRequests = todayRow?.requests ?? 0
  const todayLatency = todayRow?.totalLatency ?? 0

  return {
    totals: {
      requests: totalsRequests,
      inputTokens: totalsRow?.inputTokens ?? 0,
      outputTokens: totalsRow?.outputTokens ?? 0,
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
  avgTtftMs: number | null
  avgTpotMs: number | null
}

export async function getModelUsageMetrics(days = 7, limit = 10): Promise<ModelUsageMetric[]> {
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  const rows = await getAll<{
    model: string
    provider: string
    requests: number
    inputTokens: number
    outputTokens: number
    totalLatency: number
    avgTtftMs: number | null
    avgTpotMs: number | null
  }>(
    `SELECT
       model,
       provider,
       COUNT(*) AS requests,
       COALESCE(SUM(input_tokens), 0) AS inputTokens,
       COALESCE(SUM(output_tokens), 0) AS outputTokens,
       COALESCE(SUM(latency_ms), 0) AS totalLatency,
       AVG(CASE WHEN ttft_ms IS NULL THEN NULL ELSE ttft_ms END) AS avgTtftMs,
       AVG(CASE WHEN tpot_ms IS NULL THEN NULL ELSE tpot_ms END) AS avgTpotMs
     FROM request_logs
     WHERE timestamp >= ?
     GROUP BY provider, model
     ORDER BY requests DESC
     LIMIT ?`,
    [since, limit]
  )

  const roundValue = (value: number | null | undefined, fractionDigits = 0) =>
    value == null ? null : Number(value.toFixed(fractionDigits))

  return rows.map((row) => ({
    model: row.model,
    provider: row.provider,
    requests: row.requests ?? 0,
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    avgLatencyMs: row.requests ? Math.round((row.totalLatency ?? 0) / row.requests) : 0,
    avgTtftMs: roundValue(row.avgTtftMs, 0),
    avgTpotMs: roundValue(row.avgTpotMs, 2)
  }))
}
