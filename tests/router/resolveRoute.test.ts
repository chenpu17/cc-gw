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
  defaults: {
    completion: 'deepseek:deepseek-chat',
    reasoning: 'kimi:kimi-think',
    background: 'background:bg-long',
    longContextThreshold: 1000
  },
  logRetentionDays: 30,
  modelRoutes: {}
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
    expect(() => resolveRoute({ payload })).toThrow(/未配置任何模型提供商/)
  })

  it('honors explicit provider:model request identifier', () => {
    const result = resolveRoute({ payload, requestedModel: 'kimi:kimi-think' })
    expect(result).toMatchObject({ providerId: 'kimi', modelId: 'kimi-think' })
  })

  it('applies configured model route mapping when present', () => {
    mockedGetConfig.mockReturnValueOnce({
      ...baseConfig,
      modelRoutes: {
        'claude-sonnet-4-5-20250929': 'kimi:kimi-think'
      }
    })
    const result = resolveRoute({ payload, requestedModel: 'claude-sonnet-4-5-20250929' })
    expect(result).toMatchObject({ providerId: 'kimi', modelId: 'kimi-think' })
  })

  it('falls back to defaults when mapped target is invalid', () => {
    mockedGetConfig.mockReturnValueOnce({
      ...baseConfig,
      modelRoutes: {
        'claude-sonnet-4-5-20250929': 'missing:unknown'
      }
    })
    const result = resolveRoute({ payload, requestedModel: 'claude-sonnet-4-5-20250929' })
    expect(result).toMatchObject({ providerId: 'deepseek', modelId: 'deepseek-chat' })
  })

  it('routes reasoning requests to reasoning default when thinking enabled', () => {
    const thinkingPayload = { ...payload, thinking: true }
    const result = resolveRoute({ payload: thinkingPayload })
    expect(result).toMatchObject({ providerId: 'kimi', modelId: 'kimi-think' })
  })

  it('falls back to background provider when token estimate exceeds threshold', () => {
    mockedEstimateTokens.mockReturnValueOnce(5000)
    const result = resolveRoute({ payload, requestedModel: undefined })
    expect(result).toMatchObject({ providerId: 'background', modelId: 'bg-long' })
  })

  it('uses completion default when no other strategy applies', () => {
    const result = resolveRoute({ payload })
    expect(result).toMatchObject({ providerId: 'deepseek', modelId: 'deepseek-chat' })
  })

  it('falls back to first provider model when defaults missing', () => {
    mockedGetConfig.mockReturnValueOnce({
      ...baseConfig,
      defaults: {
        completion: null,
        reasoning: null,
        background: null,
        longContextThreshold: 1000
      }
    })
    const result = resolveRoute({ payload })
    expect(result).toMatchObject({ providerId: 'deepseek', modelId: 'deepseek-chat' })
  })
})
