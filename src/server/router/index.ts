import { getConfig } from '../config/manager.js'
import type { GatewayEndpoint, ModelRouteMap, ProviderConfig } from '../config/types.js'
import { estimateTokens } from '../protocol/tokenizer.js'
import type { NormalizedPayload } from '../protocol/types.js'

export interface RouteContext {
  payload: NormalizedPayload
  requestedModel?: string
  endpoint: GatewayEndpoint
}

export interface RouteTarget {
  providerId: string
  modelId: string
  provider: ProviderConfig
  tokenEstimate: number
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wildcardMatches(pattern: string, value: string): boolean {
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`)
  return regex.test(value)
}

function derivePassthroughModel(requestedModel: string | null | undefined): string | null {
  if (!requestedModel) return null
  const trimmed = requestedModel.trim()
  if (!trimmed) return null
  const parts = trimmed.split(':', 2)
  if (parts.length === 2 && parts[1]) {
    return parts[1]
  }
  return trimmed
}

function findMappedIdentifier(modelId: string | null | undefined, routes: ModelRouteMap | undefined): string | null {
  if (!modelId || !routes) return null
  const direct = routes[modelId]
  if (direct) {
    return direct
  }

  let bestTarget: string | null = null
  let bestSpecificity = -1
  let bestIndex = Number.POSITIVE_INFINITY
  const entries = Object.entries(routes)

  for (let index = 0; index < entries.length; index += 1) {
    const [pattern, target] = entries[index]
    if (!pattern.includes('*')) continue
    if (!wildcardMatches(pattern, modelId)) continue
    const specificity = pattern.replace(/\*/g, '').length
    if (specificity > bestSpecificity || (specificity === bestSpecificity && index < bestIndex)) {
      bestTarget = target
      bestSpecificity = specificity
      bestIndex = index
    }
  }

  return bestTarget
}

function resolveByIdentifier(
  identifier: string | null | undefined,
  providers: ProviderConfig[],
  requestedModel?: string
): RouteTarget | null {
  if (!identifier) return null
  if (identifier.includes(':')) {
    const [providerId, modelId] = identifier.split(':', 2)
    const provider = providers.find((p) => p.id === providerId)
    if (!provider) {
      return null
    }
    if (modelId === '*') {
      const passthrough = derivePassthroughModel(requestedModel)
      if (passthrough) {
        return { providerId, modelId: passthrough, provider, tokenEstimate: 0 }
      }
      return null
    }
    if (provider.defaultModel === modelId || provider.models?.some((m) => m.id === modelId)) {
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
  const endpointConfig = config.endpointRouting?.[ctx.endpoint] ?? config.endpointRouting?.anthropic
  if (!endpointConfig) {
    throw new Error(`未找到端点 ${ctx.endpoint} 的路由配置`)
  }
  const providers = config.providers
  if (!providers.length) {
    throw new Error('未配置任何模型提供商，请先在 Web UI 中添加 Provider。')
  }

  const requestedModel = ctx.requestedModel?.trim()
  const mappedIdentifier = requestedModel ? findMappedIdentifier(requestedModel, endpointConfig.modelRoutes) : null
  const mapped = mappedIdentifier ? resolveByIdentifier(mappedIdentifier, providers, requestedModel) : null
  if (mappedIdentifier && !mapped) {
    console.warn(`modelRoutes 映射目标无效: ${mappedIdentifier}`)
  }
  const fallbackModelId = providers[0].defaultModel ?? providers[0].models?.[0]?.id ?? 'gpt-4o'
  const tokenEstimate = estimateTokens(
    ctx.payload,
    mapped?.modelId ?? requestedModel ?? fallbackModelId
  )

  const strategy = ctx.payload
  const defaults = endpointConfig.defaults

  if (mapped) {
    return { ...mapped, tokenEstimate }
  }

  const fromRequest = resolveByIdentifier(requestedModel, providers, requestedModel)
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
