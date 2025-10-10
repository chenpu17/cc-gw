import { fetch } from 'undici'
import type { ProviderConfig } from '../config/types.js'
import type { ProviderConnector, ProviderRequest, ProviderResponse } from './types.js'
import { appendQuery } from './utils.js'

const DEFAULT_VERSION = '2023-06-01'

export function createAnthropicConnector(config: ProviderConfig): ProviderConnector {
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  const endpoint = resolveAnthropicEndpoint(baseUrl)
  const shouldLogEndpoint =
    process.env.CC_GW_DEBUG_ENDPOINTS === '1' || process.env.CC_GW_DEBUG_OPENAI === '1'

  return {
    id: config.id,
    async send(request: ProviderRequest): Promise<ProviderResponse> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'anthropic-version': DEFAULT_VERSION,
        ...config.extraHeaders,
        ...request.headers
      }

      delete headers.Authorization
      delete (headers as any).authorization

      if (config.apiKey) {
        const mode = config.authMode === 'authToken' ? 'authToken' : 'apiKey'
        if (mode === 'authToken') {
          headers['Authorization'] = `Bearer ${config.apiKey}`
        } else {
          headers['x-api-key'] = config.apiKey
        }
      }

      if (!headers['anthropic-version']) {
        headers['anthropic-version'] = DEFAULT_VERSION
      }

      const payload = {
        ...request.body,
        model: request.model,
        stream: request.stream ?? false
      }

      const finalUrl = appendQuery(endpoint, request.query)

      if (shouldLogEndpoint) {
        console.info(`[cc-gw] provider=${config.id} endpoint=${finalUrl}`)
      }

      const response = await fetch(finalUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })

      if (shouldLogEndpoint) {
        console.info(`[cc-gw] provider=${config.id} status=${response.status}`)
      }

      return {
        status: response.status,
        headers: response.headers,
        body: response.body
      }
    }
  }
}

function resolveAnthropicEndpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, '')

  if (normalized.endsWith('/messages') || normalized.match(/\/v\d+\/messages$/)) {
    return normalized
  }

  if (normalized.match(/\/v\d+$/)) {
    return `${normalized}/messages`
  }

  if (normalized.endsWith('/anthropic')) {
    return `${normalized}/v1/messages`
  }

  if (normalized.endsWith('/anthropic/v1')) {
    return `${normalized}/messages`
  }

  return `${normalized}/v1/messages`
}
