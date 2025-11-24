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
const { registerCustomEndpoint, clearRegisteredRoutes } = await import('../../src/server/routes/custom-endpoint.ts')
const { getConfig } = await import('../../src/server/config/manager.ts')
const { resolveApiKey } = await import('../../src/server/api-keys/service.ts')

const mockedGetConfig = vi.mocked(getConfig)
const mockedResolveApiKey = vi.mocked(resolveApiKey)

describe('custom openai endpoint /v1/models', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetConfig.mockReturnValue(baseConfig)
    // 清理全局路由注册状态
    if (typeof clearRegisteredRoutes === 'function') {
      clearRegisteredRoutes()
    }
  })

  it('returns models from routing configuration', async () => {
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

      // gpt-4o 应该从 defaults.completion 中提取到
      const gpt4o = body.data.find((item: any) => item.id === 'gpt-4o')
      expect(gpt4o).toBeTruthy()

      // 新的数据结构：metadata.routes 包含路由信息
      expect(gpt4o.metadata.routes).toBeTruthy()
      expect(Array.isArray(gpt4o.metadata.routes)).toBe(true)
      expect(gpt4o.metadata.routes.length).toBeGreaterThan(0)

      // 验证路由信息格式 - gpt-4o 可能从多个端点配置，检查是否包含 custom endpoint
      const hasCustomRoute = gpt4o.metadata.routes.some(
        (r: any) => r.endpoint === 'custom:openai-custom'
      )
      expect(hasCustomRoute).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('returns models from modelRoutes configuration', async () => {
    // 创建配置了 modelRoutes 的端点
    const configWithRoutes: GatewayConfig = {
      ...baseConfig,
      endpointRouting: {
        ...baseConfig.endpointRouting,
        anthropic: {
          defaults: { ...defaults, completion: null, reasoning: null, background: null } as any,
          modelRoutes: {}
        },
        openai: {
          defaults: { ...defaults, completion: null, reasoning: null, background: null } as any,
          modelRoutes: {}
        }
      },
      customEndpoints: [
        {
          id: 'openai-custom',
          label: 'Custom OpenAI',
          paths: [{ path: '/custom/openai', protocol: 'openai-auto' as const }],
          enabled: true,
          routing: {
            defaults: { ...defaults, completion: null, reasoning: null, background: null } as any,
            modelRoutes: {
              'my-model': 'provider-a:gpt-4o',
              'alias-model': 'provider-b:gpt-4o'
            }
          }
        }
      ]
    }

    mockedGetConfig.mockReturnValue(configWithRoutes)
    clearRegisteredRoutes()

    const app = Fastify()
    await registerCustomEndpoint(app, configWithRoutes.customEndpoints![0])

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/custom/openai/v1/models',
        headers: {
          authorization: 'Bearer test-key'
        }
      })

      expect(response.statusCode).toBe(200)

      const body = response.json()

      // 应该返回来源模型（modelRoutes 的 key），而不是目标模型
      const myModel = body.data.find((item: any) => item.id === 'my-model')
      expect(myModel).toBeTruthy()
      expect(myModel.metadata.routes[0].target).toBe('provider-a:gpt-4o')

      const aliasModel = body.data.find((item: any) => item.id === 'alias-model')
      expect(aliasModel).toBeTruthy()
      expect(aliasModel.metadata.routes[0].target).toBe('provider-b:gpt-4o')

      // 模型列表只包含路由配置中的来源模型
      const models = body.data.map((item: any) => item.id)
      expect(models).toContain('my-model')
      expect(models).toContain('alias-model')
      // gpt-4o 不应该出现（因为所有 defaults 都设为 null）
      expect(models).not.toContain('gpt-4o')
    } finally {
      await app.close()
    }
  })
})
