import type { FastifyInstance } from 'fastify'
import { listEvents } from '../events/service.js'

interface EventsQuery {
  limit?: string
  cursor?: string
  level?: string
  type?: string
}

export async function registerEventsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/events', async (request) => {
    const query = request.query as EventsQuery
    const limit = Number.parseInt(query.limit ?? '', 10)
    const cursor = Number.parseInt(query.cursor ?? '', 10)

    const page = await listEvents({
      limit: Number.isFinite(limit) && limit > 0 ? limit : 50,
      beforeId: Number.isFinite(cursor) && cursor > 0 ? cursor : undefined,
      level: query.level ? query.level.trim() : undefined,
      type: query.type ? query.type.trim() : undefined
    })

    return {
      events: page.events.map((event) => ({
        id: event.id,
        createdAt: event.created_at,
        type: event.type,
        level: event.level,
        source: event.source,
        title: event.title,
        message: event.message,
        endpoint: event.endpoint,
        ipAddress: event.ip_address,
        apiKeyId: event.api_key_id,
        apiKeyName: event.api_key_name,
        apiKeyValue: event.api_key_value,
        userAgent: event.user_agent,
        mode: event.mode,
        details: event.details
      })),
      nextCursor: page.nextCursor
    }
  })
}
