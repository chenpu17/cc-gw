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
      const headers = normalizeHeaders({
        'content-type': 'application/json',
        'anthropic-version': DEFAULT_VERSION,
        ...config.extraHeaders,
        ...request.headers
      })

      delete headers.authorization
      delete headers['x-api-key']

      if (config.apiKey) {
        const mode = config.authMode ?? 'apiKey'
        if (mode === 'authToken') {
          headers.authorization = `Bearer ${config.apiKey}`
        } else if (mode === 'xAuthToken') {
          headers['x-auth-token'] = config.apiKey
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
        if (process.env.CC_GW_DEBUG_HEADERS === '1') {
          const safeHeaders: Record<string, string> = {}
          for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase().includes('authorization')) {
              safeHeaders[key] = '<redacted>'
            } else {
              safeHeaders[key] = value
            }
          }
          console.info(`[cc-gw] provider=${config.id} headers`, safeHeaders)
          try {
            console.info(`[cc-gw] provider=${config.id} payload`, JSON.stringify(payload).slice(0, 500))
          } catch {
            console.info(`[cc-gw] provider=${config.id} payload`, '[unserializable payload]')
          }
        }
      }

      if (headers['content-length']) {
        delete headers['content-length']
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

function normalizeHeaders(
  source: Record<string, string | string[] | undefined>
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue
    const normalizedKey = key.toLowerCase()
    if (Array.isArray(value)) {
      const candidate = value.find((item) => item != null)
      if (candidate != null) {
        result[normalizedKey] = String(candidate)
      }
    } else {
      result[normalizedKey] = String(value)
    }
  }
  return result
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
