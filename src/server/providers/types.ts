import type { ReadableStream } from 'node:stream/web'
import type { QueryValue } from './utils.js'

export interface ProviderRequest {
  model: string
  body: any
  stream?: boolean
  headers?: Record<string, string>
  query?: string | Record<string, QueryValue | QueryValue[]> | null
}

export interface ProviderResponse {
  status: number
  headers: Headers
  body: ReadableStream<Uint8Array> | null
}

export interface ProviderConnector {
  id: string
  send(request: ProviderRequest): Promise<ProviderResponse>
}
