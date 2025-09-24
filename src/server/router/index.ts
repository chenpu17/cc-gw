import { getConfig } from '../config/manager.js'
import type { ProviderConfig } from '../config/types.js'
import { estimateTokens } from '../protocol/tokenizer.js'
import type { NormalizedPayload } from '../protocol/types.js'

export interface RouteContext {
  payload: NormalizedPayload
  requestedModel?: string
}

export interface RouteTarget {
  providerId: string
  modelId: string
  provider: ProviderConfig
  tokenEstimate: number
}

function resolveByIdentifier(identifier: string | null | undefined, providers: ProviderConfig[]): RouteTarget | null {
  if (!identifier) return null
  if (identifier.includes(':')) {
    const [providerId, modelId] = identifier.split(':', 2)
    const provider = providers.find((p) => p.id === providerId)
    if (provider && (provider.defaultModel === modelId || provider.models?.some((m) => m.id === modelId))) {
      return { providerId, modelId, provider, tokenEstimate: 0 }
    }
  } else {
    for (const provider of providers) {
      if (provider.defaultModel === identifier || provider.models?.some((m) => m.id === identifier)) {
        return { providerId: provider.id, modelId: identifier, provider, tokenEstimate: 0 }
      }
    }
  }
  return null
}

export function resolveRoute(ctx: RouteContext): RouteTarget {
  const config = getConfig()
  const providers = config.providers
  if (!providers.length) {
    throw new Error('未配置任何模型提供商，请先在 Web UI 中添加 Provider。')
  }

  const requestedModel = ctx.requestedModel?.trim()
  const mappedIdentifier = requestedModel ? (config.modelRoutes?.[requestedModel] ?? null) : null
  const fallbackModelId = providers[0].defaultModel ?? providers[0].models?.[0]?.id ?? 'gpt-4o'
  const tokenEstimate = estimateTokens(
    ctx.payload,
    mappedIdentifier ?? requestedModel ?? fallbackModelId
  )

  const strategy = ctx.payload
  const defaults = config.defaults

  if (mappedIdentifier) {
    const mapped = resolveByIdentifier(mappedIdentifier, providers)
    if (mapped) {
      return { ...mapped, tokenEstimate }
    }
    console.warn(`modelRoutes 映射目标无效: ${mappedIdentifier}`)
  }

  const fromRequest = resolveByIdentifier(requestedModel, providers)
  if (fromRequest) {
    return { ...fromRequest, tokenEstimate }
  }

  if (strategy.thinking && defaults.reasoning) {
    const target = resolveByIdentifier(defaults.reasoning, providers)
    if (target) return { ...target, tokenEstimate }
  }

  if (tokenEstimate > (defaults.longContextThreshold ?? 60000) && defaults.background) {
    const target = resolveByIdentifier(defaults.background, providers)
    if (target) return { ...target, tokenEstimate }
  }

  if (defaults.completion) {
    const target = resolveByIdentifier(defaults.completion, providers)
    if (target) return { ...target, tokenEstimate }
  }

  const firstProvider = providers[0]
  const modelId = firstProvider.defaultModel || firstProvider.models?.[0]?.id
  if (!modelId) {
    throw new Error(`Provider ${firstProvider.id} 未配置任何模型`)
  }
  return {
    providerId: firstProvider.id,
    modelId,
    provider: firstProvider,
    tokenEstimate
  }
}
