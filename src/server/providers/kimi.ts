import type { ProviderConfig } from '../config/types.js'
import type { ProviderConnector } from './types.js'
import { createOpenAIConnector } from './openai.js'

interface KimiErrorPayload {
  error?: {
    code?: string
    message?: string
    type?: string
  }
}

const codeMessageMap: Record<string, string> = {
  invalid_api_key: 'Kimi API Key 无效，请确认在控制台复制的值是否正确',
  permission_denied: 'Kimi API 权限不足或账号状态异常',
  insufficient_quota: 'Kimi 配额不足，请前往月之暗面控制台充值',
  rate_limit_exceeded: 'Kimi 请求过于频繁，请稍后再试'
}

function mapKimiError(payload: unknown): unknown {
  if (typeof payload === 'string') {
    try {
      return mapKimiError(JSON.parse(payload))
    } catch {
      return { error: { message: payload, code: 'unknown_error' } }
    }
  }
  const data = payload as KimiErrorPayload
  const code = data?.error?.code ?? data?.error?.type ?? 'unknown_error'
  const message = codeMessageMap[code] ?? data?.error?.message ?? 'Kimi 请求失败'
  return {
    error: {
      code,
      message
    }
  }
}

export function createKimiConnector(config: ProviderConfig): ProviderConnector {
  const base = config.baseUrl.replace(/\/$/, '')
  const endpointBase = base.endsWith('/v1') ? base.slice(0, -3) : base
  const endpoint = `${endpointBase}/v1/chat/completions`

  if (process.env.CC_GW_DEBUG_ENDPOINTS === '1') {
    console.info(`[cc-gw] kimi connector base=${config.baseUrl} resolved=${endpoint}`)
  }

  return createOpenAIConnector(config, {
    endpoint,
    mapErrorBody: mapKimiError
  })
}
