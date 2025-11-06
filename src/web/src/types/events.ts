export type EventLevel = 'info' | 'warn' | 'error'

export interface GatewayEvent {
  id: number
  createdAt: number
  type: string
  level: EventLevel
  source: string | null
  title: string | null
  message: string | null
  endpoint: string | null
  ipAddress: string | null
  apiKeyId: number | null
  apiKeyName: string | null
  apiKeyValue: string | null
  userAgent: string | null
  mode: string | null
  details: Record<string, unknown> | null
}

export interface EventsResponse {
  events: GatewayEvent[]
  nextCursor: number | null
}
