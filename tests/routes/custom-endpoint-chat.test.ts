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
      baseUrl: 'https://api.openai.test',
      apiKey: 'secret',
      defaultModel: 'gpt-4o',
      models: [{ id: 'gpt-4o' }],
      type: 'openai'
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

vi.mock('../../src/server/logging/logger.ts', () => {
  return {
    recordLog: vi.fn(async () => 1),
    finalizeLog: vi.fn(),
    updateLogTokens: vi.fn(),
    updateMetrics: vi.fn(),
    upsertLogPayload: vi.fn()
  }
})

vi.mock('../../src/server/security/encryption.ts', () => {
  return {
    encryptSecret: vi.fn(() => 'encrypted')
  }
})

const sendCalls: any[] = []

vi.mock('../../src/server/providers/openai.ts', async () => {
  const { ReadableStream } = await import('node:stream/web')
  const encoder = new TextEncoder()
  return {
    createOpenAIConnector: vi.fn(() => {
      return {
        id: 'provider-a',
        send: vi.fn(async (request: any) => {
          sendCalls.push(request.body)
          const responsePayload = {
            id: 'chatcmpl-1',
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'ok' },
                finish_reason: 'stop'
              }
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 }
          }
          const body = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(JSON.stringify(responsePayload)))
              controller.close()
            }
          })
          return {
            status: 200,
            headers: new Headers(),
            body
          }
        })
      }
    })
  }
})

const { default: Fastify } = await import('fastify')
const customEndpointModule = await import('../../src/server/routes/custom-endpoint.ts')
const { registerCustomEndpoint, clearRegisteredRoutes } = customEndpointModule
const { getConfig } = await import('../../src/server/config/manager.ts')
const { resolveApiKey } = await import('../../src/server/api-keys/service.ts')
const { createOpenAIConnector } = await import('../../src/server/providers/openai.ts')

const mockedGetConfig = vi.mocked(getConfig)
const mockedResolveApiKey = vi.mocked(resolveApiKey)
const mockedCreateOpenAIConnector = vi.mocked(createOpenAIConnector)

describe('custom openai /v1/chat/completions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendCalls.length = 0
    mockedGetConfig.mockReturnValue(baseConfig)
    // 清理全局路由注册状态
    if (typeof clearRegisteredRoutes === 'function') {
      clearRegisteredRoutes()
    }
  })

  it('forwards raw payload for OpenAI chat completions', async () => {
    const app = Fastify()
    await registerCustomEndpoint(app, customEndpoint)

    const requestBody = {
      messages: [
        {
          role: 'user',
          content: 'hello'
        }
      ],
      model: 'gpt-4o',
      stream: false,
      max_tokens: 321,
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' }
              }
            }
          }
        }
      ],
      tool_choice: 'auto',
      response_format: { type: 'json_object' }
    }

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/custom/openai/v1/chat/completions',
        headers: {
          authorization: 'Bearer test-key'
        },
        payload: requestBody
      })

      expect(response.statusCode).toBe(200)
      expect(mockedResolveApiKey).toHaveBeenCalled()
      expect(mockedCreateOpenAIConnector).toHaveBeenCalled()
      expect(sendCalls.length).toBe(1)

      // 验证关键字段被正确转发
      expect(sendCalls[0].messages).toEqual(requestBody.messages)
      expect(sendCalls[0].max_tokens).toBe(requestBody.max_tokens)
      expect(sendCalls[0]).not.toHaveProperty('max_output_tokens')
      expect(sendCalls[0].tools).toEqual(requestBody.tools)
      expect(sendCalls[0].tool_choice).toBe('auto')
      expect(sendCalls[0].response_format).toEqual({ type: 'json_object' })
    } finally {
      await app.close()
    }
  })

  it('deletes thinking: true from provider body', async () => {
    const app = Fastify()
    try {
      await registerCustomEndpoint(app, customEndpoint)

      const response = await app.inject({
        method: 'POST',
        url: '/custom/openai/v1/chat/completions',
        headers: { authorization: 'Bearer test-key' },
        payload: {
          messages: [{ role: 'user', content: 'hi' }],
          model: 'gpt-4o',
          stream: false,
          thinking: true
        }
      })

      expect(response.statusCode).toBe(200)
      const lastCall = sendCalls[sendCalls.length - 1]
      expect(lastCall).not.toHaveProperty('thinking')
    } finally {
      await app.close()
    }
  })

  it('deletes reasoning: true from provider body', async () => {
    const app = Fastify()
    try {
      await registerCustomEndpoint(app, customEndpoint)

      const response = await app.inject({
        method: 'POST',
        url: '/custom/openai/v1/chat/completions',
        headers: { authorization: 'Bearer test-key' },
        payload: {
          messages: [{ role: 'user', content: 'hi' }],
          model: 'gpt-4o',
          stream: false,
          reasoning: true
        }
      })

      expect(response.statusCode).toBe(200)
      const lastCall = sendCalls[sendCalls.length - 1]
      expect(lastCall).not.toHaveProperty('reasoning')
    } finally {
      await app.close()
    }
  })

  it('removes undefined optional fields', async () => {
    const app = Fastify()

    try {
      await registerCustomEndpoint(app, customEndpoint)

      const requestBody = {
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4o'
        // tools, tool_choice, response_format 都未提供
      }

      const response = await app.inject({
        method: 'POST',
        url: '/custom/openai/v1/chat/completions',
        headers: {
          authorization: 'Bearer test-key'
        },
        payload: requestBody
      })

      if (response.statusCode !== 200) {
        console.error('Response:', response.statusCode, response.json())
      }

      expect(response.statusCode).toBe(200)
      expect(sendCalls.length).toBeGreaterThanOrEqual(1)

      // 验证 undefined 字段被删除（检查最后一次调用）
      const lastCall = sendCalls[sendCalls.length - 1]
      expect(lastCall).not.toHaveProperty('tools')
      expect(lastCall).not.toHaveProperty('tool_choice')
      expect(lastCall).not.toHaveProperty('response_format')
    } finally {
      await app.close()
    }
  })
})
