import type { FastifyInstance } from 'fastify'
import JSZip from 'jszip'
import { normalizeClaudePayload } from '../protocol/normalize.js'
import { buildProviderBody, buildAnthropicBody } from '../protocol/toProvider.js'
import { getConnector } from '../providers/registry.js'
import { CONFIG_PATH, getConfig, updateConfig } from '../config/manager.js'
import type { GatewayConfig, GatewayEndpoint } from '../config/types.js'
import {
  getLogDetail,
  getLogPayload,
  cleanupLogsBefore,
  clearAllLogs,
  getMetricsOverview,
  getDailyMetrics,
  getModelUsageMetrics,
  getApiKeyOverviewMetrics,
  getApiKeyUsageMetrics,
  queryLogs,
  exportLogs,
  type LogListOptions
} from '../logging/queries.js'
import {
  compactDatabase,
  getDatabaseFileStats,
  getDatabasePageStats
} from '../storage/index.js'
import { getActiveRequestCount } from '../metrics/activity.js'
import {
  listApiKeys,
  createApiKey,
  setApiKeyEnabled,
  deleteApiKey,
  ensureWildcardMetadata,
  decryptApiKeyValue
} from '../api-keys/service.js'
import { createPasswordRecord, revokeAllSessions, sanitizeUsername } from '../security/webAuth.js'

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  try {
    await ensureWildcardMetadata()
  } catch (error) {
    app.log.warn({ error }, '[api-keys] failed to ensure wildcard metadata')
  }

  const maskApiKeyValue = (value: string | null | undefined): string | null => {
    if (!value) return null
    const trimmed = value.trim()
    if (trimmed.length === 0) return null
    if (trimmed.length <= 4) {
      return `${trimmed.slice(0, 1)}***`
    }
    if (trimmed.length <= 8) {
      const prefix = trimmed.slice(0, 2)
      const suffix = trimmed.slice(-2)
      return `${prefix}****${suffix}`
    }
    const prefix = trimmed.slice(0, 4)
    const suffix = trimmed.slice(-4)
    return `${prefix}****${suffix}`
  }

  const mapLogRecord = (record: any, options?: { includeKeyValue?: boolean; decryptedKey?: string | null }) => {
    const base: any = {
      ...record,
      stream: Boolean(record?.stream)
    }

    if ('api_key_value' in base) {
      delete base.api_key_value
    }

    const masked = maskApiKeyValue(options?.decryptedKey ?? record?.api_key_value ?? null)
    if (masked) {
      base.api_key_value_masked = masked
    }
    base.api_key_value_available = Boolean(masked)

    return base
  }

  const parseTimestamp = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && value.length > 0) {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) {
        return numeric
      }
      const parsed = Date.parse(value)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
    return undefined
  }

  const parseApiKeyIds = (value: unknown): number[] => {
    if (!value) return []
    if (Array.isArray(value)) {
      return value.flatMap((item) => parseApiKeyIds(item))
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((num) => Number.isFinite(num))
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return [value]
    }
    return []
  }

  const buildLogOptions = (
    raw: Record<string, unknown>,
    config?: { defaultLimit?: number; maxLimit?: number; includeOffset?: boolean }
  ): { limit: number; offset?: number; filters: LogListOptions } => {
    const defaultLimit = config?.defaultLimit ?? 50
    const maxLimit = config?.maxLimit ?? 200
    const includeOffset = config?.includeOffset ?? true

    const limitRaw = Number(raw.limit ?? defaultLimit)
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), maxLimit)
      : defaultLimit

    let offset: number | undefined
    if (includeOffset) {
      const offsetRaw = Number(raw.offset ?? 0)
      offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0
    }

    const provider = typeof raw.provider === 'string' && raw.provider.length > 0 ? raw.provider : undefined
    const model = typeof raw.model === 'string' && raw.model.length > 0 ? raw.model : undefined
    const statusParam = typeof raw.status === 'string' ? raw.status : undefined
    const status = statusParam === 'success' || statusParam === 'error' ? statusParam : undefined
    const endpoint = isEndpoint(raw.endpoint) ? (raw.endpoint as GatewayEndpoint) : undefined
    const from = parseTimestamp(raw.from)
    const to = parseTimestamp(raw.to)
    const apiKeyIdsRaw = parseApiKeyIds(raw.apiKeys ?? raw.apiKeyIds ?? raw.apiKey)
    const apiKeyIds = apiKeyIdsRaw.length > 0 ? Array.from(new Set(apiKeyIdsRaw)) : undefined

    const filters: LogListOptions = {
      provider,
      model,
      status,
      from,
      to,
      apiKeyIds,
      endpoint
    }

    return {
      limit,
      offset,
      filters
    }
  }
  app.get('/api/status', async () => {
    const config = getConfig()
    return {
      port: config.port,
      host: config.host,
      providers: config.providers.length,
      activeRequests: getActiveRequestCount()
    }
  })

  app.get('/api/providers', async () => {
    const config = getConfig()
    return config.providers
  })

  app.get('/api/config', async () => {
    const config = getConfig()
    if (config.webAuth) {
      const { passwordHash, passwordSalt, ...rest } = config.webAuth
      return {
        ...config,
        webAuth: rest
      }
    }
    return config
  })

  app.get('/api/config/info', async () => {
    const config = getConfig()
    const sanitizedWebAuth = config.webAuth
      ? (() => {
          const { passwordHash, passwordSalt, ...rest } = config.webAuth!
          return rest
        })()
      : undefined
    return {
      config: sanitizedWebAuth ? { ...config, webAuth: sanitizedWebAuth } : config,
      path: CONFIG_PATH
    }
  })

  app.get('/api/auth/web', async () => {
    const config = getConfig()
    const auth = config.webAuth ?? { enabled: false }
    return {
      enabled: Boolean(auth.enabled),
      username: auth.username ?? '',
      hasPassword: Boolean(auth.passwordHash && auth.passwordSalt)
    }
  })

  interface UpdateWebAuthBody {
    enabled: boolean
    username?: string
    password?: string
  }

  app.post('/api/auth/web', async (request, reply) => {
    const body = request.body as UpdateWebAuthBody | undefined
    if (!body || typeof body.enabled !== 'boolean') {
      reply.code(400)
      return { error: 'Invalid payload' }
    }

    const current = getConfig()
    const currentAuth = current.webAuth ?? { enabled: false }
    const nextAuth = { ...currentAuth }

    const normalizedUsername = sanitizeUsername(body.username)
    const rawPassword = typeof body.password === 'string' ? body.password : undefined

    const enforcingPassword = Boolean(rawPassword && rawPassword.length > 0)
    if (enforcingPassword && rawPassword!.length < 6) {
      reply.code(400)
      return { error: 'Password must be at least 6 characters' }
    }

    const willEnable = body.enabled

    if (willEnable) {
      if (!normalizedUsername) {
        reply.code(400)
        return { error: 'Username is required when enabling authentication' }
      }
      nextAuth.enabled = true
      nextAuth.username = normalizedUsername

      const usernameChanged =
        normalizedUsername !== (currentAuth.username ?? undefined)

      if (enforcingPassword) {
        const record = createPasswordRecord(rawPassword!)
        nextAuth.passwordHash = record.passwordHash
        nextAuth.passwordSalt = record.passwordSalt
      } else if (!currentAuth.passwordHash || !currentAuth.passwordSalt || usernameChanged) {
        reply.code(400)
        return { error: 'Password must be provided when enabling authentication' }
      }
    } else {
      nextAuth.enabled = false
      nextAuth.username = normalizedUsername ?? currentAuth.username ?? undefined
      if (enforcingPassword) {
        const record = createPasswordRecord(rawPassword!)
        nextAuth.passwordHash = record.passwordHash
        nextAuth.passwordSalt = record.passwordSalt
      }
    }

    const nextConfig: GatewayConfig = {
      ...current,
      webAuth: nextAuth
    }

    updateConfig(nextConfig)
    const updated = getConfig()

    if (!willEnable || enforcingPassword || (normalizedUsername ?? '') !== (currentAuth.username ?? '')) {
      revokeAllSessions()
    }

    return {
      success: true,
      auth: {
        enabled: Boolean(updated.webAuth?.enabled),
        username: updated.webAuth?.username ?? '',
        hasPassword: Boolean(updated.webAuth?.passwordHash && updated.webAuth?.passwordSalt)
      }
    }
  })

  app.put('/api/config', async (request, reply) => {
    const body = request.body as GatewayConfig
    if (!body || typeof body.port !== 'number') {
      reply.code(400)
      return { error: 'Invalid config payload' }
    }
    const current = getConfig()
    const hasWebAuthField = Object.prototype.hasOwnProperty.call(body, 'webAuth')
    const nextWebAuth = hasWebAuthField
      ? (body.webAuth
        ? {
            ...current.webAuth,
            ...body.webAuth
          }
        : undefined)
      : current.webAuth

    const nextConfig: GatewayConfig = {
      ...current,
      ...body,
      webAuth: nextWebAuth
    }

    updateConfig(nextConfig)
    return { success: true }
  })

  const parseEndpoint = (value: string): GatewayEndpoint | null => {
    if (value === 'anthropic' || value === 'openai') {
      return value
    }
    return null
  }

  const cloneRoutes = (routes: Record<string, string> | undefined): Record<string, string> => {
    const normalized: Record<string, string> = {}
    if (!routes) return normalized
    for (const [source, target] of Object.entries(routes)) {
      if (typeof target === 'string' && target.trim()) {
        normalized[source] = target
      }
    }
    return normalized
  }

  app.post('/api/routing-presets/:endpoint', async (request, reply) => {
    const endpoint = parseEndpoint(String((request.params as Record<string, string>).endpoint))
    if (!endpoint) {
      reply.code(400)
      return { error: 'Unsupported endpoint' }
    }

    const rawName = (request.body as Record<string, unknown> | undefined)?.name
    if (typeof rawName !== 'string') {
      reply.code(400)
      return { error: 'Preset name is required' }
    }
    const name = rawName.trim()
    if (!name) {
      reply.code(400)
      return { error: 'Preset name cannot be empty' }
    }

    const config = getConfig()
    const routingConfig = config.endpointRouting?.[endpoint]
    const baseRoutes = endpoint === 'anthropic'
      ? routingConfig?.modelRoutes ?? config.modelRoutes ?? {}
      : routingConfig?.modelRoutes ?? {}

    const currentPresets = config.routingPresets?.[endpoint] ?? []
    const duplicate = currentPresets.some((preset) => preset.name.toLowerCase() === name.toLowerCase())
    if (duplicate) {
      reply.code(409)
      return { error: 'Preset name already exists' }
    }

    const nextPresets = [...currentPresets, {
      name,
      modelRoutes: cloneRoutes(baseRoutes),
      createdAt: Date.now()
    }]
    nextPresets.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

    const nextConfig: GatewayConfig = {
      ...config,
      routingPresets: {
        ...config.routingPresets,
        [endpoint]: nextPresets
      }
    }

    updateConfig(nextConfig)
    const updated = getConfig()
    return {
      success: true,
      presets: updated.routingPresets?.[endpoint] ?? []
    }
  })

  app.post('/api/routing-presets/:endpoint/apply', async (request, reply) => {
    const endpoint = parseEndpoint(String((request.params as Record<string, string>).endpoint))
    if (!endpoint) {
      reply.code(400)
      return { error: 'Unsupported endpoint' }
    }

    const rawName = (request.body as Record<string, unknown> | undefined)?.name
    if (typeof rawName !== 'string') {
      reply.code(400)
      return { error: 'Preset name is required' }
    }
    const name = rawName.trim()
    if (!name) {
      reply.code(400)
      return { error: 'Preset name cannot be empty' }
    }

    const config = getConfig()
    const presets = config.routingPresets?.[endpoint] ?? []
    const preset = presets.find((item) => item.name.toLowerCase() === name.toLowerCase())
    if (!preset) {
      reply.code(404)
      return { error: 'Preset not found' }
    }

    const routing = config.endpointRouting ?? {
      anthropic: {
        defaults: config.defaults,
        modelRoutes: config.modelRoutes ?? {}
      }
    }

    const nextRouting: NonNullable<GatewayConfig['endpointRouting']> = {
      ...routing,
      [endpoint]: {
        defaults: routing[endpoint]?.defaults ?? config.defaults,
        modelRoutes: cloneRoutes(preset.modelRoutes)
      }
    }

    const nextConfig: GatewayConfig = {
      ...config,
      endpointRouting: nextRouting,
      modelRoutes: endpoint === 'anthropic' ? cloneRoutes(preset.modelRoutes) : config.modelRoutes,
      routingPresets: config.routingPresets
    }

    updateConfig(nextConfig)
    const updated = getConfig()
    return {
      success: true,
      routes: updated.endpointRouting?.[endpoint]?.modelRoutes ?? {},
      config: updated
    }
  })

  app.delete('/api/routing-presets/:endpoint/:name', async (request, reply) => {
    const endpoint = parseEndpoint(String((request.params as Record<string, string>).endpoint))
    if (!endpoint) {
      reply.code(400)
      return { error: 'Unsupported endpoint' }
    }

    const rawName = (request.params as Record<string, string>).name
    const name = typeof rawName === 'string' ? decodeURIComponent(rawName).trim() : ''
    if (!name) {
      reply.code(400)
      return { error: 'Preset name is required' }
    }

    const config = getConfig()
    const presets = config.routingPresets?.[endpoint] ?? []
    const filtered = presets.filter((item) => item.name.toLowerCase() !== name.toLowerCase())
    if (filtered.length === presets.length) {
      reply.code(404)
      return { error: 'Preset not found' }
    }

    const nextConfig: GatewayConfig = {
      ...config,
      routingPresets: {
        ...config.routingPresets,
        [endpoint]: filtered
      }
    }

    updateConfig(nextConfig)
    const updated = getConfig()
    return {
      success: true,
      presets: updated.routingPresets?.[endpoint] ?? []
    }
  })

  app.post('/api/providers/:id/test', async (request, reply) => {
    const id = String((request.params as Record<string, string>).id)
    const config = getConfig()
    const provider = config.providers.find((item) => item.id === id)
    if (!provider) {
      reply.code(404)
      return { error: 'Provider not found' }
    }

    const startedAt = Date.now()

    const targetModel = provider.defaultModel || provider.models?.[0]?.id
    if (!targetModel) {
      reply.code(400)
      return {
        ok: false,
        status: 0,
        statusText: 'No model configured for provider'
      }
    }

    const rawBody = request.body
    const maskSensitiveHeaders = (headers: Record<string, string> | null): Record<string, string> | null => {
      if (!headers) return null
      const masked: Record<string, string> = {}
      for (const [key, value] of Object.entries(headers)) {
        const lower = key.toLowerCase()
        if (lower.includes('authorization') || lower.includes('api-key')) {
          masked[key] = '<redacted>'
        } else {
          masked[key] = value
        }
      }
      return masked
    }

    const providedHeaders = (() => {
      if (!rawBody || typeof rawBody !== 'object') return null
      const candidate = (rawBody as { headers?: Record<string, unknown> }).headers
      if (!candidate || typeof candidate !== 'object') return null
      const normalized: Record<string, string> = {}
      for (const [key, value] of Object.entries(candidate)) {
        if (typeof value !== 'string') continue
        const trimmedKey = key.trim()
        if (!trimmedKey) continue
        normalized[trimmedKey.toLowerCase()] = value
      }
      return Object.keys(normalized).length > 0 ? normalized : null
    })()
    const providedQuery = (() => {
      if (!rawBody || typeof rawBody !== 'object') return null
      const raw = (rawBody as { query?: unknown }).query
      if (typeof raw === 'string') {
        const trimmed = raw.trim()
        return trimmed.length > 0 ? trimmed : null
      }
      return null
    })()

    const testPayload = normalizeClaudePayload({
      model: targetModel,
      stream: false,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '你好，这是一次连接测试。请简短回应以确认服务可用。'
            }
          ]
        }
      ]
    })

    const providerBody = provider.type === 'anthropic'
      ? {
          model: targetModel,
          stream: false,
          max_tokens: 256,
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'You are a connection diagnostic assistant.' },
                { type: 'text', text: '你好，这是一次连接测试。请简短回应以确认服务可用。' }
              ]
            }
          ]
        }
      : buildProviderBody(testPayload, {
          maxTokens: 256,
          temperature: 0,
          toolChoice: undefined,
          overrideTools: undefined
        })

    const connector = getConnector(provider.id)

    try {
      const upstream = await connector.send({
        model: targetModel,
        body: providerBody,
        stream: false,
        headers: providedHeaders ?? undefined,
        query: providedQuery ?? undefined
      })

      const duration = Date.now() - startedAt

      if (upstream.status >= 400) {
        const errorText = upstream.body ? await new Response(upstream.body).text() : ''
        const credentialRestricted = errorText.includes('only authorized for use with Claude Code')
        let requestBodyPreview: string
        try {
          requestBodyPreview = JSON.stringify(providerBody).slice(0, 1000)
        } catch {
          requestBodyPreview = '[unserializable body]'
        }
        request.log.warn(
          {
            event: 'provider.test.failure',
            provider: provider.id,
            status: upstream.status,
            statusText: errorText || 'Upstream error',
            headers: maskSensitiveHeaders(providedHeaders),
            query: providedQuery ?? null,
            durationMs: duration,
            model: targetModel,
            requestBody: requestBodyPreview
          },
          'provider test request failed'
        )
        return {
          ok: false,
          status: upstream.status,
          statusText: credentialRestricted
            ? '测试请求被拒绝：该凭证仅授权在 Claude Code 内使用。请直接在 IDE 中发起一次对话确认真实连通性。'
            : errorText || 'Upstream error',
          durationMs: duration
        }
      }

      const raw = upstream.body ? await new Response(upstream.body).text() : ''
      let parsed: any = null
      try {
        parsed = raw ? JSON.parse(raw) : null
      } catch {
        const fallbackSample = raw?.trim() ?? ''
        request.log.warn(
          {
            event: 'provider.test.invalid_json',
            provider: provider.id,
            status: upstream.status,
            headers: maskSensitiveHeaders(providedHeaders),
            query: providedQuery ?? null,
            durationMs: duration,
            model: targetModel,
            sample: fallbackSample ? fallbackSample.slice(0, 500) : ''
          },
          'provider test response not valid JSON'
        )
        if (provider.type && provider.type !== 'anthropic') {
          return {
            ok: fallbackSample.length > 0,
            status: upstream.status,
            statusText: fallbackSample ? 'OK (text response)' : 'Empty response',
            durationMs: duration,
            sample: fallbackSample ? fallbackSample.slice(0, 200) : null
          }
        }
        return {
          ok: false,
          status: upstream.status,
          statusText: 'Invalid JSON response',
          durationMs: duration
        }
      }

      let sample = ''
      if (provider.type === 'anthropic') {
        const contentBlocks = Array.isArray(parsed?.content) ? parsed.content : []
        const textBlocks = contentBlocks
          .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
          .map((block: any) => block.text)
        sample = textBlocks.join('\n')
      } else {
        const choice = Array.isArray(parsed?.choices) ? parsed.choices[0] : null
        if (choice) {
          if (Array.isArray(choice.message?.content)) {
            sample = choice.message.content.join('\n')
          } else {
            sample = choice.message?.content ?? choice.text ?? ''
          }
        }
      }

      sample = typeof sample === 'string' ? sample.trim() : ''

      return {
        ok: Boolean(sample),
        status: upstream.status,
        statusText: sample ? 'OK' : 'Empty response',
        durationMs: duration,
        sample: sample ? sample.slice(0, 200) : null
      }
    } catch (error) {
      reply.code(502)
      return {
        ok: false,
        status: 0,
        statusText: error instanceof Error ? error.message : 'Network error',
        durationMs: Date.now() - startedAt
      }
    }
  })

  app.get('/api/logs', async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, unknown>
    const { limit, offset, filters } = buildLogOptions(query)
    const { items, total } = await queryLogs({ ...filters, limit, offset })
    reply.header('x-total-count', String(total))
    return { total, items: items.map((item) => mapLogRecord(item)) }
  })

  app.post('/api/logs/export', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    const { limit, filters } = buildLogOptions(body, { defaultLimit: 1000, maxLimit: 5000, includeOffset: false })
    const records = await exportLogs({ ...filters, limit })
    const filtersForExport = Object.fromEntries(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== '')
    )

    const payload = {
      exportedAt: new Date().toISOString(),
      count: records.length,
      limit,
      filters: filtersForExport,
      records: records.map((record) => ({
        ...mapLogRecord(record, { includeKeyValue: true }),
        payload: record.payload
      }))
    }

    const filename = `cc-gw-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
    const zip = new JSZip()
    zip.file('logs.json', JSON.stringify(payload, null, 2))

    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    })

    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="${filename}"`)

    return reply.send(buffer)
  })

  app.get('/api/logs/:id', async (request, reply) => {
    const id = Number((request.params as any).id)
    if (!Number.isFinite(id)) {
      reply.code(400)
      return { error: 'Invalid id' }
    }
    const record = await getLogDetail(id)
    if (!record) {
      reply.code(404)
      return { error: 'Not found' }
    }
    const payload = await getLogPayload(id)
    const decryptedKey = await decryptApiKeyValue(record.api_key_value)
    return { ...mapLogRecord(record, { includeKeyValue: true, decryptedKey }), payload }
  })

  app.post('/api/logs/cleanup', async () => {
    const config = getConfig()
    const retentionDays = config.logRetentionDays ?? 30
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
    const deleted = await cleanupLogsBefore(cutoff)
    return { success: true, deleted }
  })

  app.post('/api/logs/clear', async () => {
    const { logs, metrics } = await clearAllLogs()
    return { success: true, deleted: logs, metricsCleared: metrics }
  })

  app.get('/api/db/info', async () => {
    const [pageStats, fileStats] = await Promise.all([getDatabasePageStats(), getDatabaseFileStats()])
    const memory = process.memoryUsage()
    const sizeBytes = pageStats.pageCount * pageStats.pageSize
    return {
      pageCount: pageStats.pageCount,
      pageSize: pageStats.pageSize,
      freelistPages: pageStats.freelistPages,
      sizeBytes,
      fileSizeBytes: fileStats.mainBytes,
      walSizeBytes: fileStats.walBytes,
      totalBytes: fileStats.totalBytes,
      memoryRssBytes: memory.rss,
      memoryHeapBytes: memory.heapUsed,
      memoryExternalBytes: memory.external ?? 0
    }
  })

  app.post('/api/db/compact', async () => {
    const result = await compactDatabase()
    const pageStats = await getDatabasePageStats()
    return {
      success: true,
      ...result,
      pageCount: pageStats.pageCount,
      freelistPages: pageStats.freelistPages,
      sizeBytes: pageStats.pageCount * pageStats.pageSize
    }
  })

  app.get('/api/stats/overview', async (request) => {
    const query: any = request.query ?? {}
    const endpoint = isEndpoint(query.endpoint) ? (query.endpoint as GatewayEndpoint) : undefined
    return getMetricsOverview(endpoint)
  })

  app.get('/api/stats/daily', async (request) => {
    const query: any = request.query ?? {}
    const daysRaw = Number(query.days ?? 7)
    const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(daysRaw, 30)) : 7
    const endpoint = isEndpoint(query.endpoint) ? (query.endpoint as GatewayEndpoint) : undefined
    return getDailyMetrics(days, endpoint)
  })

  app.get('/api/stats/model', async (request) => {
    const query: any = request.query ?? {}
    const daysRaw = Number(query.days ?? 7)
    const limitRaw = Number(query.limit ?? 10)
    const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(daysRaw, 90)) : 7
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 10
    const endpoint = isEndpoint(query.endpoint) ? (query.endpoint as GatewayEndpoint) : undefined
    return getModelUsageMetrics(days, limit, endpoint)
  })

  app.get('/api/stats/api-keys/overview', async (request) => {
    const query: any = request.query ?? {}
    const daysRaw = Number(query.days ?? 7)
    const rangeDays = Number.isFinite(daysRaw) ? Math.max(1, Math.min(daysRaw, 90)) : 7
    const endpoint = isEndpoint(query.endpoint) ? (query.endpoint as GatewayEndpoint) : undefined
    return getApiKeyOverviewMetrics(rangeDays, endpoint)
  })

  app.get('/api/stats/api-keys/usage', async (request) => {
    const query: any = request.query ?? {}
    const daysRaw = Number(query.days ?? 7)
    const limitRaw = Number(query.limit ?? 10)
    const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(daysRaw, 90)) : 7
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 10
    const endpoint = isEndpoint(query.endpoint) ? (query.endpoint as GatewayEndpoint) : undefined
    return getApiKeyUsageMetrics(days, limit, endpoint)
  })

  // API Keys Management
  app.get('/api/keys', async () => {
    return listApiKeys()
  })

  app.post('/api/keys', async (request, reply) => {
    const body = request.body as { name?: string; description?: string }
    if (!body?.name || typeof body.name !== 'string') {
      reply.code(400)
      return { error: 'Name is required' }
    }

    try {
      return await createApiKey(body.name, body.description, { ipAddress: request.ip })
    } catch (error) {
      reply.code(400)
      return { error: error instanceof Error ? error.message : 'Failed to create API key' }
    }
  })

  app.patch('/api/keys/:id', async (request, reply) => {
    const id = Number((request.params as any).id)
    if (!Number.isFinite(id)) {
      reply.code(400)
      return { error: 'Invalid id' }
    }

    const body = request.body as { enabled?: boolean }
    if (typeof body?.enabled !== 'boolean') {
      reply.code(400)
      return { error: 'enabled field is required' }
    }

    try {
      await setApiKeyEnabled(id, body.enabled, { ipAddress: request.ip })
      return { success: true }
    } catch (error) {
      if (error instanceof Error && error.message === 'API key not found') {
        reply.code(404)
      } else {
        reply.code(400)
      }
      return { error: error instanceof Error ? error.message : 'Failed to update API key' }
    }
  })

  app.delete('/api/keys/:id', async (request, reply) => {
    const id = Number((request.params as any).id)
    if (!Number.isFinite(id)) {
      reply.code(400)
      return { error: 'Invalid id' }
    }

    try {
      await deleteApiKey(id, { ipAddress: request.ip })
      return { success: true }
    } catch (error) {
      if (error instanceof Error && error.message === 'API key not found') {
        reply.code(404)
      } else if (error instanceof Error && error.message === 'Cannot delete wildcard key') {
        reply.code(403)
      } else {
        reply.code(400)
      }
      return { error: error instanceof Error ? error.message : 'Failed to delete API key' }
    }
  })
}
  const isEndpoint = (value: unknown): value is GatewayEndpoint =>
    value === 'anthropic' || value === 'openai'
