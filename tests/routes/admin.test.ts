import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayConfig } from '../../src/server/config/types.ts'

vi.mock('../../src/server/config/manager.ts', () => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  CONFIG_PATH: '/tmp/config.json'
}))

vi.mock('../../src/server/logging/queries.ts', () => ({
  queryLogs: vi.fn(),
  getLogDetail: vi.fn(),
  getLogPayload: vi.fn(),
  cleanupLogsBefore: vi.fn(),
  getMetricsOverview: vi.fn(),
  getDailyMetrics: vi.fn(),
  getModelUsageMetrics: vi.fn()
}))

vi.mock('../../src/server/storage/index.ts', () => ({
  getDb: vi.fn(() => ({ pragma: vi.fn(() => 0) }))
}))

const { default: Fastify } = await import('fastify')
const { registerAdminRoutes } = await import('../../src/server/routes/admin.ts')
const { getConfig } = await import('../../src/server/config/manager.ts')
const { queryLogs, cleanupLogsBefore } = await import('../../src/server/logging/queries.ts')

const mockedGetConfig = vi.mocked(getConfig)
const mockedQueryLogs = vi.mocked(queryLogs)
const mockedCleanupLogs = vi.mocked(cleanupLogsBefore)

const baseConfig: GatewayConfig = {
  port: 4100,
  host: '127.0.0.1',
  providers: [
    {
      id: 'deepseek',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/',
      apiKey: 'secret',
      defaultModel: 'deepseek-chat'
    }
  ],
  defaults: {
    completion: 'deepseek:deepseek-chat',
    reasoning: null,
    background: null,
    longContextThreshold: 60000
  },
  logRetentionDays: 30
}

async function createApp() {
  const app = Fastify()
  await registerAdminRoutes(app)
  return app
}

describe('admin routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetConfig.mockReturnValue(baseConfig)
    mockedQueryLogs.mockReturnValue({ total: 0, items: [] })
    mockedCleanupLogs.mockReturnValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('normalizes query parameters for /api/logs and sets headers', async () => {
    mockedQueryLogs.mockReturnValueOnce({ total: 42, items: [{ id: 1 }] })

    const app = await createApp()
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/logs?limit=500&offset=-10&provider=deepseek&model=&status=success&from=abc&to=2024-01-01'
      })

      expect(mockedQueryLogs).toHaveBeenCalledWith({
        limit: 200,
        offset: 0,
        provider: 'deepseek',
        model: undefined,
        status: 'success',
        from: undefined,
        to: Date.parse('2024-01-01')
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers['x-total-count']).toBe('42')
      expect(response.json()).toEqual({ total: 42, items: [{ id: 1 }] })
    } finally {
      await app.close()
    }
  })

  it('returns 404 when provider is not found for connectivity test', async () => {
    mockedGetConfig.mockReturnValueOnce({
      ...baseConfig,
      providers: []
    })

    const app = await createApp()
    try {
      const response = await app.inject({ method: 'POST', url: '/api/providers/unknown/test' })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'Provider not found' })
    } finally {
      await app.close()
    }
  })

  it('computes cleanup cutoff based on retention days', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-05-01T00:00:00Z'))
    mockedCleanupLogs.mockReturnValueOnce(3)

    const app = await createApp()
    try {
      const response = await app.inject({ method: 'POST', url: '/api/logs/cleanup' })

      const expectedCutoff = new Date('2024-05-01T00:00:00Z').getTime() - 30 * 24 * 60 * 60 * 1000
      expect(mockedCleanupLogs).toHaveBeenCalledWith(expectedCutoff)
      expect(response.json()).toEqual({ success: true, deleted: 3 })
    } finally {
      await app.close()
    }
  })
})
