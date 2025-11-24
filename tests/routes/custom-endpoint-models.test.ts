import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayConfig } from '../../src/server/config/types.ts'

const defaults = {
  completion: 'gpt-4o',
  reasoning: null,
  background: null,
  longContextThreshold: 60000
}

const customEndpoint = {
  id: 'openai-custom',
  label: 'Custom OpenAI',
  paths: [{ path: '/custom/openai', protocol: 'openai-auto' as const }],
  enabled: true,
  routing: {
    defaults,
    modelRoutes: {}
  }
}

const baseConfig: GatewayConfig = {
  port: 4100,
  host: '127.0.0.1',
  providers: [
    {
      id: 'provider-a',
      label: 'Provider A',
      baseUrl: 'https://a.example.com',
      apiKey: 'secret-a',
      defaultModel: 'gpt-4o',
      models: [{ id: 'gpt-4o' }, { id: 'gpt-4.1' }]
    },
    {
      id: 'provider-b',
      label: 'Provider B',
      baseUrl: 'https://b.example.com',
      apiKey: 'secret-b',
      defaultModel: 'gpt-4o',
      models: [{ id: 'gpt-4o' }]
    }
  ],
  defaults,
  endpointRouting: {
    anthropic: {
      defaults,
      modelRoutes: {}
    },
    openai: {
      defaults,
      modelRoutes: {}
    }
  },
  customEndpoints: [customEndpoint]
}

vi.mock('../../src/server/config/manager.ts', () => {
  return {
    getConfig: vi.fn(() => baseConfig),
    onConfigChange: vi.fn()
  }
})

vi.mock('../../src/server/api-keys/service.ts', () => {
  class ApiKeyError extends Error {}
  return {
    ApiKeyError,
    resolveApiKey: vi.fn(async () => ({})),
    recordApiKeyUsage: vi.fn()
  }
})

const { default: Fastify } = await import('fastify')
const { registerCustomEndpoint } = await import('../../src/server/routes/custom-endpoint.ts')
const { getConfig } = await import('../../src/server/config/manager.ts')
const { resolveApiKey } = await import('../../src/server/api-keys/service.ts')

const mockedGetConfig = vi.mocked(getConfig)
const mockedResolveApiKey = vi.mocked(resolveApiKey)

describe('custom openai endpoint /v1/models', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetConfig.mockReturnValue(baseConfig)
  })

  it('returns merged model list without duplicate provider entries', async () => {
    const app = Fastify()
    await registerCustomEndpoint(app, customEndpoint)

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/custom/openai/v1/models',
        headers: {
          authorization: 'Bearer test-key'
        }
      })

      expect(response.statusCode).toBe(200)
      expect(mockedResolveApiKey).toHaveBeenCalled()

      const body = response.json()
      expect(body.object).toBe('list')

      const gpt4o = body.data.find((item: any) => item.id === 'gpt-4o')
      expect(gpt4o).toBeTruthy()
      const providerIds = gpt4o.metadata.providers.map((p: any) => p.id)
      expect(new Set(providerIds).size).toBe(2)
      const providerACount = gpt4o.metadata.providers.filter((p: any) => p.id === 'provider-a').length
      expect(providerACount).toBe(1)
      const providerADefault = gpt4o.metadata.providers.find((p: any) => p.id === 'provider-a')
      expect(providerADefault.isDefault).toBe(true)
    } finally {
      await app.close()
    }
  })
})
