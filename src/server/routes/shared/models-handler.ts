import type { GatewayConfig } from '../../config/types.js'

/**
 * 构建 OpenAI /v1/models 响应数据
 *
 * 返回客户端可以请求的模型列表，严格遵循路由配置中的显式规则：
 * 1. 路由规则中配置的来源模型（modelRoutes 的 key）
 * 2. 过滤通配符（如 `*`、`claude-*`），因为它们是路由模式而非具体模型名
 * 3. 不包含 defaults 配置，因为那是内部默认路由
 *
 * 这样客户端看到的是"我可以显式请求哪些模型名"，与 Web UI 配置完全一致
 */
export function buildModelsResponse(configSnapshot: GatewayConfig) {
  const now = Math.floor(Date.now() / 1000)
  const models = new Map<
    string,
    {
      entry: {
        id: string
        object: 'model'
        created: number
        owned_by: string
        metadata?: Record<string, unknown>
        permission?: unknown[]
      }
      routedTo: Array<{
        endpoint: string
        targetProvider: string
        targetModel: string
      }>
    }
  >()

  const addModel = (modelId: string, endpoint: string, targetProvider: string, targetModel: string) => {
    const trimmed = modelId.trim()
    if (!trimmed) return

    // 过滤通配符：不应该把通配符路由规则当成模型名称
    if (trimmed.includes('*')) return

    const existing = models.get(trimmed)
    if (existing) {
      // 添加路由目标信息
      const routeExists = existing.routedTo.some(
        (r) => r.endpoint === endpoint && r.targetProvider === targetProvider
      )
      if (!routeExists) {
        existing.routedTo.push({ endpoint, targetProvider, targetModel })
      }
      return
    }

    models.set(trimmed, {
      entry: {
        id: trimmed,
        object: 'model',
        created: now,
        owned_by: 'gateway',
        permission: []
      },
      routedTo: [{ endpoint, targetProvider, targetModel }]
    })
  }

  // 1. 从 endpointRouting 中提取路由规则（只提取 modelRoutes 的 key）
  const endpointRouting = configSnapshot.endpointRouting ?? {}

  for (const [endpointName, routing] of Object.entries(endpointRouting)) {
    if (!routing?.modelRoutes) continue

    for (const [sourceModel, target] of Object.entries(routing.modelRoutes)) {
      // 解析目标：providerId:modelId
      const [providerId, targetModel] = target.split(':')
      if (providerId && targetModel) {
        addModel(sourceModel, endpointName, providerId, targetModel)
      }
    }
  }

  // 2. 从 customEndpoints 中提取路由规则（只提取 modelRoutes 的 key）
  const customEndpoints = configSnapshot.customEndpoints ?? []
  for (const customEndpoint of customEndpoints) {
    if (!customEndpoint.routing?.modelRoutes) continue

    for (const [sourceModel, target] of Object.entries(customEndpoint.routing.modelRoutes)) {
      const [providerId, targetModel] = target.split(':')
      if (providerId && targetModel) {
        addModel(sourceModel, `custom:${customEndpoint.id}`, providerId, targetModel)
      }
    }
  }

  // 3. 如果没有任何路由规则，fallback 到 provider 的模型（兼容旧版本）
  if (models.size === 0) {
    for (const provider of configSnapshot.providers) {
      if (provider.defaultModel) {
        addModel(provider.defaultModel, 'fallback', provider.id, provider.defaultModel)
      }
      if (Array.isArray(provider.models)) {
        for (const model of provider.models) {
          addModel(model.id, 'fallback', provider.id, model.id)
        }
      }
    }
  }

  // 构建最终响应
  const data = Array.from(models.values())
    .map(({ entry, routedTo }) => {
      const metadata: Record<string, unknown> = {
        routes: routedTo.map((r) => ({
          endpoint: r.endpoint,
          target: `${r.targetProvider}:${r.targetModel}`
        }))
      }
      entry.metadata = metadata
      return entry
    })
    .sort((a, b) => a.id.localeCompare(b.id))

  return data
}
