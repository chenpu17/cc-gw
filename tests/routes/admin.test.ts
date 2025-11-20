import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayConfig } from '../../src/server/config/types.ts'

vi.mock('../../src/server/config/manager.ts', () => {
  const emptyDefaults = {
    completion: null,
    reasoning: null,
    background: null,
    longContextThreshold: 60000
  }

  const defaultConfig: GatewayConfig = {
    port: 4100,
    host: '127.0.0.1',
    providers: [],
    defaults: { ...emptyDefaults },
    logRetentionDays: 30,
    modelRoutes: {},
    endpointRouting: {
      anthropic: {
        defaults: { ...emptyDefaults },
        modelRoutes: {}
      },
      openai: {
        defaults: { ...emptyDefaults },
        modelRoutes: {}
      }
    },
    storeRequestPayloads: true,
    storeResponsePayloads: true,
    logLevel: 'info',
    requestLogging: true,
    responseLogging: true
  }
  return {
    getConfig: vi.fn(() => defaultConfig),
    updateConfig: vi.fn(),
    onConfigChange: vi.fn(),
    CONFIG_PATH: '/tmp/config.json'
  }
})

vi.mock('../../src/server/logging/queries.ts', () => ({
  queryLogs: vi.fn(),
  getLogDetail: vi.fn(),
  getLogPayload: vi.fn(),
  cleanupLogsBefore: vi.fn(),
  clearAllLogs: vi.fn(),
  getMetricsOverview: vi.fn(),
  getDailyMetrics: vi.fn(),
  getModelUsageMetrics: vi.fn()
}))

vi.mock('../../src/server/storage/index.ts', () => ({
  getOne: vi.fn(async (sql: string) => {
    if (sql === 'PRAGMA page_count') {
      return { page_count: 0 }
    }
    if (sql === 'PRAGMA page_size') {
      return { page_size: 0 }
    }
    return undefined
  })
}))

const { default: Fastify } = await import('fastify')
const { registerAdminRoutes } = await import('../../src/server/routes/admin.ts')
const { getConfig } = await import('../../src/server/config/manager.ts')
const { queryLogs, cleanupLogsBefore, clearAllLogs } = await import('../../src/server/logging/queries.ts')

const mockedGetConfig = vi.mocked(getConfig)
const mockedQueryLogs = vi.mocked(queryLogs)
const mockedCleanupLogs = vi.mocked(cleanupLogsBefore)
const mockedClearAll = vi.mocked(clearAllLogs)

const baseDefaults = {
  completion: 'deepseek:deepseek-chat',
  reasoning: null,
  background: null,
  longContextThreshold: 60000
}

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
  defaults: { ...baseDefaults },
  endpointRouting: {
    anthropic: {
      defaults: { ...baseDefaults },
      modelRoutes: {}
    },
    openai: {
      defaults: { ...baseDefaults },
      modelRoutes: {}
    }
  },
  logRetentionDays: 30,
  requestLogging: true,
  responseLogging: true
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
    mockedQueryLogs.mockResolvedValue({ total: 0, items: [] })
    mockedCleanupLogs.mockResolvedValue(0)
    mockedClearAll.mockResolvedValue({ logs: 0, metrics: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('normalizes query parameters for /api/logs and sets headers', async () => {
    mockedQueryLogs.mockResolvedValueOnce({ total: 42, items: [{ id: 1, stream: 1 }] })

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
        to: Date.parse('2024-01-01'),
        apiKeyIds: undefined,
        endpoint: undefined
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers['x-total-count']).toBe('42')
      expect(response.json()).toEqual({ total: 42, items: [{ id: 1, stream: true, api_key_value_available: false }] })
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
    mockedCleanupLogs.mockResolvedValueOnce(3)

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

  it('clears all logs and metrics', async () => {
    mockedClearAll.mockResolvedValueOnce({ logs: 7, metrics: 4 })

    const app = await createApp()
    try {
      const response = await app.inject({ method: 'POST', url: '/api/logs/clear' })

      expect(mockedClearAll).toHaveBeenCalledTimes(1)
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ success: true, deleted: 7, metricsCleared: 4 })
    } finally {
      await app.close()
    }
  })
})
