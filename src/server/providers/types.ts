import type { ReadableStream } from 'node:stream/web'

export interface ProviderRequest {
  model: string
  body: any
  stream?: boolean
  headers?: Record<string, string>
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
