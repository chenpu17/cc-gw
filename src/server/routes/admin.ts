import type { FastifyInstance } from 'fastify'
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
  queryLogs
} from '../logging/queries.js'
import { getOne } from '../storage/index.js'
import { getActiveRequestCount } from '../metrics/activity.js'
import {
  listApiKeys,
  createApiKey,
  setApiKeyEnabled,
  deleteApiKey,
  ensureWildcardMetadata,
  decryptApiKeyValue
} from '../api-keys/service.js'

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  try {
    await ensureWildcardMetadata()
  } catch (error) {
    app.log.warn({ error }, '[api-keys] failed to ensure wildcard metadata')
  }

  const mapLogRecord = (record: any, options?: { includeKeyValue?: boolean; decryptedKey?: string | null }) => {
    const base: any = {
      ...record,
      stream: Boolean(record?.stream)
    }

    if (options?.includeKeyValue) {
      base.api_key_value = options.decryptedKey ?? record?.api_key_value ?? null
    } else {
      delete base.api_key_value
    }

    return base
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
    return getConfig()
  })

  app.get('/api/config/info', async () => {
    const config = getConfig()
    return {
      config,
      path: CONFIG_PATH
    }
  })

  app.put('/api/config', async (request, reply) => {
    const body = request.body as GatewayConfig
    if (!body || typeof body.port !== 'number') {
      reply.code(400)
      return { error: 'Invalid config payload' }
    }
    updateConfig(body)
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
      ],
      system: 'You are a connection diagnostic assistant.'
    })

    const providerBody = provider.type === 'anthropic'
      ? buildAnthropicBody(testPayload, {
          maxTokens: 256,
          temperature: 0,
          toolChoice: undefined,
          overrideTools: undefined
        })
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
        stream: false
      })

      const duration = Date.now() - startedAt

      if (upstream.status >= 400) {
        const errorText = upstream.body ? await new Response(upstream.body).text() : ''
        return {
          ok: false,
          status: upstream.status,
          statusText: errorText || 'Upstream error',
          durationMs: duration
        }
      }

      const raw = upstream.body ? await new Response(upstream.body).text() : ''
      let parsed: any = null
      try {
        parsed = raw ? JSON.parse(raw) : null
      } catch {
        const fallbackSample = raw?.trim() ?? ''
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
    const query = (request.query ?? {}) as Record<string, string>
    const limitRaw = Number(query.limit ?? 50)
    const offsetRaw = Number(query.offset ?? 0)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0

    const provider = typeof query.provider === 'string' && query.provider.length > 0 ? query.provider : undefined
    const model = typeof query.model === 'string' && query.model.length > 0 ? query.model : undefined
    const statusParam = typeof query.status === 'string' ? query.status : undefined
    const status = statusParam === 'success' || statusParam === 'error' ? statusParam : undefined
    const endpoint = isEndpoint(query.endpoint) ? (query.endpoint as GatewayEndpoint) : undefined

    const parseTime = (value: string | undefined) => {
      if (!value) return undefined
      const numeric = Number(value)
      if (Number.isFinite(numeric)) return numeric
      const parsed = Date.parse(value)
      return Number.isFinite(parsed) ? parsed : undefined
    }

    const from = parseTime(query.from)
    const to = parseTime(query.to)

    const collectApiKeyIds = (value: unknown): number[] => {
      if (!value) return []
      if (Array.isArray(value)) {
        return value.flatMap((item) => collectApiKeyIds(item))
      }
      if (typeof value === 'string') {
        return value
          .split(',')
          .map((part) => Number(part.trim()))
          .filter((num) => Number.isFinite(num))
      }
      return []
    }

    const apiKeyIdsRaw = collectApiKeyIds(query.apiKeys ?? query.apiKeyIds ?? query.apiKey)
    const apiKeyIds = apiKeyIdsRaw.length > 0 ? Array.from(new Set(apiKeyIdsRaw)) : undefined

    const { items, total } = await queryLogs({ limit, offset, provider, model, status, from, to, apiKeyIds, endpoint })
    reply.header('x-total-count', String(total))
    return { total, items: items.map((item) => mapLogRecord(item)) }
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
    const pageCountRow = await getOne<{ page_count: number }>('PRAGMA page_count')
    const pageSizeRow = await getOne<{ page_size: number }>('PRAGMA page_size')
    const pageCount = pageCountRow?.page_count ?? 0
    const pageSize = pageSizeRow?.page_size ?? 0
    return {
      pageCount,
      pageSize,
      sizeBytes: pageCount * pageSize
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
