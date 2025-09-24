import type { ProviderConfig } from '../config/types.js'
import type { ProviderConnector } from './types.js'
import { createOpenAIConnector } from './openai.js'

interface DeepSeekErrorPayload {
  error?: {
    message?: string
    code?: string
    type?: string
  }
}

const codeMessageMap: Record<string, string> = {
  authentication_error: 'DeepSeek API Key 无效或未配置',
  permission_denied: 'DeepSeek API Key 权限不足，请检查订阅计划',
  rate_limit_exceeded: 'DeepSeek 请求频率已达上限，请稍后再试',
  insufficient_quota: 'DeepSeek 账户余额不足，请充值后继续使用'
}

function mapDeepSeekError(payload: unknown): unknown {
  if (typeof payload === 'string') {
    try {
      return mapDeepSeekError(JSON.parse(payload))
    } catch {
      return { error: { message: payload, code: 'unknown_error' } }
    }
  }
  const data = payload as DeepSeekErrorPayload
  const code = data?.error?.code ?? data?.error?.type ?? 'unknown_error'
  const mappedMessage = codeMessageMap[code] ?? data?.error?.message ?? 'DeepSeek 请求失败'
  return {
    error: {
      code,
      message: mappedMessage
    }
  }
}

export function createDeepSeekConnector(config: ProviderConfig): ProviderConnector {
  return createOpenAIConnector(config, {
    defaultPath: 'v1/chat/completions',
    mapErrorBody: mapDeepSeekError
  })
}
