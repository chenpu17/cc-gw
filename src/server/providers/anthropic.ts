import { fetch } from 'undici'
import type { ProviderConfig } from '../config/types.js'
import type { ProviderConnector, ProviderRequest, ProviderResponse } from './types.js'

const DEFAULT_VERSION = '2023-06-01'

export function createAnthropicConnector(config: ProviderConfig): ProviderConnector {
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  const endpoint = `${baseUrl}/messages`
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

      if (config.apiKey) {
        headers['x-api-key'] = config.apiKey
      }

      if (!headers['anthropic-version']) {
        headers['anthropic-version'] = DEFAULT_VERSION
      }

      const payload = {
        ...request.body,
        model: request.model,
        stream: request.stream ?? false
      }

      if (shouldLogEndpoint) {
        console.info(`[cc-gw] provider=${config.id} endpoint=${endpoint}`)
      }

      const response = await fetch(endpoint, {
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
