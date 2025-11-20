import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayConfig } from '../../src/server/config/types.ts'

vi.mock('../../src/server/config/manager.ts', () => {
  return {
    getConfig: vi.fn<[], GatewayConfig>(),
    updateConfig: vi.fn(),
    CONFIG_PATH: '/tmp/config.json'
  }
})

vi.mock('../../src/server/protocol/tokenizer.ts', () => {
  return {
    estimateTokens: vi.fn()
  }
})

import { resolveRoute } from '../../src/server/router/index.ts'
import { getConfig } from '../../src/server/config/manager.ts'
import { estimateTokens } from '../../src/server/protocol/tokenizer.ts'

const mockedGetConfig = vi.mocked(getConfig)
const mockedEstimateTokens = vi.mocked(estimateTokens)

const defaultDefaults = {
  completion: 'deepseek:deepseek-chat',
  reasoning: 'kimi:kimi-think',
  background: 'background:bg-long',
  longContextThreshold: 1000
}

const baseConfig: GatewayConfig = {
  port: 4100,
  host: '127.0.0.1',
  providers: [
    {
      id: 'deepseek',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'key',
      defaultModel: 'deepseek-chat',
      models: [
        { id: 'deepseek-chat' },
        { id: 'deepseek-think' }
      ]
    },
    {
      id: 'kimi',
      label: 'Kimi',
      baseUrl: 'https://api.kimi.moonshot.cn',
      defaultModel: 'kimi-lite',
      models: [
        { id: 'kimi-lite' },
        { id: 'kimi-think' }
      ]
    },
    {
      id: 'background',
      label: 'Background Provider',
      baseUrl: 'https://background.example.com',
      defaultModel: 'bg-long'
    }
  ],
  defaults: { ...defaultDefaults },
  logRetentionDays: 30,
  modelRoutes: {},
  endpointRouting: {
    anthropic: {
      defaults: { ...defaultDefaults },
      modelRoutes: {}
    },
    openai: {
      defaults: { ...defaultDefaults },
      modelRoutes: {}
    }
  }
}

const payload = {
  system: 'Test',
  messages: [
    { role: 'user', text: 'hello' }
  ],
  stream: false,
  thinking: false,
  tools: []
}

