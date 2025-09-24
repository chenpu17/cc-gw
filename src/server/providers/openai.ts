import { fetch } from 'undici'
import { ReadableStream } from 'node:stream/web'
import type { ProviderConfig } from '../config/types.js'
import type { ProviderConnector, ProviderRequest, ProviderResponse } from './types.js'

export interface OpenAIConnectorOptions {
  /**
   * Optional override for complete endpoint URL. When not provided the connector
   * appends `defaultPath` to the configured base URL.
   */
  endpoint?: string
  /**
   * Path appended to the base URL when `endpoint` is not provided. Defaults to
   * `v1/chat/completions`.
   */
  defaultPath?: string
  /**
   * Hook that can adjust the outgoing request body before serialization.
   */
  mutateBody?: (body: Record<string, unknown>) => Record<string, unknown>
  /**
   * Optionally map upstream error payloads to a custom format. Return value will
   * be serialized as JSON text before forwarding to the caller.
   */
  mapErrorBody?: (payload: unknown) => unknown
}

const encoder = new TextEncoder()

function createJsonStream(payload: unknown): ReadableStream<Uint8Array> {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    }
  })
}

function resolveEndpoint(config: ProviderConfig, options?: OpenAIConnectorOptions): string {
  if (options?.endpoint) return options.endpoint
  const base = config.baseUrl.replace(/\/$/, '')
  const defaultPath = options?.defaultPath ?? 'v1/chat/completions'
  if (base.endsWith('/chat/completions')) return base

  let pathSegment = defaultPath
  if (base.endsWith('/v1') && defaultPath.startsWith('v1/')) {
    pathSegment = defaultPath.slice(3)
  }

  if (pathSegment.startsWith('/')) {
    pathSegment = pathSegment.slice(1)
  }

  return `${base}/${pathSegment}`
}

export function createOpenAIConnector(
  config: ProviderConfig,
  options?: OpenAIConnectorOptions
): ProviderConnector {
  const url = resolveEndpoint(config, options)
  const shouldLogEndpoint = process.env.CC_GW_DEBUG_ENDPOINTS === '1'

  return {
    id: config.id,
    async send(request: ProviderRequest): Promise<ProviderResponse> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...config.extraHeaders,
        ...request.headers
      }

      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`
      }

      const body: Record<string, unknown> = {
        ...request.body,
        model: request.model,
        stream: request.stream ?? false
      }

      const payload = options?.mutateBody ? options.mutateBody(body) : body

      if (shouldLogEndpoint) {
        console.info(`[cc-gw] provider=${config.id} endpoint=${url}`)
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })

      if (shouldLogEndpoint) {
        console.info(`[cc-gw] provider=${config.id} status=${res.status}`)
      }

      if (res.status >= 400 && options?.mapErrorBody) {
        let raw: unknown = null
        try {
          raw = await res.json()
        } catch {
          raw = await res.text()
        }
        if (shouldLogEndpoint) {
          console.warn(`[cc-gw] provider=${config.id} error_body=${typeof raw === 'string' ? raw : JSON.stringify(raw)}`)
        }
        const mapped = options.mapErrorBody(raw)
        return {
          status: res.status,
          headers: res.headers,
          body: createJsonStream(mapped)
        }
      }

      return {
        status: res.status,
        headers: res.headers,
        body: res.body
      }
    }
  }
}
