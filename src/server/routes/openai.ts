import type { FastifyInstance } from 'fastify'
import type { CustomEndpointConfig } from '../config/types.js'
import { ApiKeyError, resolveApiKey } from '../api-keys/service.js'
import { getConfig } from '../config/manager.js'
import { handleOpenAIChatProtocol, handleOpenAIResponsesProtocol } from './custom-endpoint.js'
import { buildModelsResponse } from './shared/models-handler.js'

function resolveHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === 'string' && item.trim().length > 0)
  }
  return undefined
}

function extractApiKeyFromRequest(request: any): string | undefined {
  let provided = resolveHeaderValue(request.headers?.authorization as any)
  if (provided && typeof provided === 'string' && provided.toLowerCase().startsWith('bearer ')) {
    provided = provided.slice(7)
  }
  if (!provided) {
    provided = resolveHeaderValue(request.headers?.['x-api-key'] as any)
  }
  return provided
}

export async function registerOpenAiRoutes(app: FastifyInstance<any, any, any, any, any>): Promise<void> {
  const systemEndpoint: CustomEndpointConfig = {
    id: 'openai',
    label: 'openai',
    enabled: true
  }

  const handleModels = async (request: any, reply: any) => {
    const providedApiKey = extractApiKeyFromRequest(request)

    try {
      await resolveApiKey(providedApiKey, { ipAddress: request.ip, endpointId: 'openai' })
    } catch (error) {
      if (error instanceof ApiKeyError) {
        reply.code(error.code === 'forbidden' ? 403 : 401)
        return {
          error: {
            code: error.code === 'forbidden' ? 'endpoint_forbidden' : 'invalid_api_key',
            message: error.message
          }
        }
      }
      throw error
    }

    const configSnapshot = getConfig()
    const data = buildModelsResponse(configSnapshot, 'openai')

    reply.header('content-type', 'application/json')
    return {
      object: 'list',
      data
    }
  }

  app.get('/openai/v1/models', handleModels)
  app.get('/openai/models', handleModels)

  const handleChatCompletions = async (request: any, reply: any) =>
    handleOpenAIChatProtocol(request, reply, systemEndpoint, 'openai', app)

  const handleResponses = async (request: any, reply: any) =>
    handleOpenAIResponsesProtocol(request, reply, systemEndpoint, 'openai', app)

  app.post('/openai/v1/chat/completions', handleChatCompletions)
  app.post('/openai/chat/completions', handleChatCompletions)

  app.post('/openai/v1/responses', handleResponses)
  app.post('/openai/responses', handleResponses)
}