describe('resolveRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetConfig.mockReturnValue(baseConfig)
    mockedEstimateTokens.mockReturnValue(50)
  })

  it('throws when no providers configured', () => {
    mockedGetConfig.mockReturnValueOnce({ ...baseConfig, providers: [] })
    expect(() => resolveRoute({ payload, endpoint: 'anthropic' })).toThrow(/未配置任何模型提供商/)
  })

  it('honors explicit provider:model request identifier', () => {
    const result = resolveRoute({ payload, requestedModel: 'kimi:kimi-think', endpoint: 'anthropic' })
    expect(result).toMatchObject({ providerId: 'kimi', modelId: 'kimi-think' })
  })

  it('applies configured model route mapping when present', () => {
    mockedGetConfig.mockReturnValueOnce({
      ...baseConfig,
      endpointRouting: {
        ...baseConfig.endpointRouting,
        anthropic: {
          defaults: { ...baseConfig.endpointRouting!.anthropic!.defaults },
          modelRoutes: {
            'claude-sonnet-4-5-20250929': 'kimi:kimi-think'
          }
        }
      }
    })
    const result = resolveRoute({ payload, requestedModel: 'claude-sonnet-4-5-20250929', endpoint: 'anthropic' })
    expect(result).toMatchObject({ providerId: 'kimi', modelId: 'kimi-think' })
  })

  it('supports wildcard passthrough routes preserving requested model id', () => {
    mockedGetConfig.mockReturnValueOnce({
      ...baseConfig,
      endpointRouting: {
        ...baseConfig.endpointRouting,
        anthropic: {
          defaults: { ...baseConfig.endpointRouting!.anthropic!.defaults },
          modelRoutes: {
            'claude-*': 'kimi:*'
          }
        }
      }
    })
    const result = resolveRoute({
      payload,
      requestedModel: 'claude-3-5-sonnet-latest',
      endpoint: 'anthropic'
    })
    expect(result).toMatchObject({ providerId: 'kimi', modelId: 'claude-3-5-sonnet-latest' })
    expect(mockedEstimateTokens).toHaveBeenCalledWith(payload, 'claude-3-5-sonnet-latest')
  })

  it('falls back to global wildcard route when no specific mapping matches', () => {
    mockedGetConfig.mockReturnValueOnce({
      ...baseConfig,
      endpointRouting: {
        ...baseConfig.endpointRouting,
        anthropic: {
          defaults: { ...baseConfig.endpointRouting!.anthropic!.defaults },
          modelRoutes: {
            'claude-3-5-*': 'deepseek:deepseek-think',
            '*': 'kimi:*'
          }
        }
      }
    })
    const result = resolveRoute({
      payload,
      requestedModel: 'claude-unknown-next',
      endpoint: 'anthropic'
    })
    expect(result).toMatchObject({ providerId: 'kimi', modelId: 'claude-unknown-next' })
  })

  it('falls back to defaults when mapped target is invalid', () => {
    mockedGetConfig.mockReturnValueOnce({
      ...baseConfig,
      endpointRouting: {
        ...baseConfig.endpointRouting,
        anthropic: {
          defaults: { ...baseConfig.endpointRouting!.anthropic!.defaults },
          modelRoutes: {
            'claude-sonnet-4-5-20250929': 'missing:unknown'
          }
        }
      }
    })
    const result = resolveRoute({ payload, requestedModel: 'claude-sonnet-4-5-20250929', endpoint: 'anthropic' })
    expect(result).toMatchObject({ providerId: 'deepseek', modelId: 'deepseek-chat' })
  })

  it('routes reasoning requests to reasoning default when thinking enabled', () => {
    const thinkingPayload = { ...payload, thinking: true }
    const result = resolveRoute({ payload: thinkingPayload, endpoint: 'anthropic' })
    expect(result).toMatchObject({ providerId: 'kimi', modelId: 'kimi-think' })
  })

  it('falls back to background provider when token estimate exceeds threshold', () => {
    mockedEstimateTokens.mockReturnValueOnce(5000)
    const result = resolveRoute({ payload, requestedModel: undefined, endpoint: 'anthropic' })
    expect(result).toMatchObject({ providerId: 'background', modelId: 'bg-long' })
  })

  it('uses completion default when no other strategy applies', () => {
    const result = resolveRoute({ payload, endpoint: 'anthropic' })
    expect(result).toMatchObject({ providerId: 'deepseek', modelId: 'deepseek-chat' })
  })

  it('maps gpt-5 codex variants onto the configured codex route', () => {
    mockedGetConfig.mockReturnValueOnce({
      ...baseConfig,
      endpointRouting: {
        ...baseConfig.endpointRouting,
        openai: {
          defaults: { ...baseConfig.endpointRouting!.openai!.defaults },
          modelRoutes: {
            'gpt-5-codex': 'kimi:*'
          }
        }
      }
    })

    const result = resolveRoute({
      payload,
      endpoint: 'openai',
      requestedModel: 'gpt-5.1-codex-max'
    })

    expect(result).toMatchObject({ providerId: 'kimi', modelId: 'gpt-5.1-codex-max' })
  })

  it('falls back to first provider model when defaults missing', () => {
    const emptyDefaults = {
      completion: null,
      reasoning: null,
      background: null,
      longContextThreshold: 1000
    }
    mockedGetConfig.mockReturnValueOnce({
      ...baseConfig,
      defaults: { ...emptyDefaults },
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
      enableRoutingFallback: true
    })
    const result = resolveRoute({ payload, endpoint: 'anthropic' })
    expect(result).toMatchObject({ providerId: 'deepseek', modelId: 'deepseek-chat' })
  })
})
