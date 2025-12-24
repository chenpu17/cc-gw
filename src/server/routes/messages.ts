import type { FastifyInstance } from 'fastify'
import type { CustomEndpointConfig } from '../config/types.js'
import { handleAnthropicCountTokensProtocol, handleAnthropicProtocol } from './custom-endpoint.js'

export async function registerMessagesRoute(app: FastifyInstance<any, any, any, any, any>): Promise<void> {
  app.post('/anthropic/api/event_logging/batch', async (_request, reply) => {
    reply.code(204)
    return null
  })

  const systemEndpoint: CustomEndpointConfig = {
    id: 'anthropic',
    label: 'anthropic',
    enabled: true
  }

  const countTokensHandler = async (request: any, reply: any) =>
    handleAnthropicCountTokensProtocol(request, reply, systemEndpoint, 'anthropic', app)

  app.post('/v1/messages/count_tokens', countTokensHandler)
  app.post('/anthropic/v1/messages/count_tokens', countTokensHandler)
  app.post('/anthropic/v1/v1/messages/count_tokens', countTokensHandler)

  const handler = async (request: any, reply: any) =>
    handleAnthropicProtocol(request, reply, systemEndpoint, 'anthropic', app)

  app.post('/v1/messages', handler)
  app.post('/anthropic/v1/messages', handler)
  app.post('/anthropic/v1/v1/messages', handler)
}
