import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayConfig } from '../../src/server/config/types.ts'

const defaults = {
  completion: 'gpt-5.1',
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
      defaultModel: 'gpt-5.1',
      models: [{ id: 'gpt-5.1' }],
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
            id: 'resp-1',
            response: { body: { content: [{ type: 'output_text', text: 'ok' }] } },
            usage: { prompt_tokens: 1, completion_tokens: 1 }
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
const { registerCustomEndpoint } = await import('../../src/server/routes/custom-endpoint.ts')
const { getConfig } = await import('../../src/server/config/manager.ts')
const { resolveApiKey } = await import('../../src/server/api-keys/service.ts')
const { createOpenAIConnector } = await import('../../src/server/providers/openai.ts')

const mockedGetConfig = vi.mocked(getConfig)
const mockedResolveApiKey = vi.mocked(resolveApiKey)
const mockedCreateOpenAIConnector = vi.mocked(createOpenAIConnector)

describe('custom openai /v1/responses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendCalls.length = 0
    mockedGetConfig.mockReturnValue(baseConfig)
  })

  it('forwards raw input for OpenAI responses payload', async () => {
    const app = Fastify()
    await registerCustomEndpoint(app, customEndpoint)

    const requestBody = {
      input: [
        {
          type: 'message',
          role: 'user',
          content: 'hello'
        }
      ],
      model: 'gpt-5.1',
      stream: false,
      max_tokens: 456,
      tools: [
        {
          type: 'function',
          name: 'Calculator',
          parameters: {
            type: 'object',
            properties: {
              input: { type: 'string' }
            }
          }
        }
      ]
    }

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/custom/openai/v1/responses',
        headers: {
          authorization: 'Bearer test-key'
        },
        payload: requestBody
      })

      expect(response.statusCode).toBe(200)
      expect(mockedResolveApiKey).toHaveBeenCalled()
      expect(mockedCreateOpenAIConnector).toHaveBeenCalled()
      expect(sendCalls.length).toBe(1)
      expect(sendCalls[0].input).toEqual(requestBody.input)
      expect(sendCalls[0].max_output_tokens).toBe(requestBody.max_tokens)
      expect(sendCalls[0]).not.toHaveProperty('max_tokens')
    } finally {
      await app.close()
    }
  })
})
