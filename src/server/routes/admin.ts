import type { FastifyInstance } from 'fastify'
import { normalizeClaudePayload } from '../protocol/normalize.js'
import { buildProviderBody, buildAnthropicBody } from '../protocol/toProvider.js'
import { getConnector } from '../providers/registry.js'
import { CONFIG_PATH, getConfig, updateConfig } from '../config/manager.js'
import type { GatewayConfig } from '../config/types.js'
import {
  getLogDetail,
  getLogPayload,
  cleanupLogsBefore,
  clearAllLogs,
  getMetricsOverview,
  getDailyMetrics,
  getModelUsageMetrics,
  queryLogs
} from '../logging/queries.js'
import { getOne } from '../storage/index.js'
import { getActiveRequestCount } from '../metrics/activity.js'

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {

  const mapLogRecord = (record: any) => ({
    ...record,
    stream: Boolean(record?.stream)
  })
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
          maxTokens: provider.models?.find((m) => m.id === targetModel)?.maxTokens ?? 256,
          temperature: 0,
          toolChoice: undefined,
          overrideTools: undefined
        })
      : buildProviderBody(testPayload, {
          maxTokens: provider.models?.find((m) => m.id === targetModel)?.maxTokens ?? 256,
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

    const parseTime = (value: string | undefined) => {
      if (!value) return undefined
      const numeric = Number(value)
      if (Number.isFinite(numeric)) return numeric
      const parsed = Date.parse(value)
      return Number.isFinite(parsed) ? parsed : undefined
    }

    const from = parseTime(query.from)
    const to = parseTime(query.to)

    const { items, total } = await queryLogs({ limit, offset, provider, model, status, from, to })
    reply.header('x-total-count', String(total))
    return { total, items: items.map(mapLogRecord) }
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
    return { ...mapLogRecord(record), payload }
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
