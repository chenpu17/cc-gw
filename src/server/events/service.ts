import type { InsertEventInput, QueriedEvent, QueryEventsOptions } from '../storage/index.js'
import { insertGatewayEvent, queryGatewayEvents } from '../storage/index.js'

export type EventLevel = 'info' | 'warn' | 'error'

export interface RecordEventInput {
  type: string
  level?: EventLevel
  source?: string | null
  title?: string | null
  message?: string | null
  endpoint?: string | null
  ipAddress?: string | null
  apiKeyId?: number | null
  apiKeyName?: string | null
  apiKeyValue?: string | null
  userAgent?: string | null
  mode?: string | null
  details?: Record<string, unknown> | null
  timestamp?: number
}

export async function recordEvent(input: RecordEventInput): Promise<number> {
  const createdAt = input.timestamp ?? Date.now()

  const payload: InsertEventInput = {
    createdAt,
    type: input.type,
    level: input.level ?? 'info',
    source: input.source ?? null,
    title: input.title ?? null,
    message: input.message ?? null,
    endpoint: input.endpoint ?? null,
    ipAddress: input.ipAddress ?? null,
    apiKeyId: input.apiKeyId ?? null,
    apiKeyName: input.apiKeyName ?? null,
    apiKeyValue: input.apiKeyValue ?? null,
    userAgent: input.userAgent ?? null,
    mode: input.mode ?? null,
    details: input.details ?? null
  }

  return insertGatewayEvent(payload)
}

export interface ListEventsOptions {
  limit?: number
  beforeId?: number
  level?: string
  type?: string
}

export interface EventsPage {
  events: QueriedEvent[]
  nextCursor: number | null
}

export async function listEvents(options: ListEventsOptions = {}): Promise<EventsPage> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const queryOptions: QueryEventsOptions = {
    limit: limit + 1,
    beforeId: options.beforeId,
    level: options.level,
    type: options.type
  }

  const rows = await queryGatewayEvents(queryOptions)
  let nextCursor: number | null = null
  let items = rows

  if (rows.length > limit) {
    const last = rows[limit]
    nextCursor = last.id
    items = rows.slice(0, limit)
  }

  return {
    events: items,
    nextCursor
  }
}
