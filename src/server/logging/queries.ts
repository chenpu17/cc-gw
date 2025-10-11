import { getAll, getOne, runQuery } from '../storage/index.js'
import { decompressPayload } from './logger.js'

export interface LogRecord {
  id: number
  timestamp: number
  session_id: string | null
  endpoint: string
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
  api_key_id: number | null
  api_key_name: string | null
  api_key_value: string | null
}

export interface LogListOptions {
  limit?: number
  offset?: number
  provider?: string
  model?: string
  status?: 'success' | 'error'
  from?: number
  to?: number
  apiKeyIds?: number[]
  endpoint?: string
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
    conditions.push('provider = @provider')
    params.provider = options.provider
  }

  if (options.endpoint) {
    conditions.push('endpoint = @endpoint')
    params.endpoint = options.endpoint
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

  if (options.apiKeyIds && options.apiKeyIds.length > 0) {
    const placeholders: string[] = []
    options.apiKeyIds.forEach((id, index) => {
      const key = `apiKey${index}`
      placeholders.push(`@${key}`)
      params[key] = id
    })
    conditions.push(`(api_key_id IN (${placeholders.join(', ')}))`)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const totalRow = await getOne<{ count: number }>(
    `SELECT COUNT(*) AS count FROM request_logs ${whereClause}`,
    params
  )

  const items = await getAll<LogRecord>(
    `SELECT id, timestamp, session_id, endpoint, provider, model, client_model,
            stream, latency_ms, status_code, input_tokens, output_tokens,
            cached_tokens, ttft_ms, tpot_ms, error, api_key_id, api_key_name, api_key_value
       FROM request_logs
       ${whereClause}
       ORDER BY timestamp DESC
       LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
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
    `SELECT id, timestamp, session_id, endpoint, provider, model, client_model,
            stream, latency_ms, status_code, input_tokens, output_tokens,
            cached_tokens, ttft_ms, tpot_ms, error, api_key_id, api_key_name, api_key_value
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

export async function getDailyMetrics(days = 7, endpoint?: string): Promise<DailyMetric[]> {
  const params: Array<number | string> = [days]
  const whereClause = endpoint ? 'WHERE endpoint = ?' : ''
  if (endpoint) {
    params.unshift(endpoint)
  }
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
       ${whereClause}
       ORDER BY date DESC
       LIMIT ?`,
    params
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

export async function getMetricsOverview(endpoint?: string): Promise<MetricsOverview> {
  const totalsWhere = endpoint ? 'WHERE endpoint = ?' : ''
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
     FROM daily_metrics
     ${totalsWhere}`,
    endpoint ? [endpoint] : []
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
       WHERE date = ?
         ${endpoint ? 'AND endpoint = ?' : ''}`,
    endpoint ? [todayKey, endpoint] : [todayKey]
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

export async function getModelUsageMetrics(days = 7, limit = 10, endpoint?: string): Promise<ModelUsageMetric[]> {
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  const params: Array<number | string> = [since]
  const endpointClause = endpoint ? 'AND endpoint = ?' : ''
  if (endpoint) {
    params.push(endpoint)
  }
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
       ${endpointClause}
     GROUP BY provider, model
     ORDER BY requests DESC
     LIMIT ?`,
    [...params, limit]
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

export interface ApiKeyOverviewMetrics {
  totalKeys: number
  enabledKeys: number
  activeKeys: number
  rangeDays: number
}

export async function getApiKeyOverviewMetrics(rangeDays = 7, endpoint?: string): Promise<ApiKeyOverviewMetrics> {
  const totals = await getOne<{
    total: number
    enabled: number
  }>('SELECT COUNT(*) AS total, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled FROM api_keys')

  const since = Date.now() - rangeDays * 24 * 60 * 60 * 1000
  const params: Array<number | string> = [since]
  const endpointClause = endpoint ? 'AND endpoint = ?' : ''
  if (endpoint) {
    params.push(endpoint)
  }
  const active = await getOne<{ count: number }>(
    `SELECT COUNT(DISTINCT api_key_id) AS count
       FROM request_logs
      WHERE api_key_id IS NOT NULL
        AND timestamp >= ?
        ${endpointClause}`,
    params
  )

  return {
    totalKeys: totals?.total ?? 0,
    enabledKeys: totals?.enabled ?? 0,
    activeKeys: active?.count ?? 0,
    rangeDays
  }
}

export interface ApiKeyUsageMetric {
  apiKeyId: number | null
  apiKeyName: string | null
  requests: number
  inputTokens: number
  outputTokens: number
  lastUsedAt: string | null
}

export async function getApiKeyUsageMetrics(days = 7, limit = 10, endpoint?: string): Promise<ApiKeyUsageMetric[]> {
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  const params: Array<number | string> = [since]
  const endpointClause = endpoint ? 'AND endpoint = ?' : ''
  if (endpoint) {
    params.push(endpoint)
  }
  const rows = await getAll<{
    apiKeyId: number | null
    apiKeyName: string | null
    requests: number
    inputTokens: number
    outputTokens: number
    lastUsedAt: number | null
  }>(
    `SELECT
       api_key_id AS apiKeyId,
       api_key_name AS apiKeyName,
       COUNT(*) AS requests,
       COALESCE(SUM(input_tokens), 0) AS inputTokens,
       COALESCE(SUM(output_tokens), 0) AS outputTokens,
       MAX(timestamp) AS lastUsedAt
     FROM request_logs
     WHERE timestamp >= ?
       ${endpointClause}
     GROUP BY api_key_id, api_key_name
     ORDER BY requests DESC
     LIMIT ?`,
    [...params, limit]
  )

  return rows.map((row) => ({
    apiKeyId: row.apiKeyId ?? null,
    apiKeyName: row.apiKeyName ?? null,
    requests: row.requests ?? 0,
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null
  }))
}
