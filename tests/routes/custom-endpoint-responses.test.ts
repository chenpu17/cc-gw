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
          if (request.stream) {
            const streamPayload = [
              'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
              'data: {"type":"response.completed","response":{"usage":{"input_tokens":11,"output_tokens":7,"input_tokens_details":{"cached_tokens":3}}}}\n\n',
              'data: [DONE]\n\n'
            ].join('')
            const body = new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode(streamPayload))
                controller.close()
              }
            })
            return {
              status: 200,
              headers: new Headers({ 'content-type': 'text/event-stream' }),
              body
            }
          }
          if (request.body?.force_no_usage) {
            const responsePayload = {
              id: 'resp-no-usage',
              response: { body: { content: [{ type: 'output_text', text: 'estimated text' }] } }
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
          }
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
const customEndpointModule = await import('../../src/server/routes/custom-endpoint.ts')
const { registerCustomEndpoint, clearRegisteredRoutes } = customEndpointModule
const { getConfig } = await import('../../src/server/config/manager.ts')
const { resolveApiKey } = await import('../../src/server/api-keys/service.ts')
const { updateLogTokens, updateMetrics, upsertLogPayload } = await import('../../src/server/logging/logger.ts')
const { createOpenAIConnector } = await import('../../src/server/providers/openai.ts')

const mockedGetConfig = vi.mocked(getConfig)
const mockedResolveApiKey = vi.mocked(resolveApiKey)
const mockedUpdateLogTokens = vi.mocked(updateLogTokens)
const mockedUpdateMetrics = vi.mocked(updateMetrics)
const mockedUpsertLogPayload = vi.mocked(upsertLogPayload)
const mockedCreateOpenAIConnector = vi.mocked(createOpenAIConnector)

describe('custom openai /v1/responses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendCalls.length = 0
    mockedGetConfig.mockReturnValue(baseConfig)
    if (typeof clearRegisteredRoutes === 'function') {
      clearRegisteredRoutes()
    }
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

  it('does not overwrite existing max_output_tokens', async () => {
    const app = Fastify()
    await registerCustomEndpoint(app, customEndpoint)

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/custom/openai/v1/responses',
        headers: { authorization: 'Bearer test-key' },
        payload: {
          input: [{ type: 'message', role: 'user', content: 'hi' }],
          model: 'gpt-5.1',
          stream: false,
          max_tokens: 100,
          max_output_tokens: 999
        }
      })

      expect(response.statusCode).toBe(200)
      expect(sendCalls.length).toBe(1)
      // max_output_tokens was already set, should not be overwritten by max_tokens
      expect(sendCalls[0].max_output_tokens).toBe(999)
      expect(sendCalls[0]).not.toHaveProperty('max_tokens')
    } finally {
      await app.close()
    }
  })

  it('deletes thinking and reasoning boolean fields', async () => {
    const app = Fastify()
    await registerCustomEndpoint(app, customEndpoint)

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/custom/openai/v1/responses',
        headers: { authorization: 'Bearer test-key' },
        payload: {
          input: [{ type: 'message', role: 'user', content: 'hi' }],
          model: 'gpt-5.1',
          stream: false,
          thinking: true,
          reasoning: true
        }
      })

      expect(response.statusCode).toBe(200)
      expect(sendCalls.length).toBe(1)
      expect(sendCalls[0]).not.toHaveProperty('thinking')
      expect(sendCalls[0]).not.toHaveProperty('reasoning')
    } finally {
      await app.close()
    }
  })

  it('extracts usage from response.completed usage in streaming responses', async () => {
    const app = Fastify()
    await registerCustomEndpoint(app, customEndpoint)

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/custom/openai/v1/responses',
        headers: { authorization: 'Bearer test-key' },
        payload: {
          input: [{ type: 'message', role: 'user', content: 'hi' }],
          model: 'gpt-5.1',
          stream: true
        }
      })

      expect(response.statusCode).toBe(200)
      expect(mockedUpdateLogTokens).toHaveBeenCalled()
      expect(mockedUpdateMetrics).toHaveBeenCalled()

      const latestLogTokens = mockedUpdateLogTokens.mock.calls.at(-1)?.[1] as any
      expect(latestLogTokens.inputTokens).toBe(11)
      expect(latestLogTokens.outputTokens).toBe(7)
      expect(latestLogTokens.cachedTokens).toBe(3)
      expect(latestLogTokens.cacheReadTokens).toBe(3)
      expect(latestLogTokens.cacheCreationTokens).toBe(0)

      const latestMetrics = mockedUpdateMetrics.mock.calls.at(-1)?.[2] as any
      expect(latestMetrics.inputTokens).toBe(11)
      expect(latestMetrics.outputTokens).toBe(7)
      expect(latestMetrics.cachedTokens).toBe(3)
      expect(latestMetrics.cacheReadTokens).toBe(3)
      expect(latestMetrics.cacheCreationTokens).toBe(0)

      const responsePayload = mockedUpsertLogPayload.mock.calls
        .map(([, payload]) => payload as { response?: string | null })
        .find((payload) => typeof payload?.response === 'string')
      expect(responsePayload?.response).toBeTruthy()
      const summary = JSON.parse(responsePayload!.response as string)
      expect(summary.content).toBe('ok')
      expect(summary.model).toBe('gpt-5.1')
      expect(summary.object).toBeUndefined()
    } finally {
      await app.close()
    }
  })

  it('estimates output tokens from structured content when usage is missing', async () => {
    const app = Fastify()
    await registerCustomEndpoint(app, customEndpoint)

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/custom/openai/v1/responses',
        headers: { authorization: 'Bearer test-key' },
        payload: {
          input: [{ type: 'message', role: 'user', content: 'hi' }],
          model: 'gpt-5.1',
          stream: false,
          force_no_usage: true
        }
      })

      expect(response.statusCode).toBe(200)
      const latestLogTokens = mockedUpdateLogTokens.mock.calls.at(-1)?.[1] as any
      expect(Number.isFinite(latestLogTokens.outputTokens)).toBe(true)
      expect(latestLogTokens.outputTokens).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })
})
