import { getConfig } from '../config/manager.js'
import type { GatewayEndpoint, ModelRouteMap, ProviderConfig } from '../config/types.js'
import { estimateTokens } from '../protocol/tokenizer.js'
import type { NormalizedPayload } from '../protocol/types.js'

const MODEL_ALIASES: Record<string, string> = {
  // Claude aliases: map marketing friendly IDs to current Anthropic model identifiers
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-5-preview': 'claude-sonnet-4-5-20250929',
  'claude-sonnet-latest': 'claude-sonnet-4-5-20250929',
  'claude-3-5-sonnet-latest': 'claude-3-5-sonnet-20241022',
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
  'claude-haiku-4-5-20250929': 'claude-haiku-4-5-20251001',
  'claude-haiku-latest': 'claude-haiku-4-5-20251001',
  'claude-3-5-haiku-latest': 'claude-3-5-haiku-20241022'
}

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

function providerHasModel(provider: ProviderConfig, modelId: string | null | undefined): boolean {
  if (!modelId) return false
  if (provider.defaultModel === modelId) return true
  if (Array.isArray(provider.models)) {
    return provider.models.some((model) => model.id === modelId)
  }
  return false
}

function resolveProviderModel(
  provider: ProviderConfig,
  requestedModel: string | null | undefined
): string | null {
  if (!requestedModel) return null
  if (providerHasModel(provider, requestedModel)) {
    return requestedModel
  }
  const alias = applyModelAlias(requestedModel)
  if (alias && alias !== requestedModel && providerHasModel(provider, alias)) {
    console.info('[cc-gw][router]', 'model alias matched', requestedModel, '->', alias, '(provider:', provider.id, ')')
    return alias
  }
  return null
}

function resolveByIdentifier(
  identifier: string | null | undefined,
  providers: ProviderConfig[],
  requestedModel?: string
): RouteTarget | null {
  if (!identifier) return null
  if (identifier.includes(':')) {
    const [providerId, rawModelId] = identifier.split(':', 2)
    const provider = providers.find((p) => p.id === providerId)
    if (!provider) {
      return null
    }
    if (rawModelId === '*') {
      const passthrough = derivePassthroughModel(requestedModel)
      if (passthrough) {
        return { providerId, modelId: passthrough, provider, tokenEstimate: 0 }
      }
      return null
    }
    const resolvedModel = resolveProviderModel(provider, rawModelId)
    if (resolvedModel) {
      return { providerId, modelId: resolvedModel, provider, tokenEstimate: 0 }
    }
  } else {
    for (const provider of providers) {
      const resolvedModel = resolveProviderModel(provider, identifier)
      if (resolvedModel) {
        return { providerId: provider.id, modelId: resolvedModel, provider, tokenEstimate: 0 }
      }
    }
  }
  return null
}

function applyModelAlias(model: string | null | undefined): string | undefined {
  if (!model) return undefined
  const trimmed = model.trim()
  if (!trimmed) return undefined
  const lower = trimmed.toLowerCase()
  const resolved = MODEL_ALIASES[lower]
  return resolved && resolved !== trimmed ? resolved : undefined
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

  const requestedModelRaw = ctx.requestedModel?.trim()
  const requestedModelAlias = applyModelAlias(requestedModelRaw)
  const mappedIdentifier =
    (requestedModelRaw ? findMappedIdentifier(requestedModelRaw, endpointConfig.modelRoutes) : null) ??
    (requestedModelAlias ? findMappedIdentifier(requestedModelAlias, endpointConfig.modelRoutes) : null)
  const mapped = mappedIdentifier ? resolveByIdentifier(mappedIdentifier, providers, requestedModelRaw) : null
  if (mappedIdentifier && !mapped) {
    console.warn(`modelRoutes 映射目标无效: ${mappedIdentifier}`)
  }
  const fallbackModelId = providers[0].defaultModel ?? providers[0].models?.[0]?.id ?? 'gpt-4o'
  const tokenEstimate = estimateTokens(
    ctx.payload,
    mapped?.modelId ?? requestedModelRaw ?? requestedModelAlias ?? fallbackModelId
  )

  const strategy = ctx.payload
  const defaults = endpointConfig.defaults

  if (mapped) {
    return { ...mapped, tokenEstimate }
  }

  const fromRequest = resolveByIdentifier(requestedModelRaw, providers, requestedModelRaw)
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
