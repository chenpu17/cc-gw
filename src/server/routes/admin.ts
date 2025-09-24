import type { FastifyInstance } from 'fastify'
import { fetch } from 'undici'
import { CONFIG_PATH, getConfig, updateConfig } from '../config/manager.js'
import type { GatewayConfig } from '../config/types.js'
import {
  getLogDetail,
  getLogPayload,
  cleanupLogsBefore,
  getMetricsOverview,
  getDailyMetrics,
  getModelUsageMetrics,
  queryLogs
} from '../logging/queries.js'
import { getDb } from '../storage/index.js'

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/status', async () => {
    const config = getConfig()
    return {
      port: config.port,
      host: config.host,
      providers: config.providers.length
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

  app.post('/api/providers/:id/test', async (request, reply) => {
    const id = String((request.params as Record<string, string>).id)
    const config = getConfig()
    const provider = config.providers.find((item) => item.id === id)
    if (!provider) {
      reply.code(404)
      return { error: 'Provider not found' }
    }

    const baseUrl = provider.baseUrl.replace(/\/$/, '')
    const targetUrl = `${baseUrl}/models`
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...provider.extraHeaders
    }
    if (provider.type === 'anthropic') {
      if (provider.apiKey) {
        headers['x-api-key'] = provider.apiKey
      }
      headers['anthropic-version'] = headers['anthropic-version'] ?? '2023-06-01'
    } else if (provider.apiKey) {
      headers.Authorization = `Bearer ${provider.apiKey}`
    }

    try {
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers
      })
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText
      }
    } catch (error) {
      reply.code(502)
      return {
        ok: false,
        status: 0,
        statusText: error instanceof Error ? error.message : 'Network error'
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

    const parseTime = (value: string | undefined) => {
      if (!value) return undefined
      const numeric = Number(value)
      if (Number.isFinite(numeric)) return numeric
      const parsed = Date.parse(value)
      return Number.isFinite(parsed) ? parsed : undefined
    }

    const from = parseTime(query.from)
    const to = parseTime(query.to)

    const { items, total } = queryLogs({ limit, offset, provider, model, status, from, to })
    reply.header('x-total-count', String(total))
    return { total, items }
  })

  app.get('/api/logs/:id', async (request, reply) => {
    const id = Number((request.params as any).id)
    if (!Number.isFinite(id)) {
      reply.code(400)
      return { error: 'Invalid id' }
    }
    const record = getLogDetail(id)
    if (!record) {
      reply.code(404)
      return { error: 'Not found' }
    }
    const payload = getLogPayload(id)
    return { ...record, payload }
  })

  app.post('/api/logs/cleanup', async (request) => {
    const config = getConfig()
    const retentionDays = config.logRetentionDays ?? 30
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
    const deleted = cleanupLogsBefore(cutoff)
    return { success: true, deleted }
  })

  app.get('/api/db/info', async () => {
    const db = getDb()
    const pageCount = db.pragma('page_count', { simple: true }) as number
    const pageSize = db.pragma('page_size', { simple: true }) as number
    return {
      pageCount,
      pageSize,
      sizeBytes: pageCount * pageSize
    }
  })

  app.get('/api/stats/overview', async () => {
    return getMetricsOverview()
  })

  app.get('/api/stats/daily', async (request) => {
    const query: any = request.query ?? {}
    const daysRaw = Number(query.days ?? 7)
    const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(daysRaw, 30)) : 7
    return getDailyMetrics(days)
  })

  app.get('/api/stats/model', async (request) => {
    const query: any = request.query ?? {}
    const daysRaw = Number(query.days ?? 7)
    const limitRaw = Number(query.limit ?? 10)
    const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(daysRaw, 90)) : 7
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 10
    return getModelUsageMetrics(days, limit)
  })
}
